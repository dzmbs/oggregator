import WebSocket from 'ws';
import { BYBIT_REST_BASE_URL, BYBIT_WS_URL } from '../shared/endpoints.js';
import { SdkBaseAdapter, type CachedInstrument, type LiveQuote } from '../shared/sdk-base.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import { backoffDelay } from '../../utils/reconnect.js';
import {
  BybitInstrumentsResponseSchema,
  BybitTickersResponseSchema,
  BybitWsMessageSchema,
  BYBIT_OPTION_SYMBOL_RE,
  type BybitRestTicker,
  type BybitWsTicker,
  type BybitInstrument,
} from './types.js';

const log = feedLogger('bybit');

const MAX_TOPICS_PER_BATCH = 200;

/**
 * Bybit options adapter using raw WebSocket + fetch.
 *
 * REST (instrument loading + initial snapshot):
 *   GET /v5/market/instruments-info?category=option
 *   GET /v5/market/tickers?category=option&baseCoin=X
 *
 * WebSocket (live updates):
 *   wss://stream.bybit.com/v5/public/option
 *   Per-instrument topics: tickers.{symbol}
 *   Messages are snapshots — each push replaces the full state.
 *
 * REST vs WS field name differences (both verified 2026-03-20):
 *   REST: bid1Price, ask1Price, bid1Iv, ask1Iv, markIv
 *   WS:   bidPrice,  askPrice,  bidIv,  askIv,  markPriceIv
 *
 * Settlement: USDT-settled, linear. No inverse conversion.
 */
const INSTRUMENT_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

// Bybit requires explicit baseCoin — no wildcard like Deribit's currency:'any'.
// These are all underlyings with active options as of 2026-03-28.
const BASE_COINS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP'] as const;

