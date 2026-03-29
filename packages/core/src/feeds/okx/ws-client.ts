import WebSocket from 'ws';
import {
  OKX_INSTRUMENTS,
  OKX_MARK_PRICE,
  OKX_OPEN_INTEREST,
  OKX_OPT_SUMMARY,
  OKX_REST_BASE_URL,
  OKX_TICKERS,
  OKX_WS_URL,
} from '../shared/endpoints.js';
import { SdkBaseAdapter, type CachedInstrument, type LiveQuote } from '../shared/sdk-base.js';
import { TopicWsClient } from '../shared/topic-ws-client.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import {
  parseOkxInstrument,
  parseOkxMarkPrice,
  parseOkxOptSummary,
  parseOkxRestResponse,
  parseOkxTicker,
  parseOkxWsInstrumentsMsg,
  parseOkxWsMarkPriceMsg,
  parseOkxWsNotice,
  parseOkxWsOptSummaryMsg,
  parseOkxWsStatusMsg,
  parseOkxWsTickerMsg,
} from './codec.js';
import { deriveOkxNoticeHealth, deriveOkxStatusHealth } from './health.js';
import {
  buildOkxChainSubscriptionArgs,
  buildOkxInstrumentSubscriptionArgs,
  buildOkxReplayArgs,
  buildOkxUnsubscribeArgs,
  createOkxSubscriptionState,
  removeOkxSubscribedInstruments,
  resetOkxSubscriptionState,
} from './planner.js';
import {
  buildOkxTickerQuote,
  mergeOkxMarkPrice,
  mergeOkxOptSummary,
  mergeOkxRestMarkPrice,
  mergeOkxRestOpenInterest,
  mergeOkxWsTicker,
} from './state.js';
import { OKX_OPTION_SYMBOL_RE, type OkxInstrument, type OkxMarkPrice, type OkxOptSummary, type OkxTicker } from './types.js';

const log = feedLogger('okx');

// OKX options don't expose per-instrument fees via public API
const OKX_DEFAULT_MAKER_FEE = 0.0002;
const OKX_DEFAULT_TAKER_FEE = 0.0005;

// OKX closes idle connections after 30s — ping well within that window
const OKX_PING_INTERVAL_MS = 25_000;

// OI and mark price are not available from WS bulk channels — refresh from REST.
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// OKX option families with active contracts (confirmed live 2026-03-28).
// BTC-USDC / ETH-USDC return code 51000 — no options listed there.
const INST_FAMILIES = ['BTC-USD', 'ETH-USD'] as const;

/**
 * OKX options adapter using raw WebSocket + fetch.
 *
 * REST (boot + periodic refresh):
 *   GET /api/v5/public/instruments?instType=OPTION&instFamily=X  — instrument catalog
 *   GET /api/v5/market/tickers?instType=OPTION&instFamily=X      — initial bid/ask snapshot
 *   GET /api/v5/public/opt-summary?instFamily=X                  — initial greeks snapshot
 *   GET /api/v5/public/open-interest?instType=OPTION&instFamily=X — OI (refreshed every 5 min)
 *   GET /api/v5/public/mark-price?instType=OPTION&instFamily=X   — mark price (refreshed every 5 min)
 *
 * WebSocket (wss://ws.okx.com:8443/ws/v5/public):
 *   opt-summary (instFamily)  — bulk greeks + IV for all options, no mark price
 *   tickers (per instId)      — bid/ask/last/volume; instFamily not supported for OPTION
 *   mark-price (per instId)   — live mark price for actively viewed chains (~1s)
 *   instruments (instType)    — new listing / state change notifications
 *
 * OKX ping: send text "ping" every 25s (server drops idle connections after 30s).
 * Subscribe rate limit: 480 JSON messages/hr/connection — batching is critical.
 */
