import { DERIVE_WS_URL } from '../shared/endpoints.js';
import { JsonRpcWsClient } from '../shared/jsonrpc-client.js';
import { SdkBaseAdapter, type CachedInstrument, type LiveQuote } from '../shared/sdk-base.js';
import type { VenueId } from '../../types/common.js';
import { EMPTY_GREEKS } from '../../core/types.js';
import { feedLogger } from '../../utils/logger.js';
import { DeriveTickerSchema, DeriveInstrumentSchema, type DeriveTicker, type DeriveInstrument } from './types.js';

const log = feedLogger('derive');

// Production still uses the legacy lyra.finance domain
const CURRENCIES = ['BTC', 'ETH', 'SOL', 'HYPE'];

// Derive has no instrument lifecycle push channel — poll for new strikes/expiries.
const INSTRUMENT_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Derive (formerly Lyra Finance) adapter using direct JSON-RPC over WebSocket.
 *
 * Protocol differences from Deribit:
 * - Subscribe method is `subscribe` NOT `public/subscribe`
 * - `get_tickers` requires `expiry_date` in YYYYMMDD format, returns dict keyed by instrument name
 * - Ticker data uses abbreviated keys: B=bid, A=ask, I=index, M=mark
 * - option_pricing: d=delta, g=gamma, t=theta, v=vega, i=iv, r=rho, f=forward, m=mark, bi=bid_iv, ai=ask_iv
 * - open_interest in stats.oi
 * - WS channel: ticker_slim.{instrument_name}.{interval}
 * - Notification data wrapped in { instrument_ticker: { ... } }
 *
 * Instruments: `public/get_instruments` per currency (MUST per-currency,
 *              `get_all_instruments` caps at 100).
 * USDC-settled, all linear.
 */
