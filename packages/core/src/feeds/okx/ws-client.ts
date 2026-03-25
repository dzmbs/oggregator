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
  OkxWsOptSummaryMsgSchema,
  OkxWsTickerMsgSchema,
  OKX_OPTION_SYMBOL_RE,
  type OkxTicker,
  type OkxOptSummary,
  type OkxInstrument,
} from './types.js';

const log = feedLogger('okx');

/**
 * OKX options adapter using raw WebSocket + fetch.
 *
 * REST (instrument loading + initial snapshot):
 *   GET /api/v5/public/instruments?instType=OPTION&instFamily=BTC-USD
 *   GET /api/v5/market/tickers?instType=OPTION&instFamily=BTC-USD
 *   GET /api/v5/public/opt-summary?instFamily=BTC-USD
 *
 * WebSocket (live updates):
 *   wss://ws.okx.com:8443/ws/v5/public
 *   - opt-summary (instFamily=BTC-USD) → bulk greeks for ALL options
 *   - tickers (instId=X) → per-instrument bid/ask/last
 *
 * opt-summary has NO markPx — mark price is not available from any OKX bulk endpoint.
 * fwdPx (forward price) serves as the underlying/index price proxy.
 *
 * Settlement: BTC/ETH options are coin-margined (inverse).
 *   Prices are in BTC/ETH — multiply by underlyingPrice for USD.
 */