export class BybitWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'bybit';

  private ws: WebSocket | null = null;
  private subscribedTopics = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private shouldReconnect = false;

  protected initClients(): void {}

  // ── instrument loading ────────────────────────────────────────

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    const instruments: CachedInstrument[] = [];

    // Bybit returns only BTC when baseCoin is omitted — must query each explicitly.
    for (const baseCoin of BASE_COINS) {
      let cursor: string | undefined;

      do {
        const url = new URL('/v5/market/instruments-info', BYBIT_REST_BASE_URL);
        url.searchParams.set('category', 'option');
        url.searchParams.set('baseCoin', baseCoin);
        url.searchParams.set('limit', '1000');
        if (cursor) url.searchParams.set('cursor', cursor);

        const raw = await this.fetchJson(url);
        const parsed = BybitInstrumentsResponseSchema.safeParse(raw);

        if (!parsed.success) {
          log.warn({ baseCoin, error: parsed.error.message }, 'instruments response validation failed');
          break;
        }

        if (parsed.data.retCode !== 0) {
          log.warn({ baseCoin, msg: parsed.data.retMsg }, 'instruments request failed');
          break;
        }

        for (const item of parsed.data.result.list) {
          const inst = this.parseInstrument(item);
          if (inst) instruments.push(inst);
        }

        cursor = parsed.data.result.nextPageCursor || undefined;
      } while (cursor);
    }

    log.info({ count: instruments.length }, 'loaded option instruments');

    await this.fetchBulkTickers(instruments);

    // Poll for new strikes/expiries every 10 minutes — Bybit has no instrument
    // lifecycle push channel unlike Deribit's instrument.state.
    this.refreshTimer = setInterval(() => { void this.refreshInstruments(); }, INSTRUMENT_REFRESH_INTERVAL_MS);

    return instruments;
  }

  /**
   * Polls `get_instruments` for each baseCoin and subscribes any symbols
   * not yet in our instrument map. Called every 10 minutes to pick up new
   * strikes and expiries listed after boot without a server restart.
   *
   * Only adds instruments — expired ones are left in place and simply stop
   * receiving ticker pushes, which is harmless for a read-only display.
   */
  private async refreshInstruments(): Promise<void> {
    const activeSymbols = new Set<string>();
    const newInstruments: CachedInstrument[] = [];

    for (const baseCoin of BASE_COINS) {
      try {
        let cursor: string | undefined;

        do {
          const url = new URL('/v5/market/instruments-info', BYBIT_REST_BASE_URL);
          url.searchParams.set('category', 'option');
          url.searchParams.set('baseCoin', baseCoin);
          url.searchParams.set('limit', '1000');
          if (cursor) url.searchParams.set('cursor', cursor);

          const raw = await this.fetchJson(url);
          const parsed = BybitInstrumentsResponseSchema.safeParse(raw);
          if (!parsed.success || parsed.data.retCode !== 0) break;

          for (const item of parsed.data.result.list) {
            if (item.status === 'Trading') activeSymbols.add(item.symbol);
            if (this.instrumentMap.has(item.symbol)) continue;
            if (item.status !== 'Trading') continue;
            const inst = this.parseInstrument(item);
            if (inst) newInstruments.push(inst);
          }

          cursor = parsed.data.result.nextPageCursor || undefined;
        } while (cursor);
      } catch (err: unknown) {
        log.warn({ baseCoin, err: String(err) }, 'instrument refresh failed');
        // If a baseCoin fetch fails, skip expiry detection for that coin to
        // avoid incorrectly removing instruments we just couldn't reach.
        for (const inst of this.instruments) {
          if (inst.base === baseCoin) activeSymbols.add(inst.exchangeSymbol);
        }
      }
    }

    // Remove instruments no longer present in the active set.
    const expiredSymbols = this.instruments
      .map((i) => i.exchangeSymbol)
      .filter((sym) => !activeSymbols.has(sym));

    if (expiredSymbols.length > 0) {
      const expiredTopics = expiredSymbols.map((sym) => `tickers.${sym}`);

      for (const sym of expiredSymbols) {
        const inst = this.instrumentMap.get(sym);
        if (!inst) continue;
        this.instrumentMap.delete(sym);
        this.symbolIndex.delete(inst.symbol);
        this.quoteStore.delete(sym);
        this.subscribedTopics.delete(`tickers.${sym}`);
      }
      this.instruments = this.instruments.filter((i) => !expiredSymbols.includes(i.exchangeSymbol));

      if (this.ws?.readyState === WebSocket.OPEN) {
        for (let i = 0; i < expiredTopics.length; i += MAX_TOPICS_PER_BATCH) {
          this.sendJson({ op: 'unsubscribe', args: expiredTopics.slice(i, i + MAX_TOPICS_PER_BATCH) });
        }
      }

      log.info({ count: expiredSymbols.length }, 'removed expired instruments from refresh');
    }

    // Add and subscribe new instruments.
    if (newInstruments.length > 0) {
      for (const inst of newInstruments) {
        this.instruments.push(inst);
        this.instrumentMap.set(inst.exchangeSymbol, inst);
        this.symbolIndex.set(inst.symbol, inst.exchangeSymbol);
      }

      const newTopics = newInstruments
        .map((inst) => `tickers.${inst.exchangeSymbol}`)
        .filter((topic) => !this.subscribedTopics.has(topic));

      if (newTopics.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
        for (const topic of newTopics) this.subscribedTopics.add(topic);
        for (let i = 0; i < newTopics.length; i += MAX_TOPICS_PER_BATCH) {
          this.sendJson({ op: 'subscribe', args: newTopics.slice(i, i + MAX_TOPICS_PER_BATCH) });
        }
      }

      log.info({ count: newInstruments.length }, 'added new instruments from refresh');
    }
  }

  private parseInstrument(item: BybitInstrument): CachedInstrument | null {
    const match = BYBIT_OPTION_SYMBOL_RE.exec(item.symbol);
    if (!match) return null;

    const base = match[1]!;
    const expiryRaw = match[2]!;
    const strikeStr = match[3]!;
    const expiry = this.parseExpiry(expiryRaw);
    // optionsType from the API ("Call"/"Put") is authoritative over the regex suffix.
    const right = item.optionsType === 'Call' ? 'call' as const : 'put' as const;
    // item.settleCoin is authoritative — regex suffix is fallback for edge cases
    const settle = item.settleCoin || match[5] || 'USDT';

    return {
      symbol: this.buildCanonicalSymbol(base, settle, expiry, Number(strikeStr), right),
      exchangeSymbol: item.symbol,
      base,
      quote: item.quoteCoin,
      settle,
      expiry,
      strike: Number(strikeStr),
      right,
      inverse: false,
      contractSize: 1,
      tickSize: this.safeNum(item.priceFilter.tickSize),
      minQty: this.safeNum(item.lotSizeFilter.minOrderQty),
      makerFee: 0.0002,
      takerFee: 0.0005,
    };
  }

  // ── initial REST snapshot ─────────────────────────────────────

  private async fetchBulkTickers(instruments: CachedInstrument[]): Promise<void> {
    const baseCoins = [...new Set(instruments.map(i => i.base))];

    for (const baseCoin of baseCoins) {
      try {
        const url = new URL('/v5/market/tickers', BYBIT_REST_BASE_URL);
        url.searchParams.set('category', 'option');
        url.searchParams.set('baseCoin', baseCoin);

        const raw = await this.fetchJson(url);
        const parsed = BybitTickersResponseSchema.safeParse(raw);

        if (!parsed.success) {
          log.warn({ baseCoin, error: parsed.error.message }, 'tickers validation failed');
          continue;
        }

        if (parsed.data.retCode !== 0) continue;

        for (const item of parsed.data.result.list) {
          this.quoteStore.set(item.symbol, this.restTickerToQuote(item));
        }

        log.info({ count: parsed.data.result.list.length, baseCoin }, 'fetched tickers');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ baseCoin, err: message }, 'failed to fetch tickers');
      }
    }
  }

  // ── WebSocket connection ──────────────────────────────────────

  protected async subscribeChain(
    _underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    const newTopics: string[] = [];
    for (const inst of instruments) {
      const topic = `tickers.${inst.exchangeSymbol}`;
      if (!this.subscribedTopics.has(topic)) {
        newTopics.push(topic);
        this.subscribedTopics.add(topic);
      }
    }

    if (newTopics.length === 0) return;

    await this.ensureConnected();

    for (let i = 0; i < newTopics.length; i += MAX_TOPICS_PER_BATCH) {
      const batch = newTopics.slice(i, i + MAX_TOPICS_PER_BATCH);
      this.sendJson({ op: 'subscribe', args: batch });
    }

    log.info({ count: newTopics.length }, 'subscribed to option tickers');
  }

  protected async unsubscribeAll(): Promise<void> {
    if (this.subscribedTopics.size === 0 || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const topics = [...this.subscribedTopics];
    for (let i = 0; i < topics.length; i += MAX_TOPICS_PER_BATCH) {
      this.sendJson({ op: 'unsubscribe', args: topics.slice(i, i + MAX_TOPICS_PER_BATCH) });
    }
    this.subscribedTopics.clear();
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    await this.connectWs();
  }

  private connectWs(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.shouldReconnect = true;
      this.ws = new WebSocket(BYBIT_WS_URL);

      this.ws.on('open', () => {
        log.info('ws connected');
        this.reconnectAttempt = 0;
        this.emitStatus('connected');
        this.startPing();
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

  // Bybit requires application-level JSON pings, not WS-level ping frames.
  // Without these, the server drops the connection after ~30s.
  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.sendJson({ op: 'ping' });
    }, 20_000);
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
        if (this.subscribedTopics.size > 0) {
          const topics = [...this.subscribedTopics];
          for (let i = 0; i < topics.length; i += MAX_TOPICS_PER_BATCH) {
            this.sendJson({ op: 'subscribe', args: topics.slice(i, i + MAX_TOPICS_PER_BATCH) });
          }
        }
      } catch (e: unknown) {
        log.warn({ err: String(e) }, 'reconnect failed');
        this.scheduleReconnect();
      }
    }, delay);
  }

  // ── WS message handling ───────────────────────────────────────

  private handleRawMessage(raw: WebSocket.RawData): void {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString());
    } catch (e: unknown) {
      log.debug({ err: String(e) }, 'malformed WS frame');
      return;
    }

    if (json == null || typeof json !== 'object') return;
    const obj = json as Record<string, unknown>;
    if (obj['op'] === 'subscribe' || obj['op'] === 'pong' || obj['success'] !== undefined) return;

    const parsed = BybitWsMessageSchema.safeParse(json);
    if (!parsed.success) return; // Not a ticker message — heartbeat, error, etc.

    const msg = parsed.data;
    if (!msg.topic.startsWith('tickers.')) return;

    const exchangeSymbol = msg.data.symbol;
    if (!this.instrumentMap.has(exchangeSymbol)) return;

    // ts is on the message envelope, not inside data
    this.emitQuoteUpdate(exchangeSymbol, this.wsTickerToQuote(msg.data, msg.ts));
  }

  // ── Normalizers — separate for REST vs WS field names ─────────

  /** REST uses bid1Price/ask1Price/bid1Size/ask1Size/bid1Iv/ask1Iv/markIv */
  private restTickerToQuote(t: BybitRestTicker): LiveQuote {
    return {
      bidPrice: this.safeNum(t.bid1Price),
      askPrice: this.safeNum(t.ask1Price),
      bidSize: this.safeNum(t.bid1Size),
      askSize: this.safeNum(t.ask1Size),
      markPrice: this.safeNum(t.markPrice),
      lastPrice: this.safeNum(t.lastPrice),
      underlyingPrice: this.safeNum(t.underlyingPrice),
      indexPrice: this.safeNum(t.indexPrice),
      volume24h: this.safeNum(t.volume24h),
      openInterest: this.safeNum(t.openInterest),
      openInterestUsd: null,
      volume24hUsd: this.safeNum(t.turnover24h),
      greeks: {
        delta: this.safeNum(t.delta),
        gamma: this.safeNum(t.gamma),
        theta: this.safeNum(t.theta),
        vega: this.safeNum(t.vega),
        rho: null,
        markIv: this.safeNum(t.markIv),
        bidIv: this.safeNum(t.bid1Iv),
        askIv: this.safeNum(t.ask1Iv),
      },
      timestamp: Date.now(),
    };
  }

  /** WS uses bidPrice/askPrice/bidSize/askSize/bidIv/askIv/markPriceIv */
  private wsTickerToQuote(t: BybitWsTicker, envelopeTs: number): LiveQuote {
    return {
      bidPrice: this.safeNum(t.bidPrice),
      askPrice: this.safeNum(t.askPrice),
      bidSize: this.safeNum(t.bidSize),
      askSize: this.safeNum(t.askSize),
      markPrice: this.safeNum(t.markPrice),
      lastPrice: this.safeNum(t.lastPrice),
      underlyingPrice: this.safeNum(t.underlyingPrice),
      indexPrice: this.safeNum(t.indexPrice),
      volume24h: this.safeNum(t.volume24h),
      openInterest: this.safeNum(t.openInterest),
      openInterestUsd: null,
      volume24hUsd: this.safeNum(t.turnover24h),
      greeks: {
        delta: this.safeNum(t.delta),
        gamma: this.safeNum(t.gamma),
        theta: this.safeNum(t.theta),
        vega: this.safeNum(t.vega),
        rho: null,
        markIv: this.safeNum(t.markPriceIv),
        bidIv: this.safeNum(t.bidIv),
        askIv: this.safeNum(t.askIv),
      },
      timestamp: envelopeTs,
    };
  }

  // ── helpers ───────────────────────────────────────────────────

  private async fetchJson(url: URL): Promise<unknown> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Bybit ${url.pathname} returned ${res.status}`);
    return res.json();
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  override async dispose(): Promise<void> {
    this.shouldReconnect = false;
    this.stopPing();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    await this.unsubscribeAll();
    this.ws?.close();
    this.ws = null;
  }
}
