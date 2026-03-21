import { JsonRpcWsClient } from '../shared/jsonrpc-client.js';
import { SdkBaseAdapter, type CachedInstrument, type LiveQuote } from '../shared/sdk-base.js';
import type { VenueId } from '../../types/common.js';
import { EMPTY_GREEKS } from '../../core/types.js';
import { feedLogger } from '../../utils/logger.js';
import {
  DeribitMarkPriceDataSchema,
  DeribitTickerSchema,
  DeribitBookSummarySchema,
  DeribitInstrumentSchema,
  DeribitPriceIndexSchema,
  type DeribitMarkPriceItem,
  type DeribitTicker,
  type DeribitBookSummary,
  type DeribitInstrument,
} from './types.js';
import { z } from 'zod';

const log = feedLogger('deribit');

const DERIBIT_WS_URL = 'wss://www.deribit.com/ws/api/v2';

// Deribit charges 3k credits per subscribe call regardless of channel count,
// and supports up to 500 channels per call. Batching large keeps call count low.
const SUBSCRIBE_BATCH_SIZE = 500;

// ~3.3 calls/sec sustained (30k credit pool, 3k per call).
const SUBSCRIBE_BATCH_DELAY_MS = 300;

// Eager subscriptions use agg2 (2s aggregation) to reduce traffic.
// On-demand subscriptions (user viewing a chain) use 100ms for tight updates.
const EAGER_TICKER_INTERVAL = 'agg2';
const ACTIVE_TICKER_INTERVAL = '100ms';

/** Regex for Deribit instrument names, supporting decimal strikes (e.g. 420d5 → 420.5). */
const INSTRUMENT_RE = /^(\w+)-(\w+)-(\d+(?:d\d+)?)-([CP])$/;

/**
 * Deribit options adapter using direct JSON-RPC over WebSocket.
 *
 * Instruments: loaded via `public/get_instruments` with `currency: 'any'` to
 * retrieve all currencies (BTC, ETH, USDC, USDT, EURR) in a single call.
 *
 * Initial snapshot: `public/get_book_summary_by_currency` per currency family.
 *
 * Live data:
 *   - `deribit_price_index.{index_name}` — live spot price (~1s), keeps
 *     underlyingPrice fresh for USD conversion across ALL instruments.
 *   - `markprice.options.{index_name}` — bulk mark price + IV (2s) for all options.
 *   - `ticker.{instrument}.{interval}` — full bid/ask + greeks for subscribed chains.
 *
 * Deribit is inverse for BTC/ETH: premiums quoted in the base asset.
 * We normalize to USD using underlyingPrice from the live price index.
 */
