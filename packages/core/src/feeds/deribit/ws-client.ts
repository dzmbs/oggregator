import { DERIBIT_WS_URL } from '../shared/endpoints.js';
import { JsonRpcWsClient } from '../shared/jsonrpc-client.js';
import { SdkBaseAdapter, type CachedInstrument, type LiveQuote } from '../shared/sdk-base.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import {
  applyDeribitPlatformState,
  createDeribitHealthState,
  deriveDeribitPlatformHealth,
  deriveDeribitPublicStatusHealth,
} from './health.js';
import {
  buildDeribitSubscriptionPlan,
  createDeribitSubscriptionState,
  deribitIndexNameFor,
  releaseDeribitTickerSubscription,
  resetDeribitSubscriptionState,
} from './planner.js';
import {
  parseDeribitBookSummaries,
  parseDeribitInstrument,
  parseDeribitInstrumentState,
  parseDeribitMarkPriceItems,
  parseDeribitPlatformState,
  parseDeribitPriceIndex,
  parseDeribitPublicStatus,
  parseDeribitTicker,
} from './codec.js';
import {
  applyDeribitBookSummary,
  applyDeribitPriceIndex,
  buildDeribitMarkPriceQuote,
  buildDeribitTickerQuote,
  createDeribitState,
  registerDeribitInstrument,
  removeDeribitInstrument,
} from './state.js';

const log = feedLogger('deribit');

// Deribit charges 3k credits per subscribe call regardless of channel count,
// and supports up to 500 channels per call. Batching large keeps call count low.
const SUBSCRIBE_BATCH_SIZE = 500;

// ~3.3 calls/sec sustained (30k credit pool, 3k per call).
const SUBSCRIBE_BATCH_DELAY_MS = 300;

// Eager subscriptions use agg2 (~1s aggregation) to reduce traffic.
// On-demand subscriptions (user viewing a chain) use 100ms for tight updates.
const EAGER_TICKER_INTERVAL = 'agg2';
const ACTIVE_TICKER_INTERVAL = '100ms';
const HEALTH_CHECK_INTERVAL_MS = 60 * 1000;

// At 08:00 UTC daily, Deribit bulk-lists/expires instruments, emitting hundreds
// of `instrument.state` notifications in a burst. Firing a separate
// `public/get_instrument` + `public/subscribe` per event saturates Deribit's
// per-IP rate limit on unauthenticated connections and triggers `over_limit`
// disconnects. We coalesce events arriving within this window into one flush
// that batches fetches (bounded concurrency) and routes opens through a single
// `subscribeWithInterval` call per underlying.
const INSTRUMENT_STATE_COALESCE_MS = 1_000;
const INSTRUMENT_STATE_FETCH_CONCURRENCY = 8;
const INSTRUMENT_STATE_FETCH_CHUNK_DELAY_MS = 250;

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
 *   - `markprice.options.{index_name}` — bulk mark price + IV (~1s) for all options.
 *   - `ticker.{instrument}.{interval}` — full bid/ask + greeks for subscribed chains.
 *   - `instrument.state.option.any` — lifecycle events; used to pick up new
 *     strikes/expiries listed after boot without restarting the server.
 *
 * Deribit is inverse for BTC/ETH: premiums quoted in the base asset.
 * We normalize to USD using underlyingPrice from the live price index.
 *
 * Linear USDC altcoin options (SOL, AVAX, XRP, TRX) quote mark_price per
 * underlying unit. normPrice scales by contractSize to get per-contract USD.
 */