export class OkxWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'okx';

  // OKX has a 480 subscribe requests/hr rate limit.
  // opt-summary is already bulk for greeks; only ticker needs per-instrument subs.
  // Limit eager subscription to 1 nearest expiry to stay within budget.
  protected override eagerExpiryCount = 1;

  private ws: WebSocket | null = null;
  private subscribedFamilies = new Set<string>();
  private subscribedTickers = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private static readonly INST_FAMILIES = ['BTC-USD', 'ETH-USD'];

  protected initClients(): void {}

  // ── instrument loading ────────────────────────────────────────

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    const instruments: CachedInstrument[] = [];

    for (const instFamily of OkxWsAdapter.INST_FAMILIES) {
      try {
        const data = await this.fetchOkxApi('/api/v5/public/instruments', { instType: 'OPTION', instFamily });
        for (const raw of data) {
          const parsed = OkxInstrumentSchema.safeParse(raw);
          if (!parsed.success) continue;

          const inst = this.parseInstrument(parsed.data);
          if (inst) instruments.push(inst);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ instFamily, err: message }, 'failed to load instruments');
      }
    }

    log.info({ count: instruments.length }, 'loaded option instruments');

    await this.fetchBulkSnapshot();

    return instruments;
  }

  private parseInstrument(item: OkxInstrument): CachedInstrument | null {
    const match = OKX_OPTION_SYMBOL_RE.exec(item.instId);
    if (!match) return null;

    const base = match[1]!;
    const expiryRaw = match[3]!;
    const strikeStr = match[4]!;
    const rightChar = match[5]!;
    const expiry = this.parseExpiry(expiryRaw);
    const right = rightChar === 'C' ? 'call' as const : 'put' as const;
    const settle = item.settleCcy ?? base;

    return {
      symbol: this.buildCanonicalSymbol(base, settle, expiry, Number(strikeStr), right),
      exchangeSymbol: item.instId,
      base,
      quote: 'USD',
      settle,
      expiry,
      strike: Number(strikeStr),
      right,
      // BTC-USD options settle in BTC → inverse pricing
      inverse: settle === base,
      contractSize: this.safeNum(item.ctMult) ?? this.safeNum(item.ctVal) ?? 1,
      tickSize: this.safeNum(item.tickSz),
      minQty: this.safeNum(item.minSz),
      makerFee: 0.0002,
      takerFee: 0.0005,
    };
  }

  // ── initial REST snapshot ─────────────────────────────────────

  private async fetchBulkSnapshot(): Promise<void> {
    for (const instFamily of OkxWsAdapter.INST_FAMILIES) {
      try {
        const data = await this.fetchOkxApi('/api/v5/market/tickers', { instType: 'OPTION', instFamily });
        for (const raw of data) {
          const parsed = OkxTickerSchema.safeParse(raw);
          if (!parsed.success) continue;
          this.quoteStore.set(parsed.data.instId, this.tickerToQuote(parsed.data));
        }
        log.info({ count: data.length, instFamily }, 'fetched tickers');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ instFamily, err: message }, 'failed to fetch tickers');
      }

      try {
        const data = await this.fetchOkxApi('/api/v5/public/opt-summary', { instFamily });
        for (const raw of data) {
          const parsed = OkxOptSummarySchema.safeParse(raw);
          if (!parsed.success) continue;
          this.mergeOptSummary(parsed.data);
        }
        log.info({ count: data.length, instFamily }, 'fetched greeks');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ instFamily, err: message }, 'failed to fetch greeks');
      }

      // OI lives on a separate endpoint — merge into existing quotes
      try {
        const data = await this.fetchOkxApi('/api/v5/public/open-interest', { instType: 'OPTION', instFamily });
        let merged = 0;
        for (const raw of data) {
          const item = raw as { instId?: string; oi?: string; oiCcy?: string; oiUsd?: string };
          if (typeof item.instId !== 'string') continue;
          const prev = this.quoteStore.get(item.instId);
          if (prev) {
            prev.openInterest = this.safeNum(item.oiCcy);
            // oiUsd is per-contract USD value, not notional. Enrichment computes
            // the correct notional from oiCcy × underlyingPrice.
            merged++;
          }
        }
        log.info({ count: merged, instFamily }, 'fetched open interest');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ instFamily, err: message }, 'failed to fetch OI');
      }
    }
  }

  // ── WebSocket connection ──────────────────────────────────────

  protected async subscribeChain(
    underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    await this.ensureConnected();

    // opt-summary delivers greeks for ALL options in one subscription per instFamily
    const family = `${underlying}-USD`;
    if (!this.subscribedFamilies.has(family)) {
      this.sendJson({ op: 'subscribe', args: [{ channel: 'opt-summary', instFamily: family }] });
      this.subscribedFamilies.add(family);
      log.info({ family }, 'subscribed to opt-summary');
    }

    // tickers channel requires per-instId subscription — instFamily not supported for options
    const newSubs: Array<{ channel: string; instId: string }> = [];
    for (const inst of instruments) {
      if (!this.subscribedTickers.has(inst.exchangeSymbol)) {
        newSubs.push({ channel: 'tickers', instId: inst.exchangeSymbol });
        this.subscribedTickers.add(inst.exchangeSymbol);
      }
    }

    if (newSubs.length > 0) {
      for (const sub of newSubs) {
        this.sendJson({ op: 'subscribe', args: [sub] });
      }
      log.info({ count: newSubs.length }, 'subscribed to ticker channels');
    }
  }

  protected async unsubscribeAll(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    for (const family of this.subscribedFamilies) {
      this.sendJson({ op: 'unsubscribe', args: [{ channel: 'opt-summary', instFamily: family }] });
    }
    for (const instId of this.subscribedTickers) {
      this.sendJson({ op: 'unsubscribe', args: [{ channel: 'tickers', instId }] });
    }
    this.subscribedFamilies.clear();
    this.subscribedTickers.clear();
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

  // OKX drops idle connections — must send "ping" text (not WS frame) every 25s
  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
      }
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
        for (const family of this.subscribedFamilies) {
          this.sendJson({ op: 'subscribe', args: [{ channel: 'opt-summary', instFamily: family }] });
        }
        for (const instId of this.subscribedTickers) {
          this.sendJson({ op: 'subscribe', args: [{ channel: 'tickers', instId }] });
        }
      } catch (e: unknown) {
        log.warn({ err: String(e) }, 'reconnect failed');
        this.scheduleReconnect();
      }
    }, delay);
  }

  // ── WS message handling ───────────────────────────────────────

  private handleRawMessage(raw: WebSocket.RawData): void {
    const str = raw.toString();

    if (str === 'pong') return;

    let json: unknown;
    try {
      json = JSON.parse(str);
    } catch (e: unknown) {
      log.debug({ err: String(e) }, 'malformed WS frame');
      return;
    }

    if (json == null || typeof json !== 'object') return;
    const obj = json as Record<string, unknown>;
    if (obj['event'] === 'subscribe' || obj['event'] === 'unsubscribe' || obj['event'] === 'error') return;

    const optSummary = OkxWsOptSummaryMsgSchema.safeParse(json);
    if (optSummary.success) {
      for (const item of optSummary.data.data) {
        this.handleWsOptSummary(item);
      }
      return;
    }

    const ticker = OkxWsTickerMsgSchema.safeParse(json);
    if (ticker.success) {
      for (const item of ticker.data.data) {
        this.handleWsTicker(item);
      }
      return;
    }
  }

  private handleWsOptSummary(item: OkxOptSummary): void {
    const id = item.instId;
    if (!this.instrumentMap.has(id)) return;

    const prev = this.quoteStore.get(id);
    const quote: LiveQuote = {
      bidPrice: prev?.bidPrice ?? null,
      askPrice: prev?.askPrice ?? null,
      bidSize: prev?.bidSize ?? null,
      askSize: prev?.askSize ?? null,
      markPrice: prev?.markPrice ?? null,
      lastPrice: prev?.lastPrice ?? null,
      underlyingPrice: this.safeNum(item.fwdPx) ?? prev?.underlyingPrice ?? null,
      indexPrice: null,
      volume24h: prev?.volume24h ?? null,
      openInterest: prev?.openInterest ?? null,
      openInterestUsd: prev?.openInterestUsd ?? null,
      volume24hUsd: prev?.volume24hUsd ?? null,
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
    const volContracts = this.safeNum(item.vol24h) ?? null;
    const ctSize = inst.contractSize ?? 0.01;
    const volBase = volContracts != null ? volContracts * ctSize : prev?.volume24h ?? null;
    const underlying = prev?.underlyingPrice ?? null;
    const volUsd = volBase != null && underlying != null
      ? volBase * underlying
      : prev?.volume24hUsd ?? null;

    const quote: LiveQuote = {
      bidPrice: this.safeNum(item.bidPx),
      askPrice: this.safeNum(item.askPx),
      bidSize: this.safeNum(item.bidSz),
      askSize: this.safeNum(item.askSz),
      markPrice: prev?.markPrice ?? null,
      lastPrice: this.safeNum(item.last),
      underlyingPrice: prev?.underlyingPrice ?? null,
      indexPrice: null,
      volume24h: volBase,
      openInterest: prev?.openInterest ?? null,
      openInterestUsd: prev?.openInterestUsd ?? null,
      volume24hUsd: volUsd,
      greeks: prev?.greeks ?? { ...EMPTY_GREEKS },
      timestamp: Number(item.ts) || Date.now(),
    };

    this.emitQuoteUpdate(id, quote);
  }

  // ── normalizers ───────────────────────────────────────────────

  private tickerToQuote(t: OkxTicker): LiveQuote {
    const inst = this.instrumentMap.get(t.instId);
    const volContracts = this.safeNum(t.vol24h);
    const ctSize = inst?.contractSize ?? 0.01;
    // Convert from contracts to base currency so enrichment's fallback
    // (volume24h × underlyingPrice) produces correct notional.
    const volBase = volContracts != null ? volContracts * ctSize : null;

    return {
      bidPrice: this.safeNum(t.bidPx),
      askPrice: this.safeNum(t.askPx),
      bidSize: this.safeNum(t.bidSz),
      askSize: this.safeNum(t.askSz),
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
        bidPrice: null,
        askPrice: null,
        bidSize: null,
        askSize: null,
        markPrice: null,
        lastPrice: null,
        underlyingPrice: this.safeNum(item.fwdPx),
        indexPrice: null,
        volume24h: null,
        openInterest: null,
        openInterestUsd: null,
        volume24hUsd: null,
        greeks: this.parseGreeks(item),
        timestamp: Number(item.ts) || Date.now(),
      });
    }
  }

  /**
   * Parse OKX greeks from opt-summary.
   * Prefer Black-Scholes values (deltaBS/gammaBS/etc) — these are USD-denominated.
   * Fall back to coin-denominated values (delta/gamma/etc).
   */
  private parseGreeks(item: OkxOptSummary): OptionGreeks {
    return {
      delta: this.safeNum(item.deltaBS) ?? this.safeNum(item.delta),
      gamma: this.safeNum(item.gammaBS) ?? this.safeNum(item.gamma),
      theta: this.safeNum(item.thetaBS) ?? this.safeNum(item.theta),
      vega: this.safeNum(item.vegaBS) ?? this.safeNum(item.vega),
      rho: null,
      markIv: this.safeNum(item.markVol),
      bidIv: this.safeNum(item.bidVol),
      askIv: this.safeNum(item.askVol),
    };
  }

  // ── helpers ───────────────────────────────────────────────────

  private async fetchOkxApi(path: string, params: Record<string, string>): Promise<unknown[]> {
    const url = new URL(path, OKX_REST_BASE_URL);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`OKX ${path} returned ${res.status}`);

    const json: unknown = await res.json();
    const parsed = OkxRestResponseSchema.safeParse(json);

    if (!parsed.success) {
      throw new Error(`OKX ${path} response validation failed: ${parsed.error.message}`);
    }

    if (parsed.data.code !== '0') {
      throw new Error(`OKX ${path} error ${parsed.data.code}: ${parsed.data.msg}`);
    }

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
    await this.unsubscribeAll();
    this.ws?.close();
    this.ws = null;
  }
}