export class DeribitWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'deribit';

  private rpc!: JsonRpcWsClient;
  private subscribedIndexes = new Set<string>();
  private subscribedPriceIndexes = new Set<string>();
  private subscribedTickers = new Set<string>();

  // Live index prices from deribit_price_index channels (~1s updates).
  // Used to keep underlyingPrice fresh for ALL instruments, even those
  // without individual ticker subscriptions.
  private liveIndexPrices = new Map<string, number>();

  // Maps index_name → set of exchangeSymbols under that index, built during
  // instrument loading so price_index updates can fan out efficiently.
  private indexToInstruments = new Map<string, Set<string>>();

  // Subscribe to ALL expiries so bid/ask and greeks are live from boot.
  // agg2 (2s) keeps per-instrument bandwidth low. Deribit rate limits are
  // comfortable: ~4300 instruments / 500 per batch = 9 subscribe calls,
  // each costing 3000 credits from a 30k pool that refills at 10k/sec.
  protected override async eagerSubscribe(): Promise<void> {
    const underlyings = await this.listUnderlyings();

    for (const underlying of underlyings) {
      const expiries = await this.listExpiries(underlying);

      for (const expiry of expiries) {
        const matching = this.instruments.filter(
          (i) => i.base === underlying && i.expiry === expiry,
        );
        if (matching.length > 0) {
          await this.subscribeWithInterval(underlying, matching, EAGER_TICKER_INTERVAL);
        }
      }
    }
  }

  protected initClients(): void {
    if (this.rpc) return;
    this.rpc = new JsonRpcWsClient(DERIBIT_WS_URL, 'deribit-ws', {
      heartbeatIntervalSec: 30,
      requestTimeoutMs: 15_000,
      onStatusChange: (state) => this.emitStatus(state === 'connected' ? 'connected' : state === 'down' ? 'down' : 'reconnecting'),
    });

    this.rpc.onSubscription((channel: string, data: unknown) => {
      if (channel.startsWith('markprice.options.')) {
        this.handleMarkPriceOptions(data);
      } else if (channel.startsWith('deribit_price_index.')) {
        this.handlePriceIndex(data);
      } else if (channel.startsWith('ticker.')) {
        this.handleTicker(channel, data);
      }
    });
  }

  // ─── instrument loading ───────────────────────────────────────

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    await this.rpc.connect();

    // `currency: 'any'` is the Deribit-documented way to fetch all currencies
    // (BTC, ETH, USDC, USDT, EURR) in a single RPC call instead of looping.
    const raw: unknown = await this.rpc.call('public/get_instruments', {
      currency: 'any',
      kind: 'option',
      expired: false,
    });

    const parsed = z.array(z.unknown()).safeParse(raw);
    if (!parsed.success) {
      log.warn({ error: parsed.error.message }, 'get_instruments returned unexpected shape');
      return [];
    }

    const instruments: CachedInstrument[] = [];
    for (const item of parsed.data) {
      const inst = this.parseInstrument(item);
      if (inst) instruments.push(inst);
    }

    log.info({ count: instruments.length }, 'loaded option instruments');

    const currencies = [...new Set(instruments.map((i) => i.settle))];
    await this.fetchBulkSummaries(currencies);

    return instruments;
  }

  /**
   * Parse a raw `get_instruments` item into a `CachedInstrument`.
   *
   * Deribit uses `d` as a decimal separator in strike prices
   * (e.g. `BTC-28MAR26-420d5-C` means strike 420.5). The regex
   * `\d+(?:d\d+)?` matches both integer and decimal forms.
   */
  private parseInstrument(item: unknown): CachedInstrument | null {
    const res = DeribitInstrumentSchema.safeParse(item);
    if (!res.success) {
      log.debug({ error: res.error.message }, 'skipping unparseable instrument');
      return null;
    }

    const inst: DeribitInstrument = res.data;
    const parts = inst.instrument_name.match(INSTRUMENT_RE);
    if (!parts) return null;

    const [, base, expiryRaw, strikeRaw, rightChar] = parts as [string, string, string, string, string];

    // Convert Deribit decimal-strike notation: "420d5" → "420.5"
    const strikeStr = strikeRaw.replace('d', '.');
    const strike = Number(strikeStr);
    if (!Number.isFinite(strike)) return null;

    const expiry = this.parseExpiry(expiryRaw);
    const right = rightChar === 'C' ? ('call' as const) : ('put' as const);
    const settle = inst.settlement_currency ?? base;
    const isInverse = inst.instrument_type === 'reversed';

    return {
      symbol: this.buildCanonicalSymbol(base, settle, expiry, strike, right),
      exchangeSymbol: inst.instrument_name,
      base,
      quote: 'USD',
      settle,
      expiry,
      strike,
      right,
      inverse: isInverse,
      contractSize: this.safeNum(inst.contract_size) ?? 1,
      tickSize: this.safeNum(inst.tick_size),
      minQty: this.safeNum(inst.min_trade_amount),
      makerFee: this.safeNum(inst.maker_commission),
      takerFee: this.safeNum(inst.taker_commission),
    };
  }

  /**
   * Bulk-fetch book summaries for initial quote snapshot.
   *
   * `get_book_summary_by_currency` requires a specific currency string,
   * so we iterate over the unique set of settlement currencies. Timestamp
   * is set to `Date.now()` because `creation_timestamp` on the book summary
   * reflects when the *instrument was created*, not when the quote was produced.
   */
  private async fetchBulkSummaries(currencies: string[]): Promise<void> {
    for (const currency of currencies) {
      try {
        const raw: unknown = await this.rpc.call('public/get_book_summary_by_currency', {
          currency,
          kind: 'option',
        });

        const parsed = z.array(z.unknown()).safeParse(raw);
        if (!parsed.success) {
          log.warn({ currency, error: parsed.error.message }, 'unexpected book summary shape');
          continue;
        }

        let accepted = 0;
        for (const item of parsed.data) {
          const res = DeribitBookSummarySchema.safeParse(item);
          if (!res.success) continue;

          const s: DeribitBookSummary = res.data;
          const quote: LiveQuote = {
            bidPrice: this.safeNum(s.bid_price),
            askPrice: this.safeNum(s.ask_price),
            bidSize: null,
            askSize: null,
            markPrice: this.safeNum(s.mark_price),
            lastPrice: this.safeNum(s.last),
            underlyingPrice: this.safeNum(s.underlying_price),
            indexPrice: null,
            volume24h: this.safeNum(s.volume),
            openInterest: this.safeNum(s.open_interest),
            greeks: {
              ...EMPTY_GREEKS,
              markIv: this.ivToFraction(s.mark_iv),
            },
            // creation_timestamp is the instrument creation time, not a quote time.
            // Use Date.now() so consumers get a meaningful recency signal.
            timestamp: Date.now(),
          };

          this.quoteStore.set(s.instrument_name, quote);
          accepted++;
        }

        log.info({ count: accepted, currency }, 'fetched book summaries');
      } catch (err: unknown) {
        log.warn({ currency, err: String(err) }, 'failed to fetch summaries');
      }
    }
  }

  // ─── WebSocket subscriptions ──────────────────────────────────

  private tickerIntervals = new Map<string, string>();

  protected async subscribeChain(
    underlying: string,
    expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    await this.subscribeWithInterval(underlying, instruments, ACTIVE_TICKER_INTERVAL);
  }

  /**
   * Derive the Deribit index_name from our underlying identifier.
   * "BTC" → "btc_usd"; "BTC_USDC" → "btc_usdc" (already contains the pair).
   */
  private indexNameFor(underlying: string): string {
    return underlying.includes('_')
      ? underlying.toLowerCase()
      : `${underlying.toLowerCase()}_usd`;
  }

  private async subscribeWithInterval(
    underlying: string,
    instruments: CachedInstrument[],
    interval: string,
  ): Promise<void> {
    const bulkChannels: string[] = [];
    const tickerChannels: string[] = [];

    const indexName = this.indexNameFor(underlying);

    if (!this.subscribedIndexes.has(indexName)) {
      bulkChannels.push(`markprice.options.${indexName}`);
      this.subscribedIndexes.add(indexName);
    }

    // deribit_price_index delivers the live spot price for USD conversion.
    // One subscription per index covers all instruments under that underlying.
    if (!this.subscribedPriceIndexes.has(indexName)) {
      bulkChannels.push(`deribit_price_index.${indexName}`);
      this.subscribedPriceIndexes.add(indexName);

      // Build the reverse lookup: index → instruments, for fan-out in handlePriceIndex
      if (!this.indexToInstruments.has(indexName)) {
        const syms = new Set<string>();
        for (const inst of this.instruments) {
          if (this.indexNameFor(inst.base) === indexName) {
            syms.add(inst.exchangeSymbol);
          }
        }
        this.indexToInstruments.set(indexName, syms);
      }
    }

    for (const inst of instruments) {
      const existing = this.tickerIntervals.get(inst.exchangeSymbol);
      if (!existing) {
        tickerChannels.push(`ticker.${inst.exchangeSymbol}.${interval}`);
        this.subscribedTickers.add(inst.exchangeSymbol);
        this.tickerIntervals.set(inst.exchangeSymbol, interval);
      }
    }

    if (bulkChannels.length > 0) {
      await this.rpc.subscribe(bulkChannels);
      log.info({ count: bulkChannels.length, underlying }, 'subscribed to bulk index channels');
    }

    // Batched to respect Deribit's rate limit (~3.3 subscribe calls/sec).
    if (tickerChannels.length > 0) {
      await this.subscribeBatched(tickerChannels);
      log.info({ count: tickerChannels.length, underlying, interval }, 'subscribed to ticker channels');
    }
  }

  /**
   * Subscribe to `channels` in batches of {@link SUBSCRIBE_BATCH_SIZE}, inserting
   * a {@link SUBSCRIBE_BATCH_DELAY_MS} delay between calls to stay within
   * Deribit's sustained rate limit of ~3.3 subscribe calls/sec.
   */
  private async subscribeBatched(channels: string[]): Promise<void> {
    for (let i = 0; i < channels.length; i += SUBSCRIBE_BATCH_SIZE) {
      const batch = channels.slice(i, i + SUBSCRIBE_BATCH_SIZE);
      await this.rpc.subscribe(batch);
      if (i + SUBSCRIBE_BATCH_SIZE < channels.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, SUBSCRIBE_BATCH_DELAY_MS));
      }
    }
  }

  protected async unsubscribeAll(): Promise<void> {
    await this.rpc.unsubscribeAll();
    this.subscribedIndexes.clear();
    this.subscribedPriceIndexes.clear();
    this.subscribedTickers.clear();
    this.tickerIntervals.clear();
  }

  // ─── WS message handlers ─────────────────────────────────────

  /**
   * `markprice.options.{index_name}` — bulk update for all options under an index.
   *
   * Per the official Deribit docs, the payload is always an **array of objects**
   * with shape `{ instrument_name, mark_price, iv, timestamp? }`. There is no
   * legacy array-of-tuples form in the current API.
   */
  private handleMarkPriceOptions(data: unknown): void {
    const parsed = DeribitMarkPriceDataSchema.safeParse(data);
    if (!parsed.success) {
      log.debug({ error: parsed.error.message }, 'markprice.options parse failure');
      return;
    }

    for (const item of parsed.data) {
      const mp: DeribitMarkPriceItem = item;
      const inst = this.instrumentMap.get(mp.instrument_name);
      if (!inst) continue;

      const prev = this.quoteStore.get(mp.instrument_name);
      const hasTicker = this.subscribedTickers.has(mp.instrument_name);

      // Use live index price for underlyingPrice when available, falling back
      // to whatever was stored previously (book summary value at boot).
      const indexName = this.indexNameFor(inst.base);
      const liveUnderlying = this.liveIndexPrices.get(indexName);

      // For instruments without a live ticker subscription, bid/ask are stale
      // from the boot-time book summary. Null them so the enrichment layer
      // falls back to markMid (markPrice × live underlyingPrice) which is 100%
      // correct. Instruments WITH a ticker have live bid/ask — keep them.
      const bidPrice = hasTicker ? (prev?.bidPrice ?? null) : null;
      const askPrice = hasTicker ? (prev?.askPrice ?? null) : null;

      const quote: LiveQuote = {
        bidPrice,
        askPrice,
        bidSize: hasTicker ? (prev?.bidSize ?? null) : null,
        askSize: hasTicker ? (prev?.askSize ?? null) : null,
        markPrice: mp.mark_price,
        lastPrice: prev?.lastPrice ?? null,
        underlyingPrice: liveUnderlying ?? prev?.underlyingPrice ?? null,
        indexPrice: liveUnderlying ?? prev?.indexPrice ?? null,
        volume24h: prev?.volume24h ?? null,
        openInterest: prev?.openInterest ?? null,
        greeks: {
          ...(prev?.greeks ?? EMPTY_GREEKS),
          // markprice.options sends IV as fraction (0.49 = 49%), unlike ticker which sends percentage
          markIv: this.safeNum(mp.iv),
        },
        timestamp: mp.timestamp ?? Date.now(),
      };

      this.emitQuoteUpdate(mp.instrument_name, quote);
    }
  }

  /**
   * `deribit_price_index.{index_name}` — live underlying/index price.
   *
   * Updates ~1s. Stores the latest price so handleMarkPriceOptions can use it
   * for underlyingPrice on the next tick, keeping USD conversions fresh for
   * all instruments without individual ticker subscriptions.
   */
  private handlePriceIndex(data: unknown): void {
    const parsed = DeribitPriceIndexSchema.safeParse(data);
    if (!parsed.success) return;

    this.liveIndexPrices.set(parsed.data.index_name, parsed.data.price);

    // Fan out: update underlyingPrice on all instruments under this index
    // so that normPrice uses the live spot rate immediately, even before
    // the next markprice.options tick arrives.
    const instruments = this.indexToInstruments.get(parsed.data.index_name);
    if (!instruments) return;

    for (const exchangeSymbol of instruments) {
      const prev = this.quoteStore.get(exchangeSymbol);
      if (!prev) continue;

      prev.underlyingPrice = parsed.data.price;
      prev.indexPrice = parsed.data.price;
    }
  }

  /**
   * `ticker.{instrument_name}.100ms` — full ticker with greeks.
   *
   * Contains: `best_bid_price`, `best_ask_price`, `mark_price`, `last_price`,
   * `underlying_price`, `open_interest`, `mark_iv`, `bid_iv`, `ask_iv`,
   * `stats.volume`, and `greeks { delta, gamma, theta, vega, rho }`.
   */
  private handleTicker(channel: string, data: unknown): void {
    const parsed = DeribitTickerSchema.safeParse(data);
    if (!parsed.success) {
      log.debug({ channel, error: parsed.error.message }, 'ticker parse failure');
      return;
    }

    const t: DeribitTicker = parsed.data;
    if (!this.instrumentMap.has(t.instrument_name)) return;

    const g = t.greeks;

    const quote: LiveQuote = {
      bidPrice: this.safeNum(t.best_bid_price),
      askPrice: this.safeNum(t.best_ask_price),
      bidSize: this.safeNum(t.best_bid_amount),
      askSize: this.safeNum(t.best_ask_amount),
      markPrice: this.safeNum(t.mark_price),
      lastPrice: this.safeNum(t.last_price),
      underlyingPrice: this.safeNum(t.underlying_price),
      indexPrice: this.safeNum(t.index_price),
      volume24h: this.safeNum(t.stats?.volume),
      openInterest: this.safeNum(t.open_interest),
      greeks: {
        delta: this.safeNum(g?.delta),
        gamma: this.safeNum(g?.gamma),
        theta: this.safeNum(g?.theta),
        vega: this.safeNum(g?.vega),
        rho: this.safeNum(g?.rho),
        markIv: this.ivToFraction(t.mark_iv),
        bidIv: this.ivToFraction(t.bid_iv),
        askIv: this.ivToFraction(t.ask_iv),
      },
      timestamp: t.timestamp ?? Date.now(),
    };

    this.emitQuoteUpdate(t.instrument_name, quote);
  }

  override async dispose(): Promise<void> {
    await this.rpc?.disconnect();
  }
}