export class DeriveWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'derive';

  private rpc!: JsonRpcWsClient;
  private subscribedTickers = new Set<string>();
  private expiryDates = new Map<string, Set<string>>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  protected initClients(): void {
    if (this.rpc) return;
    this.rpc = new JsonRpcWsClient(DERIVE_WS_URL, 'derive-ws', {
      heartbeatIntervalSec: 30,
      requestTimeoutMs: 45_000,
      subscribeMethod: 'subscribe',
      unsubscribeMethod: 'unsubscribe',
      unsubscribeAllMethod: 'unsubscribe_all',
      onStatusChange: (state) => this.emitStatus(state === 'connected' ? 'connected' : state === 'down' ? 'down' : 'reconnecting'),
    });

    this.rpc.onSubscription((channel, data) => {
      if (channel.startsWith('ticker_slim.')) {
        this.handleTicker(channel, data);
      }
    });
  }

  // ─── instrument loading ───────────────────────────────────────

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    await this.rpc.connect();

    const instruments: CachedInstrument[] = [];

    for (const currency of CURRENCIES) {
      try {
        const result = await this.rpc.call('public/get_instruments', {
          currency,
          instrument_type: 'option',
          expired: false,
        });

        // Docs: result is a direct array, not { instruments: [...] }
        const list = Array.isArray(result) ? result : (result?.instruments ?? []);
        for (const item of list) {
          const inst = this.parseInstrument(item);
          if (inst) instruments.push(inst);
        }

        log.info({ count: list.length, currency }, 'loaded option instruments');
      } catch (err: unknown) {
        log.warn({ currency, err: String(err) }, 'failed to load instruments');
      }
    }

    log.info({ count: instruments.length }, 'total option instruments loaded');

    await this.fetchBulkTickers();

    // Derive has no instrument lifecycle push channel — poll for new listings.
    this.refreshTimer = setInterval(() => { void this.refreshInstruments(); }, INSTRUMENT_REFRESH_INTERVAL_MS);

    // Prune instruments for expiries where Derive returned zero tickers.
    // Derive's get_instruments lists expiries that have no actual market data,
    // which causes ghost expiry tabs in the UI.
    const before = instruments.length;
    const live = instruments.filter((inst) => this.quoteStore.has(inst.exchangeSymbol));

    if (live.length < before) {
      log.info({ before, after: live.length, pruned: before - live.length }, 'pruned instruments with no quote data');
    }

    return live;
  }

  private parseInstrument(item: unknown): CachedInstrument | null {
    const parsed = DeriveInstrumentSchema.safeParse(item);
    if (!parsed.success) return null;

    const inst = parsed.data;
    if (inst.instrument_type !== 'option') return null;
    if (inst.is_active === false) return null;

    const name = inst.instrument_name;

    const od = inst.option_details;
    let base: string;
    let expiryRaw: string;
    let strike: number;
    let right: 'call' | 'put';

    if (od) {
      // option_details.index is "BTC-USD" → base is "BTC"
      base = od.index.split('-')[0] ?? name.split('-')[0]!;
      strike = Number(od.strike);
      right = od.option_type === 'C' ? 'call' : 'put';
      // option_details.expiry is Unix seconds → convert to YYYYMMDD string
      const d = new Date(od.expiry * 1000);
      const yyyy = d.getUTCFullYear().toString();
      const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
      const dd = d.getUTCDate().toString().padStart(2, '0');
      expiryRaw = `${yyyy}${mm}${dd}`;
    } else {
      // Fallback: parse from instrument name "BTC-20260328-60000-C"
      const parts = name.match(/^(\w+)-(\d{8})-(\d+)-([CP])$/);
      if (!parts) return null;
      base = parts[1]!;
      expiryRaw = parts[2]!;
      strike = Number(parts[3]);
      right = parts[4] === 'C' ? 'call' : 'put';
    }

    const expiry = this.parseExpiry(expiryRaw); // YYYYMMDD → YYYY-MM-DD

    if (!this.expiryDates.has(base)) this.expiryDates.set(base, new Set());
    this.expiryDates.get(base)!.add(expiryRaw);

    const settle = inst.quote_currency ?? 'USDC';

    return {
      symbol: this.buildCanonicalSymbol(base, settle, expiry, strike, right),
      exchangeSymbol: name,
      base,
      quote: inst.quote_currency ?? 'USDC',
      settle,
      expiry,
      strike,
      right,
      inverse: false,
      contractSize: 1,
      tickSize: this.safeNum(inst.tick_size),
      minQty: this.safeNum(inst.minimum_amount),
      makerFee: this.safeNum(inst.maker_fee_rate),
      takerFee: this.safeNum(inst.taker_fee_rate),
    };
  }

  /**
   * Fetch tickers for a single currency+expiry via bulk get_tickers.
   * Instruments with zero liquidity won't appear — the WS ticker_slim
   * subscription fills them in as quotes arrive.
   */
  private async fetchTickersForExpiry(currency: string, expiryDate: string): Promise<number> {
    const result = await this.rpc.call('public/get_tickers', {
      instrument_type: 'option',
      currency,
      expiry_date: expiryDate,
    });

    const resultObj = result && typeof result === 'object' ? result as Record<string, unknown> : {};
    const tickerDict = resultObj['tickers'] && typeof resultObj['tickers'] === 'object'
      ? resultObj['tickers'] as Record<string, unknown>
      : {};

    let count = 0;
    for (const [name, raw] of Object.entries(tickerDict)) {
      const parsed = DeriveTickerSchema.safeParse(raw);
      if (!parsed.success) continue;
      this.quoteStore.set(name, this.parseTickerAbbreviated(parsed.data));
      count++;
    }

    return count;
  }

  private async fetchBulkTickers(): Promise<void> {
    for (const currency of CURRENCIES) {
      const expiries = this.expiryDates.get(currency);
      if (!expiries) continue;

      let totalCount = 0;
      for (const expiryDate of expiries) {
        try {
          totalCount += await this.fetchTickersForExpiry(currency, expiryDate);
        } catch (err: unknown) {
          log.warn({ currency, expiryDate, err: String(err) }, 'get_tickers failed');
        }
      }

      log.info({ count: totalCount, currency, expiries: expiries.size }, 'fetched tickers');
    }

  }

  // ─── WebSocket subscriptions ──────────────────────────────────

  protected async subscribeChain(
    underlying: string,
    expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    // Derive's get_tickers requires expiry_date — non-eager expiries have no data until fetched
    try {
      const count = await this.fetchTickersForExpiry(underlying, expiry.replace(/-/g, ''));
      log.info({ count, underlying, expiry }, 'fetched tickers for expiry');
    } catch (err: unknown) {
      log.warn({ underlying, expiry, err: String(err) }, 'get_tickers failed for expiry');
    }

    const channels: string[] = [];

    for (const inst of instruments) {
      if (!this.subscribedTickers.has(inst.exchangeSymbol)) {
        channels.push(`ticker_slim.${inst.exchangeSymbol}.1000`);
        this.subscribedTickers.add(inst.exchangeSymbol);
      }
    }

    if (channels.length > 0) {
      const BATCH = 100;
      for (let i = 0; i < channels.length; i += BATCH) {
        const batch = channels.slice(i, i + BATCH);
        await this.rpc.subscribe(batch);
      }
      log.info({ count: channels.length, underlying }, 'subscribed to ticker channels');
    }
  }

  protected async unsubscribeAll(): Promise<void> {
    await this.rpc.unsubscribeAll();
    this.subscribedTickers.clear();
  }

  /**
   * Poll get_instruments every 10 minutes to pick up new strikes and expiries.
   * Derive has no instrument lifecycle push channel.
   */
  private async refreshInstruments(): Promise<void> {
    for (const currency of CURRENCIES) {
      try {
        const result = await this.rpc.call('public/get_instruments', {
          currency,
          instrument_type: 'option',
          expired: false,
        });

        const list = Array.isArray(result) ? result : (result?.instruments ?? []);
        const newInstruments: CachedInstrument[] = [];

        for (const item of list) {
          const inst = this.parseInstrument(item);
          if (!inst || this.instrumentMap.has(inst.exchangeSymbol)) continue;
          newInstruments.push(inst);
        }

        if (newInstruments.length === 0) continue;

        for (const inst of newInstruments) {
          this.instruments.push(inst);
          this.instrumentMap.set(inst.exchangeSymbol, inst);
          this.symbolIndex.set(inst.symbol, inst.exchangeSymbol);
          if (!this.expiryDates.has(inst.base)) this.expiryDates.set(inst.base, new Set());
          this.expiryDates.get(inst.base)!.add(inst.expiry.replace(/-/g, ''));
        }

        log.info({ count: newInstruments.length, currency }, 'added new instruments from refresh');
      } catch (err: unknown) {
        log.warn({ currency, err: String(err) }, 'instrument refresh failed');
      }
    }
  }

  // ─── WS message handlers ─────────────────────────────────────

  private handleTicker(channel: string, data: unknown): void {
    if (!data || typeof data !== 'object') return;

    // ticker_slim notifications wrap data in { instrument_ticker: { ... } }
    const rec = data as Record<string, unknown>;
    const rawTicker = rec['instrument_ticker'] ?? data;

    // Instrument name is between first and last dot: "ticker_slim.BTC-20260327-84000-C.1000"
    const parts = channel.split('.');
    const name = parts.slice(1, -1).join('.');

    if (!name || !this.instrumentMap.has(name)) return;

    const parsed = DeriveTickerSchema.safeParse(rawTicker);
    if (!parsed.success) return;

    const quote = this.parseTickerAbbreviated(parsed.data);
    this.emitQuoteUpdate(name, quote);
  }

  /**
   * Parse Derive's abbreviated ticker format.
   * Keys: B=best_bid_amount, b=best_bid_price, A=best_ask_amount, a=best_ask_price, I=index_price, M=mark_price
   * option_pricing: d=delta, g=gamma, t=theta, v=vega, i=iv, r=rho, f=forward, m=mark, bi=bid_iv, ai=ask_iv
   * stats: oi=open_interest, v=volume, c=24h_change
   */
  private parseTickerAbbreviated(t: DeriveTicker): LiveQuote {
    const op = t.option_pricing;
    const stats = t.stats;

    return {
      // Derive abbreviated keys: B=best_bid_amount (size), b=best_bid_price
      bidPrice: this.safeNum(t.b ?? t.best_bid_price),
      askPrice: this.safeNum(t.a ?? t.best_ask_price),
      bidSize: this.safeNum(t.B ?? t.best_bid_amount),
      askSize: this.safeNum(t.A ?? t.best_ask_amount),
      markPrice: this.safeNum(op?.m ?? t.M ?? t.mark_price),
      lastPrice: null,
      underlyingPrice: this.safeNum(t.I ?? t.index_price),
      indexPrice: this.safeNum(t.I ?? t.index_price),
      volume24h: this.safeNum(stats?.c),
      openInterest: this.safeNum(stats?.oi),
      openInterestUsd: null,
      volume24hUsd: this.safeNum(stats?.v),
      greeks: op ? {
        delta: this.safeNum(op.d ?? op.delta),
        gamma: this.safeNum(op.g ?? op.gamma),
        theta: this.safeNum(op.t ?? op.theta),
        vega: this.safeNum(op.v ?? op.vega),
        rho: this.safeNum(op.r ?? op.rho),
        markIv: this.safeNum(op.i ?? op.iv),
        bidIv: this.safeNum(op.bi ?? op.bid_iv),
        askIv: this.safeNum(op.ai ?? op.ask_iv),
      } : { ...EMPTY_GREEKS },
      timestamp: Number(t.t ?? t.timestamp) || Date.now(),
    };
  }

  override async dispose(): Promise<void> {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    await this.rpc?.disconnect();
  }
}
