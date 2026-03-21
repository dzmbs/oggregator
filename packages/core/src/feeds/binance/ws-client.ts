import WebSocket from 'ws';
import { SdkBaseAdapter, type CachedInstrument, type LiveQuote } from '../shared/sdk-base.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import {
  BinanceCombinedStreamSchema,
  BinanceInstrumentSchema,
  BinanceMarkPriceSchema,
} from './types.js';

const log = feedLogger('binance');

const EAPI_BASE = 'https://eapi.binance.com';
const WS_BASE = 'wss://fstream.binance.com/market/stream';

/**
 * Binance European Options (EAPI) adapter.
 *
 * REST (instrument loading only):
 *   - GET /eapi/v1/exchangeInfo → instrument catalog
 *
 * WebSocket (all live data via bulk streams):
 *   - `btcusdt@optionMarkPrice` on /market/stream
 *   - Delivers ALL option data for an underlying in one push every 1s:
 *     mark price, greeks, bid/ask, IV, index price
 *
 * WS field mapping (verified live 2026-03-20):
 *   s=symbol, mp=markPrice, i=indexPrice, bo=bestBid, ao=bestAsk,
 *   bq=bidQty, aq=askQty, vo=markIV, b=bidIV, a=askIV,
 *   d=delta, t=theta, g=gamma, v=vega, rf=riskFreeRate,
 *   E=eventTime, e=eventType("markPrice")
 *
 * Underlying name format: "btcusdt" (lowercase, includes quote asset)
 * Stream name: "<underlying>@optionMarkPrice"
 * URL: wss://fstream.binance.com/market/stream (combined stream endpoint)
 *
 * Settlement: USDT-settled, linear. No inverse conversion needed.
 */
