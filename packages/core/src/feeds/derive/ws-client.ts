import { DERIVE_WS_URL } from '../shared/endpoints.js';
import { JsonRpcWsClient } from '../shared/jsonrpc-client.js';
import { SdkBaseAdapter, type CachedInstrument } from '../shared/sdk-base.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import {
  parseDeriveHealthIncidents,
  parseDeriveHealthTime,
  parseDeriveInstrument,
  parseDeriveInstrumentsResponse,
  parseDeriveTicker,
  parseDeriveTickersResponse,
} from './codec.js';
import { deriveDeriveHealth } from './health.js';
import {
  buildDeriveSubscriptionPlan,
  createDeriveSubscriptionState,
  deriveTickerChannel,
  removeDeriveSubscribedTickers,
  resetDeriveSubscriptionState,
  subscribeDeriveBatches,
} from './planner.js';
import {
  buildDeriveQuote,
  createDeriveState,
  deriveInstrumentDetails,
  registerDeriveExpiry,
  registerDeriveInstrument,
} from './state.js';

const log = feedLogger('derive');

// Production still uses the legacy lyra.finance domain
const CURRENCIES = ['BTC', 'ETH', 'SOL', 'HYPE'];

// Derive has no instrument lifecycle push channel — poll for new strikes/expiries.
const INSTRUMENT_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const HEALTH_CHECK_INTERVAL_MS = 60 * 1000;

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
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private readonly state = createDeriveState();
  private readonly subscriptions = createDeriveSubscriptionState();

  protected initClients(): void {
    if (this.rpc) return;
    this.rpc = new JsonRpcWsClient(DERIVE_WS_URL, 'derive-ws', {
      heartbeatIntervalSec: 30,
      requestTimeoutMs: 45_000,
      subscribeMethod: 'subscribe',
      unsubscribeMethod: 'unsubscribe',
      unsubscribeAllMethod: 'unsubscribe_all',
      onStatusChange: (state) =>
        this.emitStatus(
          state === 'connected' ? 'connected' : state === 'down' ? 'down' : 'reconnecting',
        ),
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

        const list = parseDeriveInstrumentsResponse(result);
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
    this.refreshTimer = setInterval(() => {
      void this.refreshInstruments();
    }, INSTRUMENT_REFRESH_INTERVAL_MS);
    this.healthTimer = setInterval(() => {
      void this.refreshHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
    void this.refreshHealth();

    // Prune instruments for expiries where Derive returned zero tickers.
    // Derive's get_instruments lists expiries that have no actual market data,
    // which causes ghost expiry tabs in the UI.
    const before = instruments.length;
    const live = instruments.filter((inst) => this.quoteStore.has(inst.exchangeSymbol));

    if (live.length < before) {
      log.info(
        { before, after: live.length, pruned: before - live.length },
        'pruned instruments with no quote data',
      );
    }

    return live;
  }

  private parseInstrument(item: unknown): CachedInstrument | null {
    const inst = parseDeriveInstrument(item);
    if (inst == null) return null;
    if (inst.instrument_type !== 'option') return null;
    if (inst.is_active === false) return null;

    const details = deriveInstrumentDetails(inst);
    if (details == null || !Number.isFinite(details.strike)) return null;

    const expiry = this.parseExpiry(details.expiryRaw);
    registerDeriveExpiry(this.state, details.base, details.expiryRaw);

    const settle = inst.quote_currency ?? 'USDC';

    return {
      symbol: this.buildCanonicalSymbol(
        details.base,
        settle,
        expiry,
        details.strike,
        details.right,
      ),
      exchangeSymbol: inst.instrument_name,
      base: details.base,
      quote: inst.quote_currency ?? 'USDC',
      settle,
      expiry,
      strike: details.strike,
      right: details.right,
      inverse: false,
      contractSize: 1,
      contractValueCurrency: details.base,
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

    const tickersResponse = parseDeriveTickersResponse(result);
    if (tickersResponse == null) return 0;

    let count = 0;
    for (const [name, parsed] of Object.entries(tickersResponse.tickers)) {
      if (parsed == null) continue;
      this.quoteStore.set(
        name,
        buildDeriveQuote(parsed, (value) => this.safeNum(value)),
      );
      count++;
    }

    return count;
  }

  private async fetchBulkTickers(): Promise<void> {
    for (const currency of CURRENCIES) {
      const expiries = this.state.expiryDates.get(currency);
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

    const plan = buildDeriveSubscriptionPlan(this.subscriptions, instruments);

    if (plan.channels.length > 0) {
      await subscribeDeriveBatches(plan.channels, (batch) => this.rpc.subscribe(batch, 'ticker'));
      log.info({ count: plan.channels.length, underlying }, 'subscribed to ticker channels');
    }
  }

  protected override async unsubscribeChain(
    _underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    const channels = instruments
      .filter((instrument) => this.subscriptions.subscribedTickers.has(instrument.exchangeSymbol))
      .map((instrument) => deriveTickerChannel(instrument.exchangeSymbol));

    if (channels.length === 0) return;

    await this.rpc.unsubscribe(channels);
    removeDeriveSubscribedTickers(
      this.subscriptions,
      instruments.map((instrument) => instrument.exchangeSymbol),
    );
  }

  protected async unsubscribeAll(): Promise<void> {
    await this.rpc.unsubscribeAll();
    resetDeriveSubscriptionState(this.subscriptions);
  }

  /**
   * Poll get_instruments every 10 minutes to pick up new strikes and expiries.
   * Derive has no instrument lifecycle push channel.
   */
  private async refreshInstruments(): Promise<void> {
    this.sweepExpiredState();

    for (const currency of CURRENCIES) {
      try {
        const result = await this.rpc.call('public/get_instruments', {
          currency,
          instrument_type: 'option',
          expired: false,
        });

        const list = parseDeriveInstrumentsResponse(result);
        const newInstruments: CachedInstrument[] = [];

        for (const item of list) {
          const inst = this.parseInstrument(item);
          if (!inst || this.instrumentMap.has(inst.exchangeSymbol)) continue;
          newInstruments.push(inst);
        }

        if (newInstruments.length === 0) continue;

        for (const inst of newInstruments) {
          registerDeriveInstrument(
            this.state,
            this.instruments,
            this.instrumentMap,
            this.symbolIndex,
            inst,
          );
        }

        await this.activateRefreshedInstruments(newInstruments);
        log.info({ count: newInstruments.length, currency }, 'added new instruments from refresh');
      } catch (err: unknown) {
        log.warn({ currency, err: String(err) }, 'instrument refresh failed');
      }
    }
  }

  private async activateRefreshedInstruments(instruments: CachedInstrument[]): Promise<void> {
    const groups = new Map<string, CachedInstrument[]>();

    for (const instrument of instruments) {
      const key = `${instrument.base}:${instrument.expiry}`;
      const grouped = groups.get(key) ?? [];
      grouped.push(instrument);
      groups.set(key, grouped);
    }

    for (const [key, grouped] of groups) {
      const [underlying, expiry] = key.split(':');
      if (!underlying || !expiry) continue;
      if ((this.requestRefCounts.get(key) ?? 0) <= 0) continue;

      try {
        const count = await this.fetchTickersForExpiry(underlying, expiry.replace(/-/g, ''));
        log.info({ count, underlying, expiry }, 'fetched tickers for refreshed expiry');
      } catch (error: unknown) {
        log.warn(
          { underlying, expiry, err: String(error) },
          'get_tickers failed for refreshed expiry',
        );
      }

      const plan = buildDeriveSubscriptionPlan(this.subscriptions, grouped);
      if (plan.channels.length === 0) continue;

      await subscribeDeriveBatches(plan.channels, (batch) =>
        this.rpc.subscribe(batch, 'ticker-refresh'),
      );
      log.info(
        { count: plan.channels.length, underlying, expiry },
        'subscribed refreshed ticker channels',
      );
    }
  }

  private async refreshHealth(): Promise<void> {
    try {
      const [serverTimeRaw, incidentsRaw] = await Promise.all([
        this.rpc.call('public/get_time', {}),
        this.rpc.call('public/get_live_incidents', {}),
      ]);

      const health = deriveDeriveHealth({
        serverTime: parseDeriveHealthTime(serverTimeRaw),
        incidents: parseDeriveHealthIncidents(incidentsRaw),
      });
      this.emitStatus(health.status, health.message);
    } catch (error: unknown) {
      const health = deriveDeriveHealth({
        serverTime: null,
        incidents: null,
        error,
      });
      this.emitStatus(health.status, health.message);
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

    const parsed = parseDeriveTicker(rawTicker);
    if (parsed == null) return;

    const quote = buildDeriveQuote(parsed, (value) => this.safeNum(value));
    this.emitQuoteUpdate(name, quote);
  }

  private sweepExpiredState(): void {
    const removed = this.sweepExpiredInstruments();
    if (removed.length === 0) return;

    removeDeriveSubscribedTickers(
      this.subscriptions,
      removed.map((instrument) => instrument.exchangeSymbol),
    );
    log.info({ count: removed.length }, 'removed expired instruments');
  }

  override async dispose(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    await this.unsubscribeAll();
    await this.rpc?.disconnect();
  }
}
