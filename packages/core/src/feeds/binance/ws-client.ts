import {
  BINANCE_EXCHANGE_INFO,
  BINANCE_MARK_WS_URL,
  BINANCE_REST_BASE_URL,
  BINANCE_TICKER,
  BINANCE_TIME,
} from '../shared/endpoints.js';
import { SdkBaseAdapter, type CachedInstrument, type LiveQuote } from '../shared/sdk-base.js';
import { TopicWsClient } from '../shared/topic-ws-client.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import {
  parseBinanceCombinedStream,
  parseBinanceHealthExchangeInfo,
  parseBinanceHealthTime,
  parseBinanceInstrument,
  parseBinanceMarkPrice,
  parseBinanceNewSymbol,
  parseBinanceOiEvent,
  parseBinanceRestTicker,
} from './codec.js';
import { deriveBinanceHealth } from './health.js';
import {
  buildBinanceChainStreams,
  buildBinanceInitialStreams,
  confirmBinanceSubscribedStreams,
  createBinanceSubscriptionState,
  removeBinanceTrackedStreams,
  resetBinanceSubscriptionState,
  rollbackBinancePendingStreams,
  trackBinanceStreams,
} from './planner.js';
import {
  buildBinanceMarkPriceQuote,
  buildBinanceNewInstrument,
  buildBinanceOiStreams,
  mergeBinanceOiEvent,
  mergeBinanceRestOpenInterest,
  mergeBinanceRestTicker,
  BINANCE_DEFAULT_MAKER_FEE,
  BINANCE_DEFAULT_TAKER_FEE,
} from './state.js';

const log = feedLogger('binance');

// Volume and lastPrice are not in the WS stream — refresh from REST on this interval.
const TICKER_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const HEALTH_CHECK_INTERVAL_MS = 60 * 1000;

/**
 * Binance European Options (EAPI) adapter.
 *
 * REST (boot only):
 *   GET /eapi/v1/exchangeInfo  — instrument catalog
 *   GET /eapi/v1/ticker        — initial volume + lastPrice snapshot
 *   GET /eapi/v1/openInterest  — initial OI snapshot per base/expiry
 *
 * WebSocket (all on wss://fstream.binance.com/market/stream):
 *   {underlying}@optionMarkPrice — mark price, bid/ask, IV, greeks (1s)
 *   {underlying}@openInterest@{expiry} — OI per expiry (60s)
 *   !optionSymbol — new instrument listings (50ms); replaces polling
 *
 * Binance sends a WS-level ping every 5 minutes — we must pong within 15 minutes.
 * Connections are forcibly closed at 24 hours; on reconnect we re-fetch exchangeInfo
 * to pick up any instruments listed during the disconnect window.
 */