export class DeribitWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'deribit';

  private rpc!: JsonRpcWsClient;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private instrumentStateQueue: unknown[] = [];
  private instrumentStateFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly state = createDeribitState();
  private readonly subscriptions = createDeribitSubscriptionState();
  private readonly health = createDeribitHealthState();

  // All expiries get ticker subscriptions at boot so bid/ask and greeks are
  // live from second one. agg2 (~1s aggregation) keeps traffic manageable.
  // Rate budget: ~4300 instruments ÷ 500/batch = 9 calls × 3000 credits = 27k
  // out of 30k pool (refills at 10k/sec).
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
      resubscribeBatchSize: SUBSCRIBE_BATCH_SIZE,
      resubscribeBatchDelayMs: SUBSCRIBE_BATCH_DELAY_MS,
      onStatusChange: (state) =>
        this.emitStatus(
          state === 'connected' ? 'connected' : state === 'down' ? 'down' : 'reconnecting',
        ),
    });

    this.rpc.onSubscription((channel: string, data: unknown) => {
      if (channel.startsWith('markprice.options.')) {
        this.handleMarkPriceOptions(data);
      } else if (channel.startsWith('deribit_price_index.')) {
        this.handlePriceIndex(data);
      } else if (channel.startsWith('ticker.')) {
        this.handleTicker(channel, data);
      } else if (channel.startsWith('instrument.state.')) {
        this.enqueueInstrumentState(data);
      } else if (channel === 'platform_state') {
        this.handlePlatformState(data);
      }
    });
  }

  // ─── instrument loading ───────────────────────────────────────

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    await this.rpc.connect();

    // `currency: 'any'` fetches all currencies (BTC, ETH, USDC, USDT, EURR) in one call.
    const raw: unknown = await this.rpc.call('public/get_instruments', {
      currency: 'any',
      kind: 'option',
      expired: false,
    });

    if (!Array.isArray(raw)) {
      log.warn('get_instruments returned unexpected shape');
      return [];
    }

    const instruments: CachedInstrument[] = [];
    for (const item of raw) {
      const inst = this.parseInstrument(item);
      if (inst) instruments.push(inst);
    }

    log.info({ count: instruments.length }, 'loaded option instruments');

    // Subscribe to lifecycle and platform health events so listings and
    // maintenance/lock state stay current without polling.
    await this.rpc.subscribe(['instrument.state.option.any', 'platform_state'], 'lifecycle');

    const currencies = [...new Set(instruments.map((i) => i.settle))];
    await this.fetchBulkSummaries(currencies);

    this.healthTimer = setInterval(() => {
      void this.refreshPublicStatus();
    }, HEALTH_CHECK_INTERVAL_MS);
    void this.refreshPublicStatus();

    return instruments;
  }

  /**
   * Parse a raw `get_instruments` / `get_instrument` item into a `CachedInstrument`.
   *
   * strike and option_type come directly from the API response.
   * base and expiry are still parsed from the instrument name since the API
   * doesn't return them as separate fields.
   *
   * Decimal strike notation in the name (e.g. `420d5` → 420.5) is only a
   * display artifact — the API's `strike` field already has the numeric value.
   */
  private parseInstrument(item: unknown): CachedInstrument | null {
    const inst = parseDeribitInstrument(item);
    if (inst == null) {
      log.debug('skipping unparseable instrument');
      return null;
    }
    const parts = inst.instrument_name.match(INSTRUMENT_RE);
    if (!parts) return null;

    const [, base, expiryRaw] = parts as [string, string, string, string, string];

    // Use strike directly from the API; fall back to parsing from the name
    // only if the field is absent (should not happen for current API version).
    const strike =
      inst.strike ??
      (() => {
        const raw = (parts[3] as string).replace('d', '.');
        return Number(raw);
      })();
    if (!Number.isFinite(strike)) return null;

    // option_type from the API ("call"/"put"); fall back to name suffix.
    const right = inst.option_type ?? (parts[4] === 'C' ? 'call' : 'put');

    const expiry = this.parseExpiry(expiryRaw);
    const settle = inst.settlement_currency ?? base;
    const isInverse = inst.instrument_type === 'reversed';

    // quote_currency from the API: "BTC" for inverse BTC, "ETH" for inverse ETH,
    // "USDC" for all linear options. Hardcoding "USD" was always wrong.
    const quote = inst.quote_currency ?? (isInverse ? base : 'USDC');

    return {
      symbol: this.buildCanonicalSymbol(base, settle, expiry, strike, right),
      exchangeSymbol: inst.instrument_name,
      base,
      quote,
      settle,
      expiry,
      expirationTimestamp: this.safeNum(inst.expiration_timestamp),
      strike,
      right,
      inverse: isInverse,
      contractSize: this.safeNum(inst.contract_size) ?? 1,
      contractValueCurrency: base,
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

        const summaries = parseDeribitBookSummaries(raw);
        if (summaries.length === 0) {
          log.warn({ currency }, 'unexpected book summary shape');
          continue;
        }

        let accepted = 0;
        for (const summary of summaries) {
          applyDeribitBookSummary(
            this.quoteStore,
            summary,
            Date.now(),
            this.instrumentMap.get(summary.instrument_name)?.contractSize ?? 1,
            (value) => this.ivToFraction(value),
            (value) => this.safeNum(value),
          );
          accepted++;
        }

        log.info({ count: accepted, currency }, 'fetched book summaries');
      } catch (err: unknown) {
        log.warn({ currency, err: String(err) }, 'failed to fetch summaries');
      }
    }
  }

  // ─── WebSocket subscriptions ──────────────────────────────────

  protected async subscribeChain(
    underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    await this.subscribeWithInterval(underlying, instruments, ACTIVE_TICKER_INTERVAL, 'chain');
  }

  private async subscribeWithInterval(
    underlying: string,
    instruments: CachedInstrument[],
    interval: string,
    source = 'eager',
  ): Promise<void> {
    const plan = buildDeribitSubscriptionPlan(
      this.subscriptions,
      underlying,
      instruments,
      interval,
    );

    if (!this.state.indexToInstruments.has(plan.indexName)) {
      const symbols = new Set<string>();
      for (const inst of this.instruments) {
        if (deribitIndexNameFor(inst.base) === plan.indexName) {
          symbols.add(inst.exchangeSymbol);
        }
      }
      this.state.indexToInstruments.set(plan.indexName, symbols);
    }

    if (plan.bulkChannels.length > 0) {
      await this.rpc.subscribe(plan.bulkChannels, `bulk-${source}`);
      log.info(
        { count: plan.bulkChannels.length, underlying, source },
        'subscribed to bulk index channels',
      );
    }

    if (plan.channelsToUnsubscribe.length > 0) {
      await this.rpc.unsubscribe(plan.channelsToUnsubscribe);
    }

    if (plan.tickerChannels.length > 0) {
      await this.subscribeBatched(plan.tickerChannels, `ticker-${source}`);
      log.info(
        { count: plan.tickerChannels.length, underlying, interval, source },
        'subscribed to ticker channels',
      );
    }
  }

  /**
   * Subscribe to `channels` in batches of {@link SUBSCRIBE_BATCH_SIZE}, inserting
   * a {@link SUBSCRIBE_BATCH_DELAY_MS} delay between calls to stay within
   * Deribit's sustained rate limit of ~3.3 subscribe calls/sec.
   */
  private async subscribeBatched(channels: string[], source: string): Promise<void> {
    for (let i = 0; i < channels.length; i += SUBSCRIBE_BATCH_SIZE) {
      const batch = channels.slice(i, i + SUBSCRIBE_BATCH_SIZE);
      await this.rpc.subscribe(batch, source);
      if (i + SUBSCRIBE_BATCH_SIZE < channels.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, SUBSCRIBE_BATCH_DELAY_MS));
      }
    }
  }

  protected override async unsubscribeChain(
    underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    const channels: string[] = [];

    for (const instrument of instruments) {
      const channel = releaseDeribitTickerSubscription(
        this.subscriptions,
        instrument.exchangeSymbol,
      );
      if (channel != null) {
        channels.push(channel);
      }
    }

    if (this.activeRequestsForUnderlying(underlying) === 0) {
      const indexName = deribitIndexNameFor(underlying);
      if (this.subscriptions.subscribedIndexes.delete(indexName)) {
        channels.push(`markprice.options.${indexName}`);
      }
      if (this.subscriptions.subscribedPriceIndexes.delete(indexName)) {
        channels.push(`deribit_price_index.${indexName}`);
      }
    }

    if (channels.length > 0) {
      await this.rpc.unsubscribe(channels);
    }
  }

  protected async unsubscribeAll(): Promise<void> {
    await this.rpc.unsubscribeAll();
    resetDeribitSubscriptionState(this.subscriptions);
  }

  // ─── normalization override ───────────────────────────────────

  /**
   * Deribit linear USDC altcoin options (SOL, AVAX, XRP, TRX) quote mark_price
   * per underlying unit, not per contract. Scale by contractSize to get the
   * true USD value of one contract.
   *
   * Example: SOL_USDC-...-72-C with underlying ~$82.77
   *   mark_price = 10.78 USDC/SOL (≈ intrinsic: 82.77 - 72 = 10.77)
   *   contractSize = 10 SOL/contract
   *   → usd = 10.78 × 10 = $107.8 per contract ✓
   *
   * BTC_USDC and ETH_USDC have contractSize = 1, so this is a no-op for them.
   * Inverse options (BTC/ETH) fall through to the base implementation.
   */
  protected override normPrice(raw: number | null, inst: CachedInstrument) {
    if (!inst.inverse && (inst.contractSize ?? 1) !== 1) {
      const currency = inst.settle;
      if (raw == null) return { raw: null as null, rawCurrency: currency, usd: null as null };
      return { raw, rawCurrency: currency, usd: raw * (inst.contractSize ?? 1) };
    }
    return super.normPrice(raw, inst);
  }

  // ─── WS message handlers ─────────────────────────────────────

  // `instrument.state.option.any` — lifecycle notifications for options.
  //
  // Raw events are buffered for INSTRUMENT_STATE_COALESCE_MS, then flushed as
  // one batch. At the 08:00 UTC expiry window Deribit emits hundreds of events
  // per second; handling them serially would fire a get_instrument + subscribe
  // RPC per event and instantly trip the per-IP rate limit. The batched flush
  // fetches details with bounded concurrency, registers all new instruments at
  // once, and routes opens through a single subscribeWithInterval per underlying
  // so subscribeBatched controls subscribe cadence.
  private enqueueInstrumentState(data: unknown): void {
    this.instrumentStateQueue.push(data);
    if (this.instrumentStateFlushTimer != null) return;

    this.instrumentStateFlushTimer = setTimeout(() => {
      this.instrumentStateFlushTimer = null;
      void this.flushInstrumentStateQueue();
    }, INSTRUMENT_STATE_COALESCE_MS);
  }

  private async flushInstrumentStateQueue(): Promise<void> {
    const batch = this.instrumentStateQueue.splice(0);
    if (batch.length === 0) return;

    const newInstrumentNames: string[] = [];
    const expiredNames: string[] = [];

    for (const data of batch) {
      const parsed = parseDeribitInstrumentState(data);
      if (parsed == null) continue;

      if (parsed.state === 'open') {
        // Skip if already known (notification can re-fire on reconnect).
        if (this.instrumentMap.has(parsed.instrument_name)) continue;
        newInstrumentNames.push(parsed.instrument_name);
      } else if (parsed.state === 'delivered' || parsed.state === 'archivized') {
        expiredNames.push(parsed.instrument_name);
      }
    }

    if (newInstrumentNames.length > 0) {
      await this.ingestNewInstruments(newInstrumentNames);
    }
    if (expiredNames.length > 0) {
      await this.ingestExpiredInstruments(expiredNames);
    }
  }

  private async ingestNewInstruments(instrumentNames: string[]): Promise<void> {
    const fetched: CachedInstrument[] = [];

    for (let i = 0; i < instrumentNames.length; i += INSTRUMENT_STATE_FETCH_CONCURRENCY) {
      const slice = instrumentNames.slice(i, i + INSTRUMENT_STATE_FETCH_CONCURRENCY);
      const results = await Promise.all(
        slice.map(async (instrument_name): Promise<CachedInstrument | null> => {
          try {
            const raw: unknown = await this.rpc.call('public/get_instrument', { instrument_name });
            return this.parseInstrument(raw);
          } catch (err: unknown) {
            log.warn(
              { instrument_name, err: String(err) },
              'failed to fetch new instrument details',
            );
            return null;
          }
        }),
      );
      for (const inst of results) {
        if (inst != null) fetched.push(inst);
      }
      if (i + INSTRUMENT_STATE_FETCH_CONCURRENCY < instrumentNames.length) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, INSTRUMENT_STATE_FETCH_CHUNK_DELAY_MS),
        );
      }
    }

    if (fetched.length === 0) return;

    for (const inst of fetched) {
      registerDeribitInstrument(
        this.state,
        this.instruments,
        this.instrumentMap,
        this.symbolIndex,
        deribitIndexNameFor(inst.base),
        inst,
      );
    }

    const byUnderlying = new Map<string, CachedInstrument[]>();
    for (const inst of fetched) {
      const list = byUnderlying.get(inst.base) ?? [];
      list.push(inst);
      byUnderlying.set(inst.base, list);
    }

    for (const [underlying, list] of byUnderlying) {
      try {
        await this.subscribeWithInterval(
          underlying,
          list,
          EAGER_TICKER_INTERVAL,
          'instrument-state',
        );
      } catch (err: unknown) {
        log.warn(
          { underlying, count: list.length, err: String(err) },
          'failed to subscribe new instruments',
        );
      }
    }

    log.info(
      { count: fetched.length, requested: instrumentNames.length },
      'added new instruments from instrument.state',
    );
  }

  private async ingestExpiredInstruments(instrumentNames: string[]): Promise<void> {
    const channelsToUnsubscribe: string[] = [];

    for (const instrument_name of instrumentNames) {
      const inst = this.instrumentMap.get(instrument_name);
      if (inst == null) continue;

      removeDeribitInstrument(
        this.state,
        this.instruments,
        this.instrumentMap,
        this.symbolIndex,
        this.quoteStore,
        deribitIndexNameFor(inst.base),
        instrument_name,
      );

      const channel = releaseDeribitTickerSubscription(this.subscriptions, instrument_name);
      if (channel != null) channelsToUnsubscribe.push(channel);
    }

    if (channelsToUnsubscribe.length > 0) {
      try {
        await this.rpc.unsubscribe(channelsToUnsubscribe);
      } catch (err: unknown) {
        log.warn(
          { count: channelsToUnsubscribe.length, err: String(err) },
          'failed to unsubscribe expired instrument channels',
        );
      }
    }

    log.info({ count: instrumentNames.length }, 'removed expired instruments from instrument.state');
  }

  private emitPlatformHealth(): void {
    const health = deriveDeribitPlatformHealth(this.health);
    this.emitStatus(health.status, health.message);
  }

  private async refreshPublicStatus(): Promise<void> {
    try {
      const raw: unknown = await this.rpc.call('public/status', {});
      const parsed = parseDeribitPublicStatus(raw);
      const health = deriveDeribitPublicStatusHealth(this.health, parsed);
      this.emitStatus(health.status, health.message);
    } catch (error: unknown) {
      const health = deriveDeribitPublicStatusHealth(this.health, null, error);
      this.emitStatus(health.status, health.message);
    }
  }

  private handlePlatformState(data: unknown): void {
    const parsed = parseDeribitPlatformState(data);
    if (parsed == null) return;

    applyDeribitPlatformState(this.health, parsed);
    this.emitPlatformHealth();
  }

  /**
   * `markprice.options.{index_name}` — bulk update for all options under an index.
   *
   * Payload is an array of objects: `{ instrument_name, mark_price, iv, timestamp? }`.
   * IV is a fraction (0.49 = 49%), unlike ticker which sends percentage.
   */
  private handleMarkPriceOptions(data: unknown): void {
    const items = parseDeribitMarkPriceItems(data);
    if (items.length === 0) {
      log.debug('markprice.options parse failure');
      return;
    }

    const updates: Array<{ exchangeSymbol: string; quote: LiveQuote }> = [];

    for (const mp of items) {
      const inst = this.instrumentMap.get(mp.instrument_name);
      if (!inst) continue;

      const prev = this.quoteStore.get(mp.instrument_name);
      const hasTicker = this.subscriptions.subscribedTickers.has(mp.instrument_name);

      const indexName = deribitIndexNameFor(inst.base);
      const liveUnderlying = this.state.liveIndexPrices.get(indexName);
      const quote = buildDeribitMarkPriceQuote(mp, prev, liveUnderlying, hasTicker, (value) =>
        this.safeNum(value),
      );

      updates.push({ exchangeSymbol: mp.instrument_name, quote });
    }

    this.emitQuoteUpdates(updates);
  }

  // deribit_price_index pushes the live spot price (~1s). Stored so
  // handleMarkPriceOptions uses it for underlyingPrice on the next tick.
  private handlePriceIndex(data: unknown): void {
    const parsed = parseDeribitPriceIndex(data);
    if (parsed == null) return;

    const updates = applyDeribitPriceIndex(
      this.state,
      this.quoteStore,
      parsed.index_name,
      parsed.price,
      parsed.timestamp ?? Date.now(),
    );

    this.emitQuoteUpdates(updates);
  }

  /**
   * `ticker.{instrument_name}.100ms` — full ticker with greeks.
   *
   * Contains: `best_bid_price`, `best_ask_price`, `mark_price`, `last_price`,
   * `underlying_price`, `open_interest`, `mark_iv`, `bid_iv`, `ask_iv`,
   * `stats.volume`, and `greeks { delta, gamma, theta, vega, rho }`.
   *
   * mark_iv, bid_iv, ask_iv are in percentage (70.11 = 70.11% IV).
   */
  private handleTicker(channel: string, data: unknown): void {
    const ticker = parseDeribitTicker(data);
    if (ticker == null) {
      log.debug({ channel }, 'ticker parse failure');
      return;
    }

    if (!this.instrumentMap.has(ticker.instrument_name)) return;

    const quote = buildDeribitTickerQuote(
      ticker,
      this.instrumentMap.get(ticker.instrument_name)?.contractSize ?? 1,
      (value) => this.safeNum(value),
      (value) => this.ivToFraction(value),
    );

    this.emitQuoteUpdate(ticker.instrument_name, quote);
  }

  override async dispose(): Promise<void> {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.instrumentStateFlushTimer != null) {
      clearTimeout(this.instrumentStateFlushTimer);
      this.instrumentStateFlushTimer = null;
    }
    this.instrumentStateQueue.length = 0;
    await this.unsubscribeAll();
    await this.rpc?.disconnect();
  }
}
