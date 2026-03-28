import WebSocket from 'ws';
import { OKX_REST_BASE_URL, OKX_WS_URL } from '../shared/endpoints.js';
import { SdkBaseAdapter, type CachedInstrument, type LiveQuote } from '../shared/sdk-base.js';
import type { VenueId } from '../../types/common.js';
import { EMPTY_GREEKS, type OptionGreeks } from '../../core/types.js';
import { feedLogger } from '../../utils/logger.js';
import { backoffDelay } from '../../utils/reconnect.js';
import {
  OkxRestResponseSchema,
  OkxInstrumentSchema,
  OkxTickerSchema,
  OkxOptSummarySchema,
  OkxMarkPriceSchema,
  OkxWsOptSummaryMsgSchema,
  OkxWsTickerMsgSchema,
  OkxWsMarkPriceMsgSchema,
  OkxWsInstrumentsMsgSchema,
  OKX_OPTION_SYMBOL_RE,
  type OkxTicker,
  type OkxOptSummary,
  type OkxMarkPrice,
  type OkxInstrument,
} from './types.js';

const log = feedLogger('okx');

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

  private ws: WebSocket | null = null;
  private subscribedFamilies = new Set<string>();
  private subscribedTickers = new Set<string>();
  private subscribedMarkPrice = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimers: ReturnType<typeof setInterval>[] = [];
  private shouldReconnect = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  protected initClients(): void {}

  // ── instrument loading ────────────────────────────────────────

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    const instruments: CachedInstrument[] = [];

    for (const instFamily of INST_FAMILIES) {
      try {
        const data = await this.fetchOkxApi('/api/v5/public/instruments', { instType: 'OPTION', instFamily });
        for (const raw of data) {
          const parsed = OkxInstrumentSchema.safeParse(raw);
          if (!parsed.success) continue;
          const inst = this.parseInstrument(parsed.data);
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
      tickSize: this.safeNum(item.tickSz),
      minQty: this.safeNum(item.minSz),
      makerFee: 0.0002,
      takerFee: 0.0005,
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
      const data = await this.fetchOkxApi('/api/v5/market/tickers', { instType: 'OPTION', instFamily });
      for (const raw of data) {
        const parsed = OkxTickerSchema.safeParse(raw);
        if (!parsed.success) continue;
        this.quoteStore.set(parsed.data.instId, this.tickerToQuote(parsed.data));
      }
      log.info({ count: data.length, instFamily }, 'fetched tickers');
    } catch (err: unknown) {
      log.warn({ instFamily, err: String(err) }, 'failed to fetch tickers');
    }
  }

  private async fetchOptSummarySnapshot(instFamily: string): Promise<void> {
    try {
      const data = await this.fetchOkxApi('/api/v5/public/opt-summary', { instFamily });
      for (const raw of data) {
        const parsed = OkxOptSummarySchema.safeParse(raw);
        if (!parsed.success) continue;
        this.mergeOptSummary(parsed.data);
      }
      log.info({ count: data.length, instFamily }, 'fetched greeks');
    } catch (err: unknown) {
      log.warn({ instFamily, err: String(err) }, 'failed to fetch greeks');
    }
  }

  private async fetchOiSnapshot(instFamily: string): Promise<void> {
    try {
      const data = await this.fetchOkxApi('/api/v5/public/open-interest', { instType: 'OPTION', instFamily });
      let merged = 0;
      for (const raw of data) {
        const item = raw as { instId?: string; oiCcy?: string; oiUsd?: string };
        if (typeof item.instId !== 'string') continue;
        const prev = this.quoteStore.get(item.instId);
        if (!prev) continue;
        prev.openInterest    = this.safeNum(item.oiCcy);
        prev.openInterestUsd = this.safeNum(item.oiUsd);
        merged++;
      }
      log.info({ count: merged, instFamily }, 'fetched open interest');
    } catch (err: unknown) {
      log.warn({ instFamily, err: String(err) }, 'failed to fetch OI');
    }
  }

  private async fetchMarkPriceSnapshot(instFamily: string): Promise<void> {
    try {
      const data = await this.fetchOkxApi('/api/v5/public/mark-price', { instType: 'OPTION', instFamily });
      let merged = 0;
      for (const raw of data) {
        const parsed = OkxMarkPriceSchema.safeParse(raw);
        if (!parsed.success) continue;
        const prev = this.quoteStore.get(parsed.data.instId);
        if (!prev) continue;
        prev.markPrice = this.safeNum(parsed.data.markPx);
        merged++;
      }
      log.info({ count: merged, instFamily }, 'fetched mark prices');
    } catch (err: unknown) {
      log.warn({ instFamily, err: String(err) }, 'failed to fetch mark prices');
    }
  }

  // Periodic REST refresh — called every 5 minutes via setInterval.
  private async refreshOi(): Promise<void> {
    for (const instFamily of INST_FAMILIES) await this.fetchOiSnapshot(instFamily);
  }

  private async refreshMarkPrice(): Promise<void> {
    for (const instFamily of INST_FAMILIES) await this.fetchMarkPriceSnapshot(instFamily);
  }

  // ── WebSocket connection ──────────────────────────────────────

  protected async subscribeChain(
    underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    await this.ensureConnected();

    const args: object[] = [];

    // One opt-summary subscription covers all options for the family.
    const family = `${underlying}-USD`;
    if (!this.subscribedFamilies.has(family)) {
      args.push({ channel: 'opt-summary', instFamily: family });
      this.subscribedFamilies.add(family);
    }

    // tickers and mark-price require per-instId subscriptions for OPTION.
    // Batched into one subscribe message to stay within the 480 req/hr limit.
    for (const inst of instruments) {
      if (!this.subscribedTickers.has(inst.exchangeSymbol)) {
        args.push({ channel: 'tickers', instId: inst.exchangeSymbol });
        this.subscribedTickers.add(inst.exchangeSymbol);
      }
      if (!this.subscribedMarkPrice.has(inst.exchangeSymbol)) {
        args.push({ channel: 'mark-price', instId: inst.exchangeSymbol });
        this.subscribedMarkPrice.add(inst.exchangeSymbol);
      }
    }

    if (args.length > 0) {
      this.sendSubscribeBatched(args);
      log.info({ count: args.length, underlying }, 'subscribed to channels');
    }
  }

  protected async unsubscribeAll(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const args: object[] = [
      ...[...this.subscribedFamilies].map(f => ({ channel: 'opt-summary', instFamily: f })),
      ...[...this.subscribedTickers].map(id => ({ channel: 'tickers', instId: id })),
      ...[...this.subscribedMarkPrice].map(id => ({ channel: 'mark-price', instId: id })),
    ];

    if (args.length > 0) this.sendSubscribeBatched(args, 'unsubscribe');

    this.subscribedFamilies.clear();
    this.subscribedTickers.clear();
    this.subscribedMarkPrice.clear();
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    await this.connectWs();
  }

  private connectWs(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.shouldReconnect = true;
      this.ws = new WebSocket(OKX_WS_URL);

      this.ws.on('open', () => {
        log.info('ws connected');
        this.reconnectAttempt = 0;
        this.emitStatus('connected');
        this.startPing();
        // Subscribe to instrument lifecycle on every connect so new listings
        // and state changes are never missed regardless of reconnect timing.
        this.ws!.send(JSON.stringify({
          op: 'subscribe',
          args: [{ channel: 'instruments', instType: 'OPTION' }],
        }));
        resolve();
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        this.handleRawMessage(raw);
      });

      this.ws.on('close', () => {
        log.warn('ws closed');
        this.emitStatus('reconnecting', 'transport closed');
        this.stopPing();
        if (this.shouldReconnect) this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        log.error({ err: err.message }, 'ws error');
        if (this.ws?.readyState !== WebSocket.OPEN) reject(err);
      });
    });
  }

  // OKX drops idle connections after 30s — send text "ping" every 25s.
  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('ping');
    }, 25_000);
  }

  private stopPing(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  private reconnectAttempt = 0;

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = backoffDelay(this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connectWs();

        const args: object[] = [
          ...[...this.subscribedFamilies].map(f => ({ channel: 'opt-summary', instFamily: f })),
          ...[...this.subscribedTickers].map(id => ({ channel: 'tickers', instId: id })),
          ...[...this.subscribedMarkPrice].map(id => ({ channel: 'mark-price', instId: id })),
        ];
        if (args.length > 0) this.sendSubscribeBatched(args);
      } catch (e: unknown) {
        log.warn({ err: String(e) }, 'reconnect failed');
        this.scheduleReconnect();
      }
    }, delay);
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

    const channel = (obj['arg'] as Record<string, unknown> | undefined)?.['channel'];

    if (channel === 'opt-summary') {
      const msg = OkxWsOptSummaryMsgSchema.safeParse(json);
      if (msg.success) for (const item of msg.data.data) this.handleWsOptSummary(item);
      return;
    }

    if (channel === 'tickers') {
      const msg = OkxWsTickerMsgSchema.safeParse(json);
      if (msg.success) for (const item of msg.data.data) this.handleWsTicker(item);
      return;
    }

    if (channel === 'mark-price') {
      const msg = OkxWsMarkPriceMsgSchema.safeParse(json);
      if (msg.success) for (const item of msg.data.data) this.handleWsMarkPrice(item);
      return;
    }

    if (channel === 'instruments') {
      const msg = OkxWsInstrumentsMsgSchema.safeParse(json);
      if (msg.success) this.handleWsInstruments(msg.data.data);
      return;
    }
  }

  // ── WS message handlers ───────────────────────────────────────

  private handleWsOptSummary(item: OkxOptSummary): void {
    const id = item.instId;
    if (!this.instrumentMap.has(id)) return;

    const prev = this.quoteStore.get(id);
    const quote: LiveQuote = {
      bidPrice:        prev?.bidPrice        ?? null,
      askPrice:        prev?.askPrice        ?? null,
      bidSize:         prev?.bidSize         ?? null,
      askSize:         prev?.askSize         ?? null,
      markPrice:       prev?.markPrice       ?? null,
      lastPrice:       prev?.lastPrice       ?? null,
      underlyingPrice: this.safeNum(item.fwdPx) ?? prev?.underlyingPrice ?? null,
      indexPrice:      null,
      volume24h:       prev?.volume24h       ?? null,
      openInterest:    prev?.openInterest    ?? null,
      openInterestUsd: prev?.openInterestUsd ?? null,
      volume24hUsd:    prev?.volume24hUsd    ?? null,
      greeks: this.parseGreeks(item),
      timestamp: Number(item.ts) || Date.now(),
    };

    this.emitQuoteUpdate(id, quote);
  }

  private handleWsTicker(item: OkxTicker): void {
    const id = item.instId;
    const inst = this.instrumentMap.get(id);
    if (!inst) return;

    const prev = this.quoteStore.get(id);
    const ctSize = inst.contractSize ?? 0.01;
    const volContracts = this.safeNum(item.vol24h);
    const volBase = volContracts != null ? volContracts * ctSize : prev?.volume24h ?? null;
    const underlying = prev?.underlyingPrice ?? null;
    const volUsd = volBase != null && underlying != null ? volBase * underlying : prev?.volume24hUsd ?? null;

    const quote: LiveQuote = {
      bidPrice:        this.safeNum(item.bidPx),
      askPrice:        this.safeNum(item.askPx),
      bidSize:         this.safeNum(item.bidSz),
      askSize:         this.safeNum(item.askSz),
      markPrice:       prev?.markPrice       ?? null,
      lastPrice:       this.safeNum(item.last),
      underlyingPrice: prev?.underlyingPrice ?? null,
      indexPrice:      null,
      volume24h:       volBase,
      openInterest:    prev?.openInterest    ?? null,
      openInterestUsd: prev?.openInterestUsd ?? null,
      volume24hUsd:    volUsd,
      greeks:          prev?.greeks          ?? { ...EMPTY_GREEKS },
      timestamp:       Number(item.ts) || Date.now(),
    };

    this.emitQuoteUpdate(id, quote);
  }

  private handleWsMarkPrice(item: OkxMarkPrice): void {
    const id = item.instId;
    if (!this.instrumentMap.has(id)) return;

    const prev = this.quoteStore.get(id);
    if (!prev) return;

    prev.markPrice = this.safeNum(item.markPx);
    // Emit so subscribers see the updated mark price immediately.
    this.emitQuoteUpdate(id, prev);
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

    // Subscribe tickers + mark-price for new instruments in one batched message.
    const args: object[] = [];
    for (const inst of newInstruments) {
      if (!this.subscribedTickers.has(inst.exchangeSymbol)) {
        args.push({ channel: 'tickers', instId: inst.exchangeSymbol });
        this.subscribedTickers.add(inst.exchangeSymbol);
      }
      if (!this.subscribedMarkPrice.has(inst.exchangeSymbol)) {
        args.push({ channel: 'mark-price', instId: inst.exchangeSymbol });
        this.subscribedMarkPrice.add(inst.exchangeSymbol);
      }
    }

    if (args.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribeBatched(args);
    }

    log.info({ count: newInstruments.length }, 'added new instruments from instruments channel');
  }

  // ── normalizers ───────────────────────────────────────────────

  private tickerToQuote(t: OkxTicker): LiveQuote {
    const inst = this.instrumentMap.get(t.instId);
    const ctSize = inst?.contractSize ?? 0.01;
    const volContracts = this.safeNum(t.vol24h);
    // Convert contracts → base currency so volume24h × underlyingPrice = correct notional.
    const volBase = volContracts != null ? volContracts * ctSize : null;

    return {
      bidPrice: this.safeNum(t.bidPx),
      askPrice: this.safeNum(t.askPx),
      bidSize:  this.safeNum(t.bidSz),
      askSize:  this.safeNum(t.askSz),
      markPrice: null,
      lastPrice: this.safeNum(t.last),
      underlyingPrice: null,
      indexPrice: null,
      volume24h: volBase,
      openInterest: null,
      openInterestUsd: null,
      volume24hUsd: null,
      greeks: { ...EMPTY_GREEKS },
      timestamp: Number(t.ts) || Date.now(),
    };
  }

  private mergeOptSummary(item: OkxOptSummary): void {
    const id = item.instId;
    const prev = this.quoteStore.get(id);

    if (prev) {
      prev.underlyingPrice = this.safeNum(item.fwdPx) ?? prev.underlyingPrice;
      prev.greeks = this.parseGreeks(item);
      prev.timestamp = Number(item.ts) || prev.timestamp;
    } else {
      this.quoteStore.set(id, {
        bidPrice: null, askPrice: null, bidSize: null, askSize: null,
        markPrice: null, lastPrice: null,
        underlyingPrice: this.safeNum(item.fwdPx),
        indexPrice: null,
        volume24h: null, openInterest: null, openInterestUsd: null, volume24hUsd: null,
        greeks: this.parseGreeks(item),
        timestamp: Number(item.ts) || Date.now(),
      });
    }
  }

  /**
   * Prefer Black-Scholes greeks (deltaBS/gammaBS/etc) — USD-denominated.
   * Fall back to coin-denominated values when BS variants are absent.
   */
  private parseGreeks(item: OkxOptSummary): OptionGreeks {
    return {
      delta:  this.safeNum(item.deltaBS)  ?? this.safeNum(item.delta),
      gamma:  this.safeNum(item.gammaBS)  ?? this.safeNum(item.gamma),
      theta:  this.safeNum(item.thetaBS)  ?? this.safeNum(item.theta),
      vega:   this.safeNum(item.vegaBS)   ?? this.safeNum(item.vega),
      rho:    null,
      markIv: this.safeNum(item.markVol),
      bidIv:  this.safeNum(item.bidVol),
      askIv:  this.safeNum(item.askVol),
    };
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
    const parsed = OkxRestResponseSchema.safeParse(json);

    if (!parsed.success) throw new Error(`OKX ${path} response invalid: ${parsed.error.message}`);
    if (parsed.data.code !== '0') throw new Error(`OKX ${path} error ${parsed.data.code}: ${parsed.data.msg}`);

    return parsed.data.data;
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  override async dispose(): Promise<void> {
    this.shouldReconnect = false;
    this.stopPing();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    for (const t of this.refreshTimers) clearInterval(t);
    this.refreshTimers = [];
    await this.unsubscribeAll();
    this.ws?.close();
    this.ws = null;
  }
}