export class BinanceWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'binance';

  // Binance optionMarkPrice is already a bulk stream covering ALL options.
  // No need for per-expiry eager subscription.
  protected override eagerExpiryCount = 0;

  private ws: WebSocket | null = null;
  private subscribedStreams = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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

    return instruments;
  }

  private parseInstrument(item: unknown): CachedInstrument | null {
    const parsed = BinanceInstrumentSchema.safeParse(item);
    if (!parsed.success) return null;

    const { symbol: sym, quoteAsset, unit, minQty, filters } = parsed.data;
    // Strike can be decimal for low-price assets (DOGE: 0.085, XRP: 1.5)
    const parts = sym.match(/^(\w+)-(\d{6})-([\d.]+)-([CP])$/);
    if (!parts) return null;

    const base = parts[1]!;
    const expiryRaw = parts[2]!;
    const strikeStr = parts[3]!;
    const rightChar = parts[4]!;
    const settle = quoteAsset ?? 'USDT';
    const expiry = this.parseExpiry(expiryRaw);
    const right = rightChar === 'C' ? 'call' as const : 'put' as const;

    const priceFilter = filters?.find(f => f.filterType === 'PRICE_FILTER');

    return {
      symbol: this.buildCanonicalSymbol(base, settle, expiry, Number(strikeStr), right),
      exchangeSymbol: sym,
      base,
      quote: settle,
      settle,
      expiry,
      strike: Number(strikeStr),
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
          const base = key.split('-')[0]!.toLowerCase();
          seen.add(base);
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

  // ── WebSocket connection ──────────────────────────────────────

  private async connectAndSubscribe(instruments: CachedInstrument[]): Promise<void> {
    // Binance stream names use lowercase underlying+settle: "btcusdt", "ethusdt"
    const underlyings = new Set<string>();
    for (const inst of instruments) {
      underlyings.add(`${inst.base.toLowerCase()}${inst.settle.toLowerCase()}`);
    }

    const streams = [...underlyings].map(u => `${u}@optionMarkPrice`);

    await this.connectWs();

    for (const stream of streams) {
      if (!this.subscribedStreams.has(stream)) {
        this.subscribedStreams.add(stream);
      }
    }

    this.sendSubscribe([...this.subscribedStreams]);
  }

  private connectWs(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) { resolve(); return; }

      this.shouldReconnect = true;
      this.ws = new WebSocket(WS_BASE);

      this.ws.on('open', () => {
        log.info('ws connected');
        this.emitStatus('connected');
        resolve();
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleWsMessage(msg);
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

      this.ws.on('ping', () => {
        this.ws?.pong();
      });
    });
  }

  private sendSubscribe(streams: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      method: 'SUBSCRIBE',
      params: streams,
      id: ++this.msgId,
    }));
    log.info({ count: streams.length, streams }, 'subscribed to streams');
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connectWs();
        if (this.subscribedStreams.size > 0) {
          this.sendSubscribe([...this.subscribedStreams]);
        }
      } catch (e: unknown) {
        log.warn({ err: String(e) }, 'reconnect failed');
        this.scheduleReconnect();
      }
    }, 3000);
  }

  // ── subscriptions ─────────────────────────────────────────────

  protected async subscribeChain(
    underlying: string,
    _expiry: string,
    _instruments: CachedInstrument[],
  ): Promise<void> {
    // optionMarkPrice is a bulk stream — one sub covers ALL options for an underlying
    const stream = `${underlying.toLowerCase()}usdt@optionMarkPrice`;
    if (this.subscribedStreams.has(stream)) return;

    this.subscribedStreams.add(stream);
    this.sendSubscribe([stream]);
  }

  protected async unsubscribeAll(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.subscribedStreams.size === 0) return;
    this.ws.send(JSON.stringify({
      method: 'UNSUBSCRIBE',
      params: [...this.subscribedStreams],
      id: ++this.msgId,
    }));
    this.subscribedStreams.clear();
  }

  // ── WS message handling ───────────────────────────────────────

  private handleWsMessage(msg: unknown): void {
    const envelope = BinanceCombinedStreamSchema.safeParse(msg);
    if (!envelope.success) return;

    for (const rawItem of envelope.data.data) {
      const item = BinanceMarkPriceSchema.safeParse(rawItem);
      if (!item.success) continue;

      const exchangeSymbol = item.data.s;
      // instrumentMap isn't populated until after fetchInstruments returns — store first, emit later

      const quote: LiveQuote = {
        bidPrice: this.safeNum(item.data.bo),
        askPrice: this.safeNum(item.data.ao),
        bidSize: this.safeNum(item.data.bq),
        askSize: this.safeNum(item.data.aq),
        markPrice: this.safeNum(item.data.mp),
        lastPrice: null,
        underlyingPrice: this.safeNum(item.data.i),
        indexPrice: this.safeNum(item.data.i),
        volume24h: null,
        openInterest: null,
        greeks: {
          delta: this.safeNum(item.data.d),
          gamma: this.safeNum(item.data.g),
          theta: this.safeNum(item.data.t),
          vega: this.safeNum(item.data.v),
          rho: null,
          markIv: this.safeNum(item.data.vo),
          bidIv: this.safeNum(item.data.b),
          askIv: this.safeNum(item.data.a),
        },
        timestamp: item.data.E ?? Date.now(),
      };

      this.quoteStore.set(exchangeSymbol, quote);

      if (this.instrumentMap.has(exchangeSymbol)) {
        this.emitQuoteUpdate(exchangeSymbol, quote);
      }
    }
  }

  // ── helpers ───────────────────────────────────────────────────

  private async fetchEapi(path: string): Promise<unknown> {
    const res = await fetch(`${EAPI_BASE}${path}`);
    if (!res.ok) throw new Error(`Binance EAPI ${path} returned ${res.status}`);
    return res.json() as Promise<unknown>;
  }

  override async dispose(): Promise<void> {
    this.shouldReconnect = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    await this.unsubscribeAll();
    this.ws?.close();
    this.ws = null;
  }
}