export class BinanceWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'binance';

  // optionMarkPrice is a bulk per-underlying stream covering all options.
  // No per-expiry eager subscription needed.
  protected override eagerExpiryCount = 0;

  private wsClient: TopicWsClient | null = null;
  private tickerRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private msgId = 0;
  private hasConnectedOnce = false;
  private readonly subscriptions = createBinanceSubscriptionState();
  private readonly pendingSubscribeById = new Map<number, string[]>();

  protected initClients(): void {}

  // ── instrument loading ────────────────────────────────────────

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    const instruments: CachedInstrument[] = [];

    const eapiInfo = await this.fetchEapi(BINANCE_EXCHANGE_INFO);
    const info = parseBinanceHealthExchangeInfo(eapiInfo);
    const symbols: unknown[] = info?.optionSymbols ?? info?.symbols ?? [];

    for (const sym of symbols) {
      const inst = this.parseInstrument(sym);
      if (inst) instruments.push(inst);
    }

    log.info({ count: instruments.length }, 'loaded option instruments');

    await this.connectAndSubscribe(instruments);
    await this.waitForFirstData();

    await this.fetchTickerSnapshot(instruments);

    // Refresh volume + lastPrice periodically — WS stream doesn't carry either.
    this.tickerRefreshTimer = setInterval(
      () => { void this.fetchTickerSnapshot(this.instruments); },
      TICKER_REFRESH_INTERVAL_MS,
    );
    this.healthCheckTimer = setInterval(() => { void this.runHealthCheck(); }, HEALTH_CHECK_INTERVAL_MS);
    void this.runHealthCheck();

    return instruments;
  }

  private parseInstrument(item: unknown): CachedInstrument | null {
    const parsed = parseBinanceInstrument(item);
    if (parsed == null) return null;

    const { symbol: sym, status, quoteAsset, unit, minQty, filters } = parsed;
    if (status && status !== 'TRADING') return null;

    // Symbol format: BTC-YYMMDD-STRIKE-C/P
    const parts = sym.match(/^(\w+)-(\d{6})-([\d.]+)-([CP])$/);
    if (!parts) return null;

    const base = parts[1]!;
    const settle = quoteAsset ?? 'USDT';

    // Use API fields when present — more reliable than parsing the symbol name.
    const right = parsed.side === 'CALL' ? 'call' as const
      : parsed.side === 'PUT'  ? 'put'  as const
      : (parts[4] === 'C'      ? 'call' as const : 'put' as const);

    const strike = parsed.strikePrice != null
      ? Number(parsed.strikePrice)
      : Number(parts[3]);

    const expiry = parsed.expiryDate != null
      ? new Date(parsed.expiryDate).toISOString().slice(0, 10)
      : this.parseExpiry(parts[2]!);

    const priceFilter = filters?.find(f => f.filterType === 'PRICE_FILTER');

    return {
      symbol: this.buildCanonicalSymbol(base, settle, expiry, strike, right),
      exchangeSymbol: sym,
      base,
      quote: settle,
      settle,
      expiry,
      strike,
      right,
      inverse: false,
      contractSize: this.safeNum(unit) ?? 1,
      contractValueCurrency: base,
      tickSize: this.safeNum(priceFilter?.tickSize),
      minQty: this.safeNum(minQty),
      makerFee: BINANCE_DEFAULT_MAKER_FEE,
      takerFee: BINANCE_DEFAULT_TAKER_FEE,
    };
  }

  private waitForFirstData(): Promise<void> {
    const target = new Set(
      [
        ...this.subscriptions.subscribedStreams,
        ...this.subscriptions.pendingSubscribeStreams,
      ]
        .filter((stream) => stream.endsWith('@optionMarkPrice'))
        .map((stream) => stream.split('@')[0]!),
    ).size;
    const seen = new Set<string>();

    return new Promise((resolve) => {
      const check = setInterval(() => {
        for (const key of this.quoteStore.keys()) {
          seen.add(key.split('-')[0]!.toLowerCase());
        }
        if (seen.size >= target) {
          clearInterval(check);
          log.info({ quotes: this.quoteStore.size, underlyings: seen.size }, 'initial data received');
          resolve();
        }
      }, 200);
      setTimeout(() => { clearInterval(check); resolve(); }, 10_000);
    });
  }

  // ── WebSocket ─────────────────────────────────────────────────

  private async connectAndSubscribe(instruments: CachedInstrument[]): Promise<void> {
    const streams = buildBinanceInitialStreams(instruments);

    await this.connectWs();

    const newStreams = trackBinanceStreams(this.subscriptions, streams);
    this.sendSubscribe(newStreams);
  }

  private connectWs(): Promise<void> {
    if (this.wsClient == null) {
      this.wsClient = new TopicWsClient(BINANCE_MARK_WS_URL, 'binance-ws', {
        onStatusChange: (state) => {
          this.emitStatus(state === 'connected' ? 'connected' : state === 'down' ? 'down' : 'reconnecting');
        },
        onSocket: (socket) => {
          socket.on('ping', () => {
            socket.pong();
          });
        },
        getReplayMessages: () => {
          const replayStreams = [
            ...this.subscriptions.subscribedStreams,
            ...this.subscriptions.pendingSubscribeStreams,
          ];
          if (replayStreams.length === 0) return [];

          const id = ++this.msgId;
          this.pendingSubscribeById.set(id, replayStreams);
          return [{ method: 'SUBSCRIBE', params: replayStreams, id }];
        },
        onMessage: (raw) => {
          try {
            this.handleWsMessage(JSON.parse(raw.toString()));
          } catch (error: unknown) {
            log.debug({ err: String(error) }, 'malformed WS frame');
          }
        },
        onOpen: () => {
          if (!this.hasConnectedOnce) {
            this.hasConnectedOnce = true;
            return;
          }

          void this.refreshInstrumentsFromExchangeInfo();
        },
      });
    }

    return this.wsClient.connect();
  }

  private sendSubscribe(streams: string[]): void {
    if (streams.length === 0) return;

    const id = ++this.msgId;
    this.pendingSubscribeById.set(id, streams);
    this.wsClient?.send({ method: 'SUBSCRIBE', params: streams, id });
    log.info({ count: streams.length, id }, 'requested stream subscribe');
  }

  /**
   * On reconnect after a 24-hour forced disconnect, diff exchangeInfo against
   * our current map and add anything new. Short gaps are already covered by
   * !optionSymbol; this handles the disconnect window itself.
   */
  private async refreshInstrumentsFromExchangeInfo(): Promise<void> {
    try {
      this.sweepExpiredState();
      const eapiInfo = await this.fetchEapi(BINANCE_EXCHANGE_INFO);
      const info = parseBinanceHealthExchangeInfo(eapiInfo);
      const symbols: unknown[] = info?.optionSymbols ?? [];

      const newInstruments: CachedInstrument[] = [];
      for (const sym of symbols) {
        const inst = this.parseInstrument(sym);
        if (!inst || this.instrumentMap.has(inst.exchangeSymbol)) continue;
        newInstruments.push(inst);
      }

      if (newInstruments.length === 0) return;

      const newOiStreams: string[] = [];
      for (const inst of newInstruments) {
        this.instruments.push(inst);
        this.instrumentMap.set(inst.exchangeSymbol, inst);
        this.symbolIndex.set(inst.symbol, inst.exchangeSymbol);

        const oiStreams = buildBinanceOiStreams([inst]);
        for (const s of oiStreams) {
          if (!this.subscriptions.subscribedStreams.has(s)) {
            this.subscriptions.subscribedStreams.add(s);
            newOiStreams.push(s);
          }
        }
      }

      if (newOiStreams.length > 0) this.sendSubscribe(newOiStreams);
      log.info({ count: newInstruments.length }, 'added instruments from reconnect refresh');
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'reconnect instrument refresh failed');
    }
  }

  // ── subscriptions ─────────────────────────────────────────────

  protected async subscribeChain(
    underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    const streams = buildBinanceChainStreams(underlying, instruments);
    const newStreams = trackBinanceStreams(this.subscriptions, streams);

    if (newStreams.length > 0) this.sendSubscribe(newStreams);
  }

  protected override async unsubscribeChain(
    underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    if (!this.wsClient?.isConnected) return;

    const streams = buildBinanceOiStreams(instruments);
    if (this.activeRequestsForUnderlying(underlying) === 0) {
      streams.unshift(`${underlying.toLowerCase()}usdt@optionMarkPrice`);
    }

    const removedStreams = streams.filter(
      (stream) => this.subscriptions.subscribedStreams.has(stream) || this.subscriptions.pendingSubscribeStreams.has(stream),
    );
    if (removedStreams.length === 0) return;

    const ackedStreams = removedStreams.filter((stream) => this.subscriptions.subscribedStreams.has(stream));
    if (ackedStreams.length > 0) {
      this.wsClient.send({ method: 'UNSUBSCRIBE', params: ackedStreams, id: ++this.msgId });
    }
    removeBinanceTrackedStreams(this.subscriptions, removedStreams);
  }

  protected async unsubscribeAll(): Promise<void> {
    const ackedStreams = [...this.subscriptions.subscribedStreams];
    if (this.wsClient?.isConnected && ackedStreams.length > 0) {
      this.wsClient.send({ method: 'UNSUBSCRIBE', params: ackedStreams, id: ++this.msgId });
    }
    this.pendingSubscribeById.clear();
    resetBinanceSubscriptionState(this.subscriptions);
  }

  // ── WS message handling ───────────────────────────────────────

  private handleControlMessage(msg: unknown): boolean {
    if (msg == null || typeof msg !== 'object' || Array.isArray(msg)) return false;

    const record = msg as Record<string, unknown>;
    const id = typeof record['id'] === 'number' ? record['id'] : null;
    if (record['result'] === null && id != null) {
      const streams = this.pendingSubscribeById.get(id);
      if (streams != null) {
        confirmBinanceSubscribedStreams(this.subscriptions, streams);
        this.pendingSubscribeById.delete(id);
      }
      return true;
    }

    if (typeof record['code'] === 'number' && typeof record['msg'] === 'string') {
      const streams = id != null
        ? this.pendingSubscribeById.get(id) ?? []
        : [...this.subscriptions.pendingSubscribeStreams];
      if (streams.length > 0) {
        rollbackBinancePendingStreams(this.subscriptions, streams);
      }
      if (id != null) {
        this.pendingSubscribeById.delete(id);
      } else {
        this.pendingSubscribeById.clear();
      }
      log.warn({ code: record['code'], message: record['msg'], id, count: streams.length }, 'stream subscribe rejected');
      return true;
    }

    return false;
  }

  private handleWsMessage(msg: unknown): void {
    if (this.handleControlMessage(msg)) return;

    const envelope = parseBinanceCombinedStream(msg);
    if (envelope == null) return;

    const { stream, data } = envelope;

    if (stream === '!optionSymbol') {
      for (const item of data) this.handleNewSymbol(item);
      return;
    }

    if (stream.includes('@openInterest@')) {
      this.handleOiEventBatch(Array.isArray(data) ? data : []);
      return;
    }

    if (stream.includes('@optionMarkPrice')) {
      this.handleMarkPriceBatch(Array.isArray(data) ? data : []);
    }
  }

  private handleMarkPriceBatch(rawItems: unknown[]): void {
    const updates: Array<{ exchangeSymbol: string; quote: LiveQuote }> = [];

    for (const rawItem of rawItems) {
      const item = parseBinanceMarkPrice(rawItem);
      if (item == null) continue;

      const exchangeSymbol = item.s;
      const previous = this.quoteStore.get(exchangeSymbol);
      const quote = buildBinanceMarkPriceQuote(
        item,
        previous,
        (value) => this.binancePositiveOrNull(value),
        (value) => this.safeNum(value),
      );

      if (!this.instrumentMap.has(exchangeSymbol)) {
        this.quoteStore.set(exchangeSymbol, quote);
        continue;
      }

      updates.push({ exchangeSymbol, quote });
    }

    this.emitQuoteUpdates(updates);
  }

  /**
   * !optionSymbol stream — new instrument listed on Binance at 50ms.
   * Adds the instrument to all maps and subscribes its OI stream.
   */
  private handleNewSymbol(raw: unknown): void {
    const d = parseBinanceNewSymbol(raw);
    if (d == null) return;
    if (d.cs && d.cs !== 'TRADING') return;
    if (this.instrumentMap.has(d.s)) return;

    const parts = d.s.match(/^(\w+)-(\d{6})-([\d.]+)-([CP])$/);
    if (!parts) return;

    const base   = parts[1]!;
    const settle = d.qa;
    const right  = d.d === 'CALL' ? 'call' as const : 'put' as const;
    const strike = Number(d.sp);
    const expiry = new Date(d.dt).toISOString().slice(0, 10);

    const inst = buildBinanceNewInstrument(
      {
        symbol: d.s,
        base,
        settle,
        expiry,
        strike,
        right,
        unit: d.u ?? null,
      },
      (nextBase, nextSettle, nextExpiry, nextStrike, nextRight) =>
        this.buildCanonicalSymbol(nextBase, nextSettle, nextExpiry, nextStrike, nextRight),
    );

    this.instruments.push(inst);
    this.instrumentMap.set(inst.exchangeSymbol, inst);
    this.symbolIndex.set(inst.symbol, inst.exchangeSymbol);

    // Subscribe OI stream for this instrument's expiry if not already tracked.
    const oiStreams = trackBinanceStreams(
      this.subscriptions,
      buildBinanceOiStreams([inst]),
    );
    if (oiStreams.length > 0) this.sendSubscribe(oiStreams);

    log.info({ symbol: d.s }, 'added new instrument from !optionSymbol');
  }

  // underlying@openInterest@YYMMDD — updates every 60s
  private handleOiEventBatch(rawItems: unknown[]): void {
    const updates: Array<{ exchangeSymbol: string; quote: LiveQuote }> = [];

    for (const raw of rawItems) {
      const parsed = parseBinanceOiEvent(raw);
      if (parsed == null) continue;

      const prev = this.quoteStore.get(parsed.s);
      if (!prev) continue;

      updates.push({
        exchangeSymbol: parsed.s,
        quote: mergeBinanceOiEvent(prev, parsed, (value) => this.safeNum(value)),
      });
    }

    this.emitQuoteUpdates(updates);
  }

  // ── REST supplement ───────────────────────────────────────────

  /**
   * Fetch volume + lastPrice from REST ticker and OI from REST openInterest.
   * Called at boot and every 5 minutes for volume (WS stream carries neither).
   * OI is seeded here once; the WS openInterest stream keeps it current after.
   */
  private async fetchTickerSnapshot(instruments: CachedInstrument[]): Promise<void> {
    this.sweepExpiredState();

    try {
      const raw = await this.fetchEapi(BINANCE_TICKER);
      if (!Array.isArray(raw)) return;

      let merged = 0;
      for (const item of raw) {
        const ticker = parseBinanceRestTicker(item);
        if (ticker == null) continue;
        const prev = this.quoteStore.get(ticker.symbol);
        if (!prev) continue;

        this.emitQuoteUpdate(ticker.symbol, mergeBinanceRestTicker(prev, ticker, (value) => this.safeNum(value)));
        merged++;
      }
      log.info({ count: merged }, 'refreshed volume + lastPrice from ticker');
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'ticker snapshot failed');
    }

    // OI REST call only on first run — WS openInterest streams keep it updated.
    if (this.quoteStore.size > 0 && [...this.quoteStore.values()].some(q => q.openInterest != null)) return;

    const oiPairs = new Set<string>();
    for (const inst of instruments) {
      const match = inst.exchangeSymbol.match(/-(\d{6})-/);
      if (match) oiPairs.add(`${inst.base}:${match[1]}`);
    }

    for (const pair of oiPairs) {
      const [base, expiry] = pair.split(':');
      if (!base || !expiry) continue;
      try {
        const raw = await this.fetchEapi(`/eapi/v1/openInterest?underlyingAsset=${base}&expiration=${expiry}`);
        if (!Array.isArray(raw)) continue;
        for (const item of raw) {
          const t = item as { symbol?: string; sumOpenInterest?: string; sumOpenInterestUsd?: string };
          if (typeof t.symbol !== 'string') continue;
          const prev = this.quoteStore.get(t.symbol);
          if (prev) {
            this.emitQuoteUpdate(
              t.symbol,
              mergeBinanceRestOpenInterest(prev, t, (value) => this.safeNum(value)),
            );
          }
        }
      } catch (err: unknown) {
        log.warn({ base, expiry, err: String(err) }, 'OI fetch failed');
      }
    }
  }

  private async runHealthCheck(): Promise<void> {
    try {
      const [serverTimeRaw, exchangeInfoRaw] = await Promise.all([
        this.fetchEapi(BINANCE_TIME),
        this.fetchEapi(BINANCE_EXCHANGE_INFO),
      ]);

      const health = deriveBinanceHealth(
        parseBinanceHealthTime(serverTimeRaw),
        parseBinanceHealthExchangeInfo(exchangeInfoRaw),
      );
      this.emitStatus(health.status, health.message);
    } catch (error: unknown) {
      const health = deriveBinanceHealth(null, null, error);
      this.emitStatus(health.status, health.message);
    }
  }

  // ── helpers ───────────────────────────────────────────────────

  private async fetchEapi(path: string): Promise<unknown> {
    const res = await fetch(`${BINANCE_REST_BASE_URL}${path}`);
    if (!res.ok) throw new Error(`Binance EAPI ${path} returned ${res.status}`);
    return res.json() as Promise<unknown>;
  }

  /** Treats "0.000" and negative values as null — Binance uses these for empty/unavailable. */
  private binancePositiveOrNull(val: string | undefined): number | null {
    const n = this.safeNum(val);
    return n != null && n > 0 ? n : null;
  }

  private sweepExpiredState(): void {
    const removed = this.sweepExpiredInstruments();
    if (removed.length === 0) return;

    removeBinanceTrackedStreams(this.subscriptions, buildBinanceInitialStreams(removed));
    log.info({ count: removed.length }, 'removed expired instruments');
  }

  override async dispose(): Promise<void> {
    if (this.tickerRefreshTimer) { clearInterval(this.tickerRefreshTimer); this.tickerRefreshTimer = null; }
    if (this.healthCheckTimer) { clearInterval(this.healthCheckTimer); this.healthCheckTimer = null; }
    await this.unsubscribeAll();
    await this.wsClient?.disconnect();
    this.wsClient = null;
    this.hasConnectedOnce = false;
  }
}
