import WebSocket from 'ws';
import { BINANCE_MARK_WS_URL, BINANCE_REST_BASE_URL } from '../shared/endpoints.js';
import { SdkBaseAdapter, type CachedInstrument, type LiveQuote } from '../shared/sdk-base.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import { backoffDelay } from '../../utils/reconnect.js';
import {
  BinanceCombinedStreamSchema,
  BinanceInstrumentSchema,
  BinanceMarkPriceSchema,
  BinanceNewSymbolSchema,
  BinanceOiEventSchema,
  BinanceRestTickerSchema,
} from './types.js';

const log = feedLogger('binance');

// Volume and lastPrice are not in the WS stream — refresh from REST on this interval.
const TICKER_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

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

  private ws: WebSocket | null = null;
  private subscribedStreams = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private tickerRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private shouldReconnect = false;
  private msgId = 0;

  protected initClients(): void {}

  // ── instrument loading ────────────────────────────────────────

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    const instruments: CachedInstrument[] = [];

    const eapiInfo = await this.fetchEapi('/eapi/v1/exchangeInfo');
    const info = eapiInfo as Record<string, unknown>;
    const symbols: unknown[] = Array.isArray(info?.['optionSymbols'])
      ? (info['optionSymbols'] as unknown[])
      : Array.isArray(info?.['symbols'])
        ? (info['symbols'] as unknown[])
        : [];

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

    return instruments;
  }

  private parseInstrument(item: unknown): CachedInstrument | null {
    const parsed = BinanceInstrumentSchema.safeParse(item);
    if (!parsed.success) return null;

    const { symbol: sym, status, quoteAsset, unit, minQty, filters } = parsed.data;
    if (status && status !== 'TRADING') return null;

    // Symbol format: BTC-YYMMDD-STRIKE-C/P
    const parts = sym.match(/^(\w+)-(\d{6})-([\d.]+)-([CP])$/);
    if (!parts) return null;

    const base = parts[1]!;
    const settle = quoteAsset ?? 'USDT';

    // Use API fields when present — more reliable than parsing the symbol name.
    const right = parsed.data.side === 'CALL' ? 'call' as const
      : parsed.data.side === 'PUT'  ? 'put'  as const
      : (parts[4] === 'C'           ? 'call' as const : 'put' as const);

    const strike = parsed.data.strikePrice != null
      ? Number(parsed.data.strikePrice)
      : Number(parts[3]);

    const expiry = parsed.data.expiryDate != null
      ? new Date(parsed.data.expiryDate).toISOString().slice(0, 10)
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
      tickSize: this.safeNum(priceFilter?.tickSize),
      minQty: this.safeNum(minQty),
      makerFee: 0.0002,
      takerFee: 0.0005,
    };
  }

  private waitForFirstData(): Promise<void> {
    const target = this.subscribedStreams.size;
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
    // One optionMarkPrice stream covers all options for an underlying.
    const underlyings = new Set<string>();
    for (const inst of instruments) {
      underlyings.add(`${inst.base.toLowerCase()}${inst.settle.toLowerCase()}`);
    }

    const streams: string[] = [
      ...[...underlyings].map(u => `${u}@optionMarkPrice`),
      // Real-time new listing notifications — replaces polling for new instruments.
      '!optionSymbol',
    ];

    // OI stream per base/expiry pair — updates every 60s, keeps OI live after boot.
    const oiStreams = this.buildOiStreams(instruments);
    streams.push(...oiStreams);

    await this.connectWs();

    for (const s of streams) this.subscribedStreams.add(s);
    this.sendSubscribe(streams);
  }

  private buildOiStreams(instruments: CachedInstrument[]): string[] {
    const seen = new Set<string>();
    const streams: string[] = [];
    for (const inst of instruments) {
      const match = inst.exchangeSymbol.match(/-(\d{6})-/);
      if (!match) continue;
      const key = `${inst.base.toLowerCase()}${inst.settle.toLowerCase()}@openInterest@${match[1]}`;
      if (!seen.has(key)) { seen.add(key); streams.push(key); }
    }
    return streams;
  }

  private connectWs(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) { resolve(); return; }

      this.shouldReconnect = true;
      this.ws = new WebSocket(BINANCE_MARK_WS_URL);

      this.ws.on('open', () => {
        log.info('ws connected');
        this.emitStatus('connected');
        resolve();
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        try {
          this.handleWsMessage(JSON.parse(raw.toString()));
        } catch (e: unknown) { log.debug({ err: String(e) }, 'malformed WS frame'); }
      });

      this.ws.on('close', () => {
        log.warn('ws closed');
        this.emitStatus('reconnecting', 'transport closed');
        if (this.shouldReconnect) this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        log.error({ err: err.message }, 'ws error');
        if (this.ws?.readyState !== WebSocket.OPEN) reject(err);
      });

      // Binance sends WS-level pings every 5 minutes — must pong within 15 minutes.
      this.ws.on('ping', () => { this.ws?.pong(); });
    });
  }

  private sendSubscribe(streams: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: streams, id: ++this.msgId }));
    log.info({ count: streams.length }, 'subscribed to streams');
  }

  private reconnectAttempt = 0;

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = backoffDelay(this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connectWs();
        this.reconnectAttempt = 0;
        if (this.subscribedStreams.size > 0) {
          this.sendSubscribe([...this.subscribedStreams]);
        }
        // Connections close at 24h — re-fetch exchangeInfo to pick up anything
        // listed during the disconnect window that !optionSymbol may have missed.
        void this.refreshInstrumentsFromExchangeInfo();
      } catch (e: unknown) {
        log.warn({ err: String(e) }, 'reconnect failed');
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * On reconnect after a 24-hour forced disconnect, diff exchangeInfo against
   * our current map and add anything new. Short gaps are already covered by
   * !optionSymbol; this handles the disconnect window itself.
   */
  private async refreshInstrumentsFromExchangeInfo(): Promise<void> {
    try {
      const eapiInfo = await this.fetchEapi('/eapi/v1/exchangeInfo');
      const info = eapiInfo as Record<string, unknown>;
      const symbols: unknown[] = Array.isArray(info?.['optionSymbols']) ? (info['optionSymbols'] as unknown[]) : [];

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

        const oiStreams = this.buildOiStreams([inst]);
        for (const s of oiStreams) {
          if (!this.subscribedStreams.has(s)) { this.subscribedStreams.add(s); newOiStreams.push(s); }
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
    const stream = `${underlying.toLowerCase()}usdt@optionMarkPrice`;
    const newStreams: string[] = [];

    if (!this.subscribedStreams.has(stream)) {
      this.subscribedStreams.add(stream);
      newStreams.push(stream);
    }

    // Subscribe OI streams for any expiries not already tracked.
    for (const s of this.buildOiStreams(instruments)) {
      if (!this.subscribedStreams.has(s)) { this.subscribedStreams.add(s); newStreams.push(s); }
    }

    if (newStreams.length > 0) this.sendSubscribe(newStreams);
  }

  protected async unsubscribeAll(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.subscribedStreams.size === 0) return;
    this.ws.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: [...this.subscribedStreams], id: ++this.msgId }));
    this.subscribedStreams.clear();
  }

  // ── WS message handling ───────────────────────────────────────

  private handleWsMessage(msg: unknown): void {
    const envelope = BinanceCombinedStreamSchema.safeParse(msg);
    if (!envelope.success) return;

    const { stream, data } = envelope.data;

    if (stream === '!optionSymbol') {
      for (const item of data) this.handleNewSymbol(item);
      return;
    }

    if (stream.includes('@openInterest@')) {
      for (const item of data) this.handleOiEvent(item);
      return;
    }

    if (stream.includes('@optionMarkPrice')) {
      for (const rawItem of data) {
        const item = BinanceMarkPriceSchema.safeParse(rawItem);
        if (!item.success) continue;
        this.handleMarkPrice(item.data);
      }
    }
  }

  private handleMarkPrice(item: import('./types.js').BinanceMarkPrice): void {
    const exchangeSymbol = item.s;

    // Binance sends "0.000" for empty bid/ask and "-1.0" for unavailable IV.
    const bidPrice = this.binancePositiveOrNull(item.bo);
    const askPrice = this.binancePositiveOrNull(item.ao);
    const bidIv    = this.binancePositiveOrNull(item.b);
    const askIv    = this.binancePositiveOrNull(item.a);

    const prev = this.quoteStore.get(exchangeSymbol);

    const quote: LiveQuote = {
      bidPrice,
      askPrice,
      bidSize: bidPrice != null ? this.safeNum(item.bq) : null,
      askSize: askPrice != null ? this.safeNum(item.aq) : null,
      markPrice: this.safeNum(item.mp),
      lastPrice: prev?.lastPrice ?? null,
      underlyingPrice: this.safeNum(item.i),
      indexPrice: this.safeNum(item.i),
      volume24h: prev?.volume24h ?? null,
      openInterest: prev?.openInterest ?? null,
      openInterestUsd: prev?.openInterestUsd ?? null,
      volume24hUsd: prev?.volume24hUsd ?? null,
      greeks: {
        delta: this.safeNum(item.d),
        gamma: this.safeNum(item.g),
        theta: this.safeNum(item.t),
        vega:  this.safeNum(item.v),
        rho:   null,
        markIv: this.safeNum(item.vo),
        bidIv,
        askIv,
      },
      timestamp: item.E ?? Date.now(),
    };

    this.quoteStore.set(exchangeSymbol, quote);
    if (this.instrumentMap.has(exchangeSymbol)) {
      this.emitQuoteUpdate(exchangeSymbol, quote);
    }
  }

  /**
   * !optionSymbol stream — new instrument listed on Binance at 50ms.
   * Adds the instrument to all maps and subscribes its OI stream.
   */
  private handleNewSymbol(raw: unknown): void {
    const parsed = BinanceNewSymbolSchema.safeParse(raw);
    if (!parsed.success) return;

    const d = parsed.data;
    if (d.cs && d.cs !== 'TRADING') return;
    if (this.instrumentMap.has(d.s)) return;

    const parts = d.s.match(/^(\w+)-(\d{6})-([\d.]+)-([CP])$/);
    if (!parts) return;

    const base   = parts[1]!;
    const settle = d.qa;
    const right  = d.d === 'CALL' ? 'call' as const : 'put' as const;
    const strike = Number(d.sp);
    const expiry = new Date(d.dt).toISOString().slice(0, 10);

    const inst: CachedInstrument = {
      symbol: this.buildCanonicalSymbol(base, settle, expiry, strike, right),
      exchangeSymbol: d.s,
      base,
      quote: settle,
      settle,
      expiry,
      strike,
      right,
      inverse: false,
      contractSize: d.u ?? 1,
      tickSize: null,
      minQty: null,
      makerFee: 0.0002,
      takerFee: 0.0005,
    };

    this.instruments.push(inst);
    this.instrumentMap.set(inst.exchangeSymbol, inst);
    this.symbolIndex.set(inst.symbol, inst.exchangeSymbol);

    // Subscribe OI stream for this instrument's expiry if not already tracked.
    const oiStreams = this.buildOiStreams([inst]).filter(s => !this.subscribedStreams.has(s));
    for (const s of oiStreams) this.subscribedStreams.add(s);
    if (oiStreams.length > 0) this.sendSubscribe(oiStreams);

    log.info({ symbol: d.s }, 'added new instrument from !optionSymbol');
  }

  // underlying@openInterest@YYMMDD — updates every 60s
  private handleOiEvent(raw: unknown): void {
    const parsed = BinanceOiEventSchema.safeParse(raw);
    if (!parsed.success) return;

    const prev = this.quoteStore.get(parsed.data.s);
    if (!prev) return;

    prev.openInterest = this.safeNum(parsed.data.o);
    prev.openInterestUsd = this.safeNum(parsed.data.h);
  }

  // ── REST supplement ───────────────────────────────────────────

  /**
   * Fetch volume + lastPrice from REST ticker and OI from REST openInterest.
   * Called at boot and every 5 minutes for volume (WS stream carries neither).
   * OI is seeded here once; the WS openInterest stream keeps it current after.
   */
  private async fetchTickerSnapshot(instruments: CachedInstrument[]): Promise<void> {
    try {
      const raw = await this.fetchEapi('/eapi/v1/ticker');
      if (!Array.isArray(raw)) return;

      let merged = 0;
      for (const item of raw) {
        const t = BinanceRestTickerSchema.safeParse(item);
        if (!t.success) continue;
        const prev = this.quoteStore.get(t.data.symbol);
        if (!prev) continue;
        if (t.data.volume != null)    prev.volume24h  = this.safeNum(t.data.volume);
        if (t.data.lastPrice != null) prev.lastPrice  = this.safeNum(t.data.lastPrice);
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
            prev.openInterest    = this.safeNum(t.sumOpenInterest);
            prev.openInterestUsd = this.safeNum(t.sumOpenInterestUsd);
          }
        }
      } catch (err: unknown) {
        log.warn({ base, expiry, err: String(err) }, 'OI fetch failed');
      }
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

  override async dispose(): Promise<void> {
    this.shouldReconnect = false;
    if (this.reconnectTimer)      { clearTimeout(this.reconnectTimer);       this.reconnectTimer = null; }
    if (this.tickerRefreshTimer)  { clearInterval(this.tickerRefreshTimer);  this.tickerRefreshTimer = null; }
    await this.unsubscribeAll();
    this.ws?.close();
    this.ws = null;
  }
}
