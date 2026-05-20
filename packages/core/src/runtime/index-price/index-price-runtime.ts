import WebSocket from 'ws';
import {
  GATEIO_OPTIONS_UNDERLYINGS,
  GATEIO_REST_BASE_URL,
} from '../../feeds/shared/endpoints.js';
import { buildBsInfoSubscribeMessage } from '../../feeds/coincall/planner.js';
import { CoincallBsInfoMessageSchema } from '../../feeds/coincall/types.js';
import { buildSignedWsUrl } from '../../feeds/coincall/ws-client.js';
import { fromGateioRestBase } from '../../feeds/gateio/aliases.js';
import { GateioUnderlyingsResponseSchema } from '../../feeds/gateio/types.js';
import { fetchCoincallInstrumentsForBase } from '../trades/trade-runtime.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import { backoffDelay } from '../../utils/reconnect.js';

const log = feedLogger('index-price');

const GATEIO_POLL_INTERVAL_MS = 30 * 1000;
const GATEIO_REQUEST_TIMEOUT_MS = 10 * 1000;
const COINCALL_HEARTBEAT_INTERVAL_MS = 15 * 1000;

export interface IndexPriceRuntimeStartOptions {
  gateio?: boolean;
  coincallUnderlyings?: string[];
}

/**
 * Per-venue index price tracker used as the third tier in mapLiveTrade's
 * referencePriceUsd lookup, behind trade.indexPrice (1) and Binance USDT
 * SpotRuntime (2). Covers underlyings with no Binance USDT spot pair —
 * commodity bases like XTI/CL, and Coincall-only altcoins like MNT/LIT/KAS.
 */
export class IndexPriceRuntime {
  private prices = new Map<string, number>();
  private gateioTimer: ReturnType<typeof setInterval> | null = null;
  private coincallWs: WebSocket | null = null;
  private coincallKeepalive: ReturnType<typeof setInterval> | null = null;
  private coincallReconnect: ReturnType<typeof setTimeout> | null = null;
  private coincallSymbolByUnderlying = new Map<string, string>();
  private coincallUnderlyingBySymbol = new Map<string, string>();
  private shouldReconnect = true;
  private started = false;

  async start(opts: IndexPriceRuntimeStartOptions = {}): Promise<void> {
    // Idempotent: a second start() would leak timers and double-open the WS.
    if (this.started) return;
    this.started = true;
    this.shouldReconnect = true;

    if (opts.gateio) {
      void this.refreshGateio();
      this.gateioTimer = setInterval(() => void this.refreshGateio(), GATEIO_POLL_INTERVAL_MS);
    }

    const coincallUnderlyings = opts.coincallUnderlyings ?? [];
    if (coincallUnderlyings.length > 0 && hasCoincallCredentials()) {
      await this.resolveCoincallSymbols(coincallUnderlyings);
      if (this.coincallSymbolByUnderlying.size > 0) {
        this.connectCoincall();
      }
    }
  }

  get(venue: VenueId, underlying: string): number | null {
    return this.prices.get(`${venue}:${underlying.toUpperCase()}`) ?? null;
  }

  dispose(): void {
    this.started = false;
    this.shouldReconnect = false;
    if (this.gateioTimer != null) {
      clearInterval(this.gateioTimer);
      this.gateioTimer = null;
    }
    if (this.coincallKeepalive != null) {
      clearInterval(this.coincallKeepalive);
      this.coincallKeepalive = null;
    }
    if (this.coincallReconnect != null) {
      clearTimeout(this.coincallReconnect);
      this.coincallReconnect = null;
    }
    if (this.coincallWs != null) {
      this.coincallWs.close();
      this.coincallWs = null;
    }
    this.prices.clear();
    this.coincallSymbolByUnderlying.clear();
    this.coincallUnderlyingBySymbol.clear();
  }