export class OkxWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'okx';

  // opt-summary is already bulk for greeks; limit eager subscription to 1 nearest expiry.
  protected override eagerExpiryCount = 1;

  private wsClient: TopicWsClient | null = null;
  private refreshTimers: ReturnType<typeof setInterval>[] = [];
  private readonly subscriptions = createOkxSubscriptionState();

  protected initClients(): void {}

  // ── instrument loading ────────────────────────────────────────

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    const instruments: CachedInstrument[] = [];

    for (const instFamily of INST_FAMILIES) {
      try {
        const data = await this.fetchOkxApi(OKX_INSTRUMENTS, { instType: 'OPTION', instFamily });
        for (const raw of data) {
          const parsed = parseOkxInstrument(raw);
          if (parsed == null) continue;
          const inst = this.parseInstrument(parsed);
          if (inst) instruments.push(inst);
        }
      } catch (err: unknown) {
        log.warn({ instFamily, err: String(err) }, 'failed to load instruments');
      }
    }

    log.info({ count: instruments.length }, 'loaded option instruments');

    await this.fetchBulkSnapshot();

    // Refresh OI and mark price in the background — no WS bulk channel for either.
    this.refreshTimers.push(
      setInterval(() => { void this.refreshOi(); }, REFRESH_INTERVAL_MS),
      setInterval(() => { void this.refreshMarkPrice(); }, REFRESH_INTERVAL_MS),
    );

    return instruments;
  }

  private parseInstrument(item: OkxInstrument): CachedInstrument | null {
    const match = OKX_OPTION_SYMBOL_RE.exec(item.instId);
    if (!match) return null;

    const base = match[1]!;
    const expiryRaw = match[3]!;
    const expiry = this.parseExpiry(expiryRaw);
    const settle = item.settleCcy ?? base;

    // Use API fields directly — more reliable than regex-parsing the instId string.
    const right = item.optType === 'C' ? 'call' as const
      : item.optType === 'P' ? 'put'  as const
      : (match[5] === 'C'   ? 'call' as const : 'put' as const);

    const strike = item.stk != null ? Number(item.stk) : Number(match[4]);

    return {
      symbol: this.buildCanonicalSymbol(base, settle, expiry, strike, right),
      exchangeSymbol: item.instId,
      base,
      quote: 'USD',
      settle,
      expiry,
      strike,
      right,
      inverse: settle === base,
      contractSize: this.safeNum(item.ctMult) ?? this.safeNum(item.ctVal) ?? 1,
      contractValueCurrency: item.ctValCcy ?? settle,
      tickSize: this.safeNum(item.tickSz),
      minQty: this.safeNum(item.minSz),
      makerFee: OKX_DEFAULT_MAKER_FEE,
      takerFee: OKX_DEFAULT_TAKER_FEE,
    };
  }

  // ── REST snapshots ────────────────────────────────────────────

  private async fetchBulkSnapshot(): Promise<void> {
    for (const instFamily of INST_FAMILIES) {
      await this.fetchTickerSnapshot(instFamily);
      await this.fetchOptSummarySnapshot(instFamily);
      await this.fetchOiSnapshot(instFamily);
      await this.fetchMarkPriceSnapshot(instFamily);
    }
  }

  private async fetchTickerSnapshot(instFamily: string): Promise<void> {
    try {
      const data = await this.fetchOkxApi(OKX_TICKERS, { instType: 'OPTION', instFamily });
      for (const raw of data) {
        const parsed = parseOkxTicker(raw);
        if (parsed == null) continue;
        this.quoteStore.set(parsed.instId, this.tickerToQuote(parsed));
      }
      log.info({ count: data.length, instFamily }, 'fetched tickers');
    } catch (err: unknown) {
      log.warn({ instFamily, err: String(err) }, 'failed to fetch tickers');
    }
  }

  private async fetchOptSummarySnapshot(instFamily: string): Promise<void> {
    try {
      const data = await this.fetchOkxApi(OKX_OPT_SUMMARY, { instFamily });
      for (const raw of data) {
        const parsed = parseOkxOptSummary(raw);
        if (parsed == null) continue;
        this.mergeOptSummary(parsed);
      }
      log.info({ count: data.length, instFamily }, 'fetched greeks');
    } catch (err: unknown) {
      log.warn({ instFamily, err: String(err) }, 'failed to fetch greeks');
    }
  }

  private async fetchOiSnapshot(instFamily: string): Promise<void> {
    try {
      const data = await this.fetchOkxApi(OKX_OPEN_INTEREST, { instType: 'OPTION', instFamily });
      let merged = 0;
      for (const raw of data) {
        const item = raw as { instId?: string; oi?: string; oiCcy?: string; oiUsd?: string };
        if (typeof item.instId !== 'string') continue;
        const prev = this.quoteStore.get(item.instId);
        if (!prev) continue;

        this.emitQuoteUpdate(item.instId, mergeOkxRestOpenInterest(prev, item, (value) => this.safeNum(value)));
        merged++;
      }
      log.info({ count: merged, instFamily }, 'fetched open interest');
    } catch (err: unknown) {
      log.warn({ instFamily, err: String(err) }, 'failed to fetch OI');
    }
  }

  private async fetchMarkPriceSnapshot(instFamily: string): Promise<void> {
    try {
      const data = await this.fetchOkxApi(OKX_MARK_PRICE, { instType: 'OPTION', instFamily });
      let merged = 0;
      for (const raw of data) {
        const parsed = parseOkxMarkPrice(raw);
        if (parsed == null) continue;
        const prev = this.quoteStore.get(parsed.instId);
        if (!prev) continue;

        this.emitQuoteUpdate(parsed.instId, mergeOkxRestMarkPrice(prev, parsed, (value) => this.safeNum(value)));
        merged++;
      }
      log.info({ count: merged, instFamily }, 'fetched mark prices');
    } catch (err: unknown) {
      log.warn({ instFamily, err: String(err) }, 'failed to fetch mark prices');
    }
  }

  // Periodic REST refresh — called every 5 minutes via setInterval.
  private async refreshOi(): Promise<void> {
    this.sweepExpiredState();
    for (const instFamily of INST_FAMILIES) await this.fetchOiSnapshot(instFamily);
  }

  private async refreshMarkPrice(): Promise<void> {
    this.sweepExpiredState();
    for (const instFamily of INST_FAMILIES) await this.fetchMarkPriceSnapshot(instFamily);
  }

  // ── WebSocket connection ──────────────────────────────────────

  protected async subscribeChain(
    underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    await this.ensureConnected();

    const args = buildOkxChainSubscriptionArgs(this.subscriptions, underlying, instruments);

    if (args.length > 0) {
      this.sendSubscribeBatched(args);
      log.info({ count: args.length, underlying }, 'subscribed to channels');
    }
  }

  protected override async unsubscribeChain(
    underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    if (!this.wsClient?.isConnected) return;

    const args: object[] = [];
    for (const instrument of instruments) {
      if (this.subscriptions.subscribedTickers.has(instrument.exchangeSymbol)) {
        args.push({ channel: 'tickers', instId: instrument.exchangeSymbol });
      }
      if (this.subscriptions.subscribedMarkPrice.has(instrument.exchangeSymbol)) {
        args.push({ channel: 'mark-price', instId: instrument.exchangeSymbol });
      }
    }

    if (this.activeRequestsForUnderlying(underlying) === 0) {
      const family = `${underlying}-USD`;
      if (this.subscriptions.subscribedFamilies.has(family)) {
        args.push({ channel: 'opt-summary', instFamily: family });
        this.subscriptions.subscribedFamilies.delete(family);
      }
    }

    if (args.length === 0) return;

    this.sendSubscribeBatched(args, 'unsubscribe');
    removeOkxSubscribedInstruments(this.subscriptions, instruments.map((instrument) => instrument.exchangeSymbol));
  }

  protected async unsubscribeAll(): Promise<void> {
    if (!this.wsClient?.isConnected) return;

    const args = buildOkxUnsubscribeArgs(this.subscriptions);

    if (args.length > 0) this.sendSubscribeBatched(args, 'unsubscribe');

    resetOkxSubscriptionState(this.subscriptions);
  }

  private async ensureConnected(): Promise<void> {
    if (this.wsClient?.isConnected) return;
    await this.connectWs();
  }

  private connectWs(): Promise<void> {
    if (this.wsClient == null) {
      this.wsClient = new TopicWsClient(OKX_WS_URL, 'okx-ws', {
        pingIntervalMs: OKX_PING_INTERVAL_MS,
        pingMessage: 'ping',
        onStatusChange: (state) => {
          this.emitStatus(state === 'connected' ? 'connected' : state === 'down' ? 'down' : 'reconnecting');
        },
        getReplayMessages: () => {
          const args = buildOkxReplayArgs(this.subscriptions);
          return args.length > 0 ? [{ op: 'subscribe', args }] : [];
        },
        onMessage: (raw) => {
          this.handleRawMessage(raw);
        },
        onOpen: () => {
          this.sendJson({
            op: 'subscribe',
            args: [
              { channel: 'instruments', instType: 'OPTION' },
              { channel: 'status' },
            ],
          });

        },
      });
    }

    return this.wsClient.connect();
  }

  // ── WS message routing ────────────────────────────────────────

  private handleRawMessage(raw: WebSocket.RawData): void {
    const str = raw.toString();
    if (str === 'pong') return;

    let json: unknown;
    try { json = JSON.parse(str); } catch { log.debug('malformed WS frame'); return; }

    if (json == null || typeof json !== 'object') return;
    const obj = json as Record<string, unknown>;
    if (obj['event'] === 'subscribe' || obj['event'] === 'unsubscribe' || obj['event'] === 'error') return;

    if (obj['event'] === 'notice') {
      const notice = parseOkxWsNotice(json);
      if (notice != null) {
        const health = deriveOkxNoticeHealth(notice);
        this.emitStatus(health.status, health.message);
      }
      return;
    }

    const channel = (obj['arg'] as Record<string, unknown> | undefined)?.['channel'];

    if (channel === 'opt-summary') {
      const msg = parseOkxWsOptSummaryMsg(json);
      if (msg != null) this.handleWsOptSummaryBatch(msg.data);
      return;
    }

    if (channel === 'tickers') {
      const msg = parseOkxWsTickerMsg(json);
      if (msg != null) this.handleWsTickerBatch(msg.data);
      return;
    }

    if (channel === 'mark-price') {
      const msg = parseOkxWsMarkPriceMsg(json);
      if (msg != null) this.handleWsMarkPriceBatch(msg.data);
      return;
    }

    if (channel === 'instruments') {
      const msg = parseOkxWsInstrumentsMsg(json);
      if (msg != null) this.handleWsInstruments(msg.data);
      return;
    }

    if (channel === 'status') {
      const msg = parseOkxWsStatusMsg(json);
      if (msg != null) {
        const health = deriveOkxStatusHealth(msg);
        this.emitStatus(health.status, health.message);
      }
      return;
    }
  }

  // ── WS message handlers ───────────────────────────────────────

  private handleWsOptSummaryBatch(items: OkxOptSummary[]): void {
    const updates: Array<{ exchangeSymbol: string; quote: LiveQuote }> = [];

    for (const item of items) {
      const id = item.instId;
      if (!this.instrumentMap.has(id)) continue;

      const prev = this.quoteStore.get(id);
      updates.push({
        exchangeSymbol: id,
        quote: mergeOkxOptSummary(prev, item, (value) => this.safeNum(value)),
      });
    }

    this.emitQuoteUpdates(updates);
  }

  private handleWsTickerBatch(items: OkxTicker[]): void {
    const updates: Array<{ exchangeSymbol: string; quote: LiveQuote }> = [];

    for (const item of items) {
      const id = item.instId;
      const inst = this.instrumentMap.get(id);
      if (!inst) continue;

      const prev = this.quoteStore.get(id);
      updates.push({
        exchangeSymbol: id,
        quote: mergeOkxWsTicker(prev, item, inst, (value) => this.safeNum(value)),
      });
    }

    this.emitQuoteUpdates(updates);
  }

  private handleWsMarkPriceBatch(items: OkxMarkPrice[]): void {
    const updates: Array<{ exchangeSymbol: string; quote: LiveQuote }> = [];

    for (const item of items) {
      const id = item.instId;
      if (!this.instrumentMap.has(id)) continue;

      const prev = this.quoteStore.get(id);
      if (!prev) continue;

      updates.push({
        exchangeSymbol: id,
        quote: mergeOkxMarkPrice(prev, item, (value) => this.safeNum(value)),
      });
    }

    this.emitQuoteUpdates(updates);
  }

  /**
   * instruments channel — new listing or state change for an OPTION.
   * Fires when new strikes/expiries are listed. We add any unknown instruments
   * to our maps and subscribe their tickers + mark-price.
   */
  private handleWsInstruments(data: OkxInstrument[]): void {
    const newInstruments: CachedInstrument[] = [];

    for (const raw of data) {
      if (raw.state && raw.state !== 'live') continue;
      if (this.instrumentMap.has(raw.instId)) continue;

      const inst = this.parseInstrument(raw);
      if (!inst) continue;

      this.instruments.push(inst);
      this.instrumentMap.set(inst.exchangeSymbol, inst);
      this.symbolIndex.set(inst.symbol, inst.exchangeSymbol);
      newInstruments.push(inst);
    }

    if (newInstruments.length === 0) return;

    const args = buildOkxInstrumentSubscriptionArgs(this.subscriptions, newInstruments);

    if (args.length > 0 && this.wsClient?.isConnected) {
      this.sendSubscribeBatched(args);
    }

    log.info({ count: newInstruments.length }, 'added new instruments from instruments channel');
  }

  // ── normalizers ───────────────────────────────────────────────

  private tickerToQuote(t: OkxTicker) {
    const inst = this.instrumentMap.get(t.instId);
    return buildOkxTickerQuote(t, inst?.contractSize ?? null, (value) => this.safeNum(value));
  }

  private mergeOptSummary(item: OkxOptSummary): void {
    const id = item.instId;
    const prev = this.quoteStore.get(id);

    if (prev != null) {
      this.emitQuoteUpdate(id, mergeOkxOptSummary(prev, item, (value) => this.safeNum(value)));
      return;
    }

    this.quoteStore.set(id, mergeOkxOptSummary(undefined, item, (value) => this.safeNum(value)));
  }

  // ── helpers ───────────────────────────────────────────────────

  /**
   * Send a subscribe/unsubscribe message with all args in one request.
   * Chunks at 60KB to stay safely under OKX's 64KB per-message limit.
   * One chain (~50 instruments × ~55 bytes) ≈ 2.75KB — never splits in practice.
   */
  private sendSubscribeBatched(args: object[], op: 'subscribe' | 'unsubscribe' = 'subscribe'): void {
    let batch: object[] = [];
    let batchBytes = 0;

    for (const arg of args) {
      const size = JSON.stringify(arg).length;
      if (batchBytes + size > 60_000 && batch.length > 0) {
        this.sendJson({ op, args: batch });
        batch = [];
        batchBytes = 0;
      }
      batch.push(arg);
      batchBytes += size;
    }

    if (batch.length > 0) this.sendJson({ op, args: batch });
  }

  private async fetchOkxApi(path: string, params: Record<string, string>): Promise<unknown[]> {
    const url = new URL(path, OKX_REST_BASE_URL);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`OKX ${path} returned ${res.status}`);

    const json: unknown = await res.json();
    const parsed = parseOkxRestResponse(json);

    if (parsed == null) throw new Error(`OKX ${path} response invalid`);
    if (parsed.code !== '0') throw new Error(`OKX ${path} error ${parsed.code}: ${parsed.msg}`);

    return parsed.data;
  }

  private sendJson(payload: Record<string, unknown>): void {
    this.wsClient?.send(payload);
  }

  private sweepExpiredState(): void {
    const removed = this.sweepExpiredInstruments();
    if (removed.length === 0) return;

    removeOkxSubscribedInstruments(
      this.subscriptions,
      removed.map((instrument) => instrument.exchangeSymbol),
    );
    log.info({ count: removed.length }, 'removed expired instruments');
  }

  override async dispose(): Promise<void> {
    for (const timer of this.refreshTimers) clearInterval(timer);
    this.refreshTimers = [];
    await this.unsubscribeAll();
    await this.wsClient?.disconnect();
    this.wsClient = null;
  }
}