  private async refreshGateio(): Promise<void> {
    try {
      const url = new URL(GATEIO_OPTIONS_UNDERLYINGS, GATEIO_REST_BASE_URL);
      const res = await fetch(url, { signal: AbortSignal.timeout(GATEIO_REQUEST_TIMEOUT_MS) });
      if (!res.ok) {
        log.warn({ status: res.status }, 'gateio underlyings refresh failed');
        return;
      }
      const data = (await res.json()) as unknown;
      const parsed = GateioUnderlyingsResponseSchema.safeParse(data);
      if (!parsed.success) {
        log.warn('gateio underlyings response failed schema');
        return;
      }
      for (const item of parsed.data) {
        const parts = item.name.split('_');
        const rawBase = parts[0];
        if (!rawBase) continue;
        const publicBase = fromGateioRestBase(rawBase);
        const price = Number(item.index_price);
        if (!Number.isFinite(price) || price <= 0) continue;
        this.prices.set(`gateio:${publicBase}`, price);
      }
    } catch (err) {
      log.warn({ err: String(err) }, 'gateio underlyings refresh error');
    }
  }

  private async resolveCoincallSymbols(underlyings: string[]): Promise<void> {
    // Coincall's bsInfo channel is per-symbol but `up` (underlying price) is
    // invariant across symbols of the same base. Pick the first active symbol
    // per base — any will do.
    for (const u of underlyings) {
      const base = u.toUpperCase();
      try {
        const symbols = await fetchCoincallInstrumentsForBase(base);
        const sample = symbols[0];
        if (sample) {
          this.coincallSymbolByUnderlying.set(base, sample);
          this.coincallUnderlyingBySymbol.set(sample, base);
        }
      } catch (err) {
        log.warn({ underlying: base, err: String(err) }, 'coincall symbol resolution failed');
      }
    }
  }

  private connectCoincall(attempt = 0): void {
    if (!this.shouldReconnect || this.coincallSymbolByUnderlying.size === 0) return;

    const ws = new WebSocket(buildSignedWsUrl());
    let openedAt = 0;

    ws.on('open', () => {
      openedAt = Date.now();
      log.info(
        { underlyings: [...this.coincallSymbolByUnderlying.keys()].join(',') },
        'coincall index ws connected',
      );
      for (const symbol of this.coincallSymbolByUnderlying.values()) {
        ws.send(JSON.stringify(buildBsInfoSubscribeMessage(symbol)));
      }
      if (this.coincallKeepalive != null) clearInterval(this.coincallKeepalive);
      this.coincallKeepalive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'heartbeat' }));
        }
      }, COINCALL_HEARTBEAT_INTERVAL_MS);
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const json = JSON.parse(raw.toString());
        const parsed = CoincallBsInfoMessageSchema.safeParse(json);
        if (!parsed.success) return;
        const symbol = parsed.data.d.s;
        const up = parsed.data.d.up;
        if (up == null) return;
        const underlying = this.coincallUnderlyingBySymbol.get(symbol);
        if (underlying == null) return;
        this.prices.set(`coincall:${underlying}`, up);
      } catch {
        // Ignore malformed frames.
      }
    });

    ws.on('close', () => {
      this.coincallWs = null;
      if (this.coincallKeepalive != null) {
        clearInterval(this.coincallKeepalive);
        this.coincallKeepalive = null;
      }
      if (!this.shouldReconnect) return;
      const opened = openedAt > 0;
      const nextAttempt = opened ? 0 : attempt + 1;
      const delay = backoffDelay(nextAttempt);
      this.coincallReconnect = setTimeout(() => {
        this.coincallReconnect = null;
        this.connectCoincall(nextAttempt);
      }, delay);
    });

    ws.on('error', (err) => {
      log.warn({ err: err.message }, 'coincall index ws error');
    });

    this.coincallWs = ws;
  }
}

function hasCoincallCredentials(): boolean {
  return Boolean(process.env['COINCALL_API_KEY'] && process.env['COINCALL_API_SECRET']);
}
