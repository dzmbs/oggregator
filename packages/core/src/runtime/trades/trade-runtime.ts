import WebSocket from 'ws';
import { z } from 'zod';
import {
  BINANCE_OPTIONS_WS_URL,
  BYBIT_RECENT_TRADE,
  BYBIT_REST_BASE_URL,
  BYBIT_WS_URL,
  COINCALL_INSTRUMENTS,
  COINCALL_LAST_TRADE,
  COINCALL_REST_BASE_URL,
  DERIBIT_WS_URL,
  DERIVE_WS_URL,
  GATEIO_OPTIONS_CONTRACTS,
  GATEIO_OPTIONS_TRADES,
  GATEIO_OPTIONS_WS_URL,
  GATEIO_REST_BASE_URL,
  OKX_INSTRUMENT_FAMILY_TRADES,
  OKX_REST_BASE_URL,
  OKX_WS_URL,
  THALEX_MARKET_WS_URL,
} from '../../feeds/shared/endpoints.js';
import { buildSignedWsUrl } from '../../feeds/coincall/ws-client.js';
import { toGateioRestBase } from '../../feeds/gateio/aliases.js';
import { GateioWsEnvelopeSchema, GateioWsTradeSchema } from '../../feeds/gateio/types.js';
import type { VenueId } from '../../types/common.js';
import { startEventLoopLagMonitor } from '../../utils/event-loop-lag.js';
import { feedLogger } from '../../utils/logger.js';
import { backoffDelay } from '../../utils/reconnect.js';
import { createTradeStreamState, mergeTradeStreamState } from './health.js';
import { filterTradesByMinNotional, pushTradeEvents } from './retention.js';
import type { TradeEvent, TradeRuntimeHealth, TradeStreamState, VenueStream } from './types.js';

const log = feedLogger('trade-runtime');

// Watchdog fires level:50 and force-closes a connection whose lastMessageAt
// hasn't advanced within this window. With keepalives sending inbound pongs
// every 20-180s per venue, a 5-minute gap is unambiguous zombie state.
const STALENESS_THRESHOLD_MS = 5 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 30 * 1000;

/**
 * Subscribes to bulk option trade streams across all 7 venues.
 * Maintains a ring buffer of the last N trades per underlying.
 */
export class TradeRuntime {
  private buffers = new Map<string, TradeEvent[]>();
  private connections = new Map<string, WebSocket>();
  private keepaliveTimers = new Map<string, ReturnType<typeof setInterval>>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reseedTimers = new Map<string, ReturnType<typeof setInterval>>();
  private subscribedUnderlyingsByConnection = new Map<string, Set<string>>();
  private listeners = new Set<(trade: TradeEvent) => void>();
  private streamState = new Map<string, TradeStreamState>();
  private shouldReconnect = true;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private stopEventLoopMonitor: (() => void) | null = null;

  async start(underlyings: string[] = ['BTC', 'ETH']): Promise<void> {
    // Open live WS connections first so callers can serve /flow without waiting for REST seeds.
    for (const underlying of underlyings) {
      this.buffers.set(underlying, []);
      for (const stream of VENUE_STREAMS) {
        this.streamState.set(this.streamKey(stream.venue, underlying), createTradeStreamState());

        if (stream.venue === 'deribit' && getDeribitTradeCurrency(underlying) == null) {
          continue;
        }
        if (stream.venue === 'coincall' && !isCoincallTradeUnderlyingSupported(underlying)) {
          logCoincallFilteredAtStartup(underlying);
          continue;
        }
        if (stream.venue === 'thalex' && !isThalexTradeUnderlyingSupported(underlying)) {
          continue;
        }

        this.registerConnectionUnderlying(stream, underlying);
        this.connectStream(stream, underlying);
      }
    }

    // Seed recent trades in the background. Slow REST venues must not delay live flow availability.
    void Promise.allSettled(underlyings.map((u) => this.seedFromRest(u)));

    this.startReseedTimers(underlyings);

    this.watchdogTimer = setInterval(() => this.checkStreamLiveness(), WATCHDOG_INTERVAL_MS);
    this.stopEventLoopMonitor = startEventLoopLagMonitor();
  }

  private startReseedTimers(underlyings: string[]): void {
    for (const stream of VENUE_STREAMS) {
      if (stream.seed == null || stream.reseedIntervalMs == null) continue;
      for (const underlying of underlyings) {
        if (stream.venue === 'coincall' && !isCoincallTradeUnderlyingSupported(underlying)) continue;
        if (stream.venue === 'thalex' && !isThalexTradeUnderlyingSupported(underlying)) continue;
        if (stream.venue === 'deribit' && getDeribitTradeCurrency(underlying) == null) continue;

        const key = this.streamKey(stream.venue, underlying);
        if (this.reseedTimers.has(key)) continue;

        const timer = setInterval(() => {
          void this.runVenueReseed(stream, underlying);
        }, stream.reseedIntervalMs);
        this.reseedTimers.set(key, timer);
      }
    }
  }

  private async runVenueReseed(stream: VenueStream, underlying: string): Promise<void> {
    if (stream.seed == null) return;
    try {
      const trades = await stream.seed(underlying);
      if (trades.length === 0) return;
      this.updateStreamState(stream.venue, underlying, {
        seedTrades: trades.length,
        lastStatusAt: Date.now(),
      });
      this.pushTrades(underlying, trades);
      log.info(
        { venue: stream.venue, underlying, count: trades.length },
        'venue reseed completed',
      );
    } catch (err) {
      log.warn(
        { venue: stream.venue, underlying, err: String(err) },
        'venue reseed failed',
      );
    }
  }

  // Detects half-open TCP connections that report `connected:true` locally but
  // haven't received any inbound frames recently. Forces a terminate so the
  // existing close→reconnect path rebuilds the subscription from scratch.
  // Emits level:50 — the first error-level signal this runtime produces for
  // this failure mode, so any log aggregator will pick it up.
  private checkStreamLiveness(): void {
    if (!this.shouldReconnect) return;
    const now = Date.now();

    for (const [connectionKey, ws] of this.connections) {
      const subscribedUnderlyings = this.subscribedUnderlyingsByConnection.get(connectionKey);
      if (subscribedUnderlyings == null || subscribedUnderlyings.size === 0) continue;

      const colonIdx = connectionKey.indexOf(':');
      if (colonIdx < 0) continue;
      const venue = connectionKey.slice(0, colonIdx) as VenueId;

      let worstStaleMs = 0;
      let worstUnderlying: string | null = null;
      for (const underlying of subscribedUnderlyings) {
        const state = this.streamState.get(this.streamKey(venue, underlying));
        if (state == null || !state.connected || state.lastMessageAt == null) continue;
        const staleMs = now - state.lastMessageAt;
        if (staleMs > worstStaleMs) {
          worstStaleMs = staleMs;
          worstUnderlying = underlying;
        }
      }

      if (worstStaleMs >= STALENESS_THRESHOLD_MS && worstUnderlying != null) {
        log.error(
          {
            venue,
            underlying: worstUnderlying,
            connectionKey,
            staleMs: worstStaleMs,
            thresholdMs: STALENESS_THRESHOLD_MS,
          },
          'trade stream stale, forcing reconnect',
        );
        ws.terminate();
      }
    }
  }

  private async seedFromRest(underlying: string): Promise<void> {
    const seedStreams = VENUE_STREAMS.filter((stream) => stream.seed != null);
    const results = await Promise.allSettled(seedStreams.map((stream) => stream.seed!(underlying)));

    let total = 0;
    for (const [index, result] of results.entries()) {
      const stream = seedStreams[index];
      if (!stream) continue;

      if (result.status === 'rejected') {
        log.warn(
          { venue: stream.venue, underlying, err: String(result.reason) },
          'trade seed failed',
        );
        continue;
      }

      const count = result.value.length;
      this.updateStreamState(stream.venue, underlying, {
        seedTrades: count,
        lastStatusAt: Date.now(),
      });
      log.info({ venue: stream.venue, underlying, count }, 'trade seed completed');

      if (count === 0) continue;
      this.pushTrades(underlying, result.value);
      total += count;
    }

    if (total > 0) log.info({ underlying, count: total }, 'seeded trades total');
  }

  getTrades(underlying: string, minNotional = 0): TradeEvent[] {
    const buffer = this.buffers.get(underlying) ?? [];
    return filterTradesByMinNotional(buffer, minNotional);
  }

  subscribe(listener: (trade: TradeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getHealth(): TradeRuntimeHealth[] {
    return VENUE_STREAMS.flatMap((stream) =>
      Array.from(this.buffers.keys()).map((underlying) => {
        const currentState = this.streamState.get(this.streamKey(stream.venue, underlying));
        return {
          venue: stream.venue,
          underlying,
          connected: currentState?.connected ?? false,
          lastMessageAt: currentState?.lastMessageAt ?? null,
          lastTradeAt: currentState?.lastTradeAt ?? null,
          lastStatusAt: currentState?.lastStatusAt ?? null,
          reconnects: currentState?.reconnects ?? 0,
          errors: currentState?.errors ?? 0,
          seedTrades: currentState?.seedTrades ?? 0,
          bufferedTrades:
            this.buffers.get(underlying)?.filter((trade) => trade.venue === stream.venue).length ??
            0,
        } satisfies TradeRuntimeHealth;
      }),
    );
  }

  private connectStream(stream: VenueStream, underlying: string, attempt = 0): void {
    if (!this.shouldReconnect) return;

    const key = this.connectionKey(stream, underlying);
    if (this.connections.has(key) || this.reconnectTimers.has(key)) return;

    const subscribedUnderlyings = this.getConnectionUnderlyings(stream, underlying);
    const url = typeof stream.url === 'function' ? stream.url() : stream.url;
    const ws = new WebSocket(url);
    let didOpen = false;
    let openedAt = 0;

    ws.on('open', () => {
      didOpen = true;
      openedAt = Date.now();
      this.updateStreamStates(stream.venue, subscribedUnderlyings, {
        connected: true,
        lastStatusAt: Date.now(),
      });
      log.info(
        { venue: stream.venue, underlying: subscribedUnderlyings.join(',') },
        'trade stream connected',
      );
      stream.connect(ws, underlying);

      if (stream.startKeepalive) {
        const timer = stream.startKeepalive(ws);
        this.keepaliveTimers.set(key, timer);
      }
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        const now = Date.now();
        this.updateStreamStates(stream.venue, subscribedUnderlyings, { lastMessageAt: now });

        for (const subscribedUnderlying of subscribedUnderlyings) {
          const trades = stream.parse(msg, subscribedUnderlying);
          if (trades.length === 0) continue;

          this.updateStreamState(stream.venue, subscribedUnderlying, {
            lastTradeAt: Math.max(...trades.map((trade) => trade.timestamp)),
          });
          this.pushTrades(subscribedUnderlying, trades);
        }
      } catch {
        // Ignore malformed upstream frames.
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason.length > 0 ? reason.toString() : undefined;
      const uptimeMs = openedAt > 0 ? Date.now() - openedAt : undefined;
      log.warn(
        {
          venue: stream.venue,
          underlying: subscribedUnderlyings.join(','),
          closeCode: code,
          closeReason: reasonStr,
          uptimeMs,
        },
        'trade stream closed',
      );
      this.connections.delete(key);
      this.updateStreamStates(stream.venue, subscribedUnderlyings, {
        connected: false,
        lastStatusAt: Date.now(),
      });
      const ka = this.keepaliveTimers.get(key);
      if (ka) {
        clearInterval(ka);
        this.keepaliveTimers.delete(key);
      }

      if (this.shouldReconnect) {
        const nextAttempt = didOpen ? 0 : attempt + 1;
        for (const subscribedUnderlying of subscribedUnderlyings) {
          this.updateStreamState(stream.venue, subscribedUnderlying, {
            reconnects:
              (this.streamState.get(this.streamKey(stream.venue, subscribedUnderlying))
                ?.reconnects ?? 0) + 1,
          });
        }
        const delay = backoffDelay(nextAttempt);
        const timer = setTimeout(() => {
          this.reconnectTimers.delete(key);
          this.connectStream(stream, underlying, nextAttempt);
        }, delay);
        this.reconnectTimers.set(key, timer);
      }
    });

    ws.on('error', (err) => {
      for (const subscribedUnderlying of subscribedUnderlyings) {
        this.updateStreamState(stream.venue, subscribedUnderlying, {
          errors:
            (this.streamState.get(this.streamKey(stream.venue, subscribedUnderlying))?.errors ??
              0) + 1,
          lastStatusAt: Date.now(),
        });
      }
      log.warn(
        { venue: stream.venue, underlying: subscribedUnderlyings.join(','), err: err.message },
        'trade stream error',
      );
    });

    this.connections.set(key, ws);
  }

  private streamKey(venue: VenueId, underlying: string): string {
    return `${venue}:${underlying}`;
  }

  private connectionKey(stream: VenueStream, underlying: string): string {
    if (stream.venue !== 'deribit') return this.streamKey(stream.venue, underlying);
    const tradeCurrency = getDeribitTradeCurrency(underlying);
    return tradeCurrency
      ? this.streamKey(stream.venue, tradeCurrency)
      : this.streamKey(stream.venue, underlying);
  }

  private registerConnectionUnderlying(stream: VenueStream, underlying: string): void {
    const key = this.connectionKey(stream, underlying);
    const subscribedUnderlyings =
      this.subscribedUnderlyingsByConnection.get(key) ?? new Set<string>();
    subscribedUnderlyings.add(underlying);
    this.subscribedUnderlyingsByConnection.set(key, subscribedUnderlyings);
  }

  private getConnectionUnderlyings(stream: VenueStream, underlying: string): string[] {
    const key = this.connectionKey(stream, underlying);
    const subscribedUnderlyings = this.subscribedUnderlyingsByConnection.get(key);
    return subscribedUnderlyings ? [...subscribedUnderlyings] : [underlying];
  }

  private updateStreamState(
    venue: VenueId,
    underlying: string,
    patch: Partial<TradeStreamState>,
  ): void {
    const key = this.streamKey(venue, underlying);
    const current = this.streamState.get(key);
    if (!current) return;
    this.streamState.set(key, mergeTradeStreamState(current, patch));
  }

  private updateStreamStates(
    venue: VenueId,
    underlyings: string[],
    patch: Partial<TradeStreamState>,
  ): void {
    for (const underlying of underlyings) {
      this.updateStreamState(venue, underlying, patch);
    }
  }

  private pushTrades(underlying: string, trades: TradeEvent[]): void {
    const buffer = this.buffers.get(underlying);
    if (!buffer) return;
    pushTradeEvents(buffer, trades);
    for (const trade of trades) {
      for (const listener of this.listeners) {
        try {
          listener(trade);
        } catch (error) {
          log.warn({ err: String(error), venue: trade.venue, underlying }, 'trade listener failed');
        }
      }
    }
  }

  dispose(): void {
    this.shouldReconnect = false;
    if (this.watchdogTimer != null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.stopEventLoopMonitor != null) {
      this.stopEventLoopMonitor();
      this.stopEventLoopMonitor = null;
    }
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    for (const timer of this.keepaliveTimers.values()) clearInterval(timer);
    this.keepaliveTimers.clear();
    for (const timer of this.reseedTimers.values()) clearInterval(timer);
    this.reseedTimers.clear();
    for (const ws of this.connections.values()) ws.close();
    this.connections.clear();
    this.subscribedUnderlyingsByConnection.clear();
  }
}

// ── Per-venue stream definitions ──────────────────────────────

// ── Per-venue trade schemas ────────────────────────────────────

const numStr = z.union([z.string(), z.number()]).transform(Number).refine(Number.isFinite);
const optNum = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });
const sideStr = z
  .string()
  .transform((s) => s.toLowerCase())
  .pipe(z.enum(['buy', 'sell']));

const DeribitTradeSchema = z.object({
  instrument_name: z.string(),
  direction: z.enum(['buy', 'sell']),
  price: z.number(),
  amount: z.number(),
  iv: z.number().optional(),
  mark_price: z.number().optional(),
  index_price: z.number().optional(),
  block_trade_id: z.string().optional(),
  trade_id: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => (value != null ? String(value) : null)),
  trade_seq: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => (value != null ? String(value) : null)),
  timestamp: z.number(),
});

const OkxTradeSchema = z.object({
  instId: z.string(),
  side: sideStr,
  px: numStr,
  sz: numStr,
  fillVol: numStr.optional(),
  tradeId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => (value != null ? String(value) : null)),
  ts: numStr,
});

const BybitTradeSchema = z.object({
  s: z.string(),
  S: sideStr,
  p: numStr,
  v: numStr,
  iv: numStr.optional(),
  mP: optNum,
  iP: optNum,
  i: z.string().optional(),
  BT: z.boolean().optional(),
  T: z.number(),
});

const BinanceTradeSchema = z.object({
  e: z.literal('trade'),
  s: z.string(),
  S: sideStr,
  p: numStr,
  q: numStr,
  t: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => (value != null ? String(value) : null)),
  X: z.string().optional(),
  T: z.number(),
});

const DeriveTradeSchema = z.object({
  instrument_name: z.string(),
  direction: sideStr,
  trade_id: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => (value != null ? String(value) : null)),
  trade_price: numStr,
  trade_amount: numStr,
  mark_price: optNum,
  index_price: optNum,
  rfq_id: z.string().nullable().optional(),
  timestamp: z.number(),
});

const DERIBIT_INVERSE_OPTION_CURRENCIES = new Set(['BTC', 'ETH']);
const DERIBIT_USDC_OPTION_BASES = new Set(['AVAX', 'SOL', 'TRX', 'XRP']);

// Matches SUPPORTED_UNDERLYINGS in feeds/coincall/ws-client.ts.
const COINCALL_TRADE_UNDERLYINGS = new Set([
  'BTC',
  'ETH',
  'SOL',
  'BNB',
  'DOGE',
  'XRP',
  'LTC',
  'HYPE',
  'SUI',
  'XAUT',
  'AAVE',
  'TRX',
  'MATIC',
  'ORDI',
  'MNT',
  'WLFI',
  'ENA',
  'PENDLE',
  'LIT',
  'TRUMP',
  'KAS',
]);

// Thalex lists only BTC + ETH options. Matches feeds/thalex/ws-client.ts.
const THALEX_TRADE_UNDERLYINGS = new Set(['BTC', 'ETH']);

const GateioTradeListSchema = GateioWsTradeSchema.array();
const GATEIO_TRADE_BATCH = 50;
const GATEIO_PING_INTERVAL_MS = 15_000;
const GATEIO_REST_TIMEOUT_MS = 10_000;
// Backfills sparse altcoins whose new daily strikes list after the WS opens.
// 200 covers ~10 min of BTC/ETH activity comfortably; dedup in pushTradeEvents
// handles overlap with the live stream.
const GATEIO_TRADE_SEED_LIMIT = 200;
const GATEIO_TRADE_RESEED_INTERVAL_MS = 10 * 60 * 1000;

async function fetchGateioContractNames(underlying: string): Promise<string[]> {
  const url = new URL(GATEIO_OPTIONS_CONTRACTS, GATEIO_REST_BASE_URL);
  url.searchParams.set('underlying', `${underlying}_USDT`);
  const res = await fetch(url, { signal: AbortSignal.timeout(GATEIO_REST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`gateio: contracts ${res.status}`);
  const data = (await res.json()) as Array<{ name: string; is_active?: boolean }>;
  return data.filter((c) => c.is_active !== false).map((c) => c.name);
}

function gateioRowsToTradeEvents(
  rows: z.infer<typeof GateioTradeListSchema>,
  underlying: string,
): TradeEvent[] {
  // `publicBase` is the canonical name surfaced to the rest of the system
  // (e.g. 'XTI'); `restBase` matches Gate.io's contract prefix (e.g. 'CL').
  const publicBase = normalizeTradeUnderlying(underlying);
  const restBase = toGateioRestBase(publicBase);
  const prefix = `${restBase}_USDT-`;
  const out: TradeEvent[] = [];
  for (const t of rows) {
    if (!t.contract.startsWith(prefix)) continue;
    const magnitude = Math.abs(t.size);
    if (magnitude === 0) continue;
    // Gate.io encodes taker direction in the sign of `size` (positive = buy,
    // negative = sell). Verified against /api/v4/options/trades.
    const side: 'buy' | 'sell' = t.size > 0 ? 'buy' : 'sell';
    const priceNum = Number(t.price);
    if (!Number.isFinite(priceNum)) continue;
    out.push({
      venue: 'gateio',
      tradeId: `${t.contract}:${t.id}`,
      instrument: t.contract,
      underlying: publicBase,
      side,
      price: priceNum,
      size: magnitude,
      iv: null,
      markPrice: null,
      indexPrice: null,
      isBlock: false,
      timestamp: t.create_time_ms ?? t.create_time * 1000,
    });
  }
  return out;
}

async function fetchGateioRecentTrades(underlying: string): Promise<TradeEvent[]> {
  const publicBase = normalizeTradeUnderlying(underlying);
  const restBase = toGateioRestBase(publicBase);
  const url = new URL(GATEIO_OPTIONS_TRADES, GATEIO_REST_BASE_URL);
  url.searchParams.set('underlying', `${restBase}_USDT`);
  url.searchParams.set('limit', String(GATEIO_TRADE_SEED_LIMIT));
  const res = await fetch(url, { signal: AbortSignal.timeout(GATEIO_REST_TIMEOUT_MS) });
  // Gate.io returns 400 CONTRACT_NOT_FOUND for underlyings it doesn't list
  // (AVAX/TRX). Treat as empty rather than throwing so the reseed timer doesn't
  // log a warn every 10 min for known-unsupported assets.
  if (res.status === 400 || res.status === 404) return [];
  if (!res.ok) throw new Error(`gateio: trades ${res.status}`);
  const data = (await res.json()) as unknown;
  const parsed = GateioTradeListSchema.safeParse(data);
  if (!parsed.success) return [];
  return gateioRowsToTradeEvents(parsed.data, publicBase);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// recent_trades.<UNDERLYING>.options payload: each trade is a tuple
// [price, size, side, timestamp_seconds, instrument_name, implied_taker].
const ThalexTradeTupleSchema = z.tuple([
  z.number(),
  z.number(),
  z.enum(['buy', 'sell']),
  z.number(),
  z.string(),
  z.boolean(),
]);

function isThalexTradeUnderlyingSupported(underlying: string): boolean {
  return THALEX_TRADE_UNDERLYINGS.has(normalizeTradeUnderlying(underlying));
}

// lastTrade payload (dt:6): { q, sd, pr, s, ts }. `sd` is tradeSide: 1=buy, 2=sell.
const CoincallTradeEntrySchema = z.object({
  s: z.string(),
  sd: z.number(),
  pr: numStr,
  q: numStr,
  ts: z.number(),
});

// REST /open/option/trade/lasttrade/v1/{symbol} entry — `symbol` here is the
// base pair ("BTCUSD"), not the full instrument, so the instrument name must
// come from the request URL. `price`/`qty` arrive as numbers despite the docs.
const CoincallLastTradeRestSchema = z.object({
  price: numStr,
  qty: numStr,
  time: z.number(),
  tradeSide: z.number(),
});

const CoincallInstrumentEntrySchema = z.object({
  symbolName: z.string(),
  isActive: z.boolean(),
});

function isCoincallTradeUnderlyingSupported(underlying: string): boolean {
  if (!process.env['COINCALL_API_KEY'] || !process.env['COINCALL_API_SECRET']) return false;
  return COINCALL_TRADE_UNDERLYINGS.has(normalizeTradeUnderlying(underlying));
}

const coincallStartupFilterLogged = new Set<string>();

function logCoincallFilteredAtStartup(underlying: string): void {
  const normalized = normalizeTradeUnderlying(underlying);
  if (coincallStartupFilterLogged.has(normalized)) return;
  coincallStartupFilterLogged.add(normalized);

  if (!process.env['COINCALL_API_KEY'] || !process.env['COINCALL_API_SECRET']) {
    log.warn(
      { venue: 'coincall', underlying: normalized },
      'coincall trade stream disabled — COINCALL_API_KEY / COINCALL_API_SECRET missing',
    );
    return;
  }
  log.info(
    { venue: 'coincall', underlying: normalized },
    'coincall trade stream skipped — underlying not in COINCALL_TRADE_UNDERLYINGS allowlist',
  );
}

// Coincall `lastTrade` is per-instrument — no bulk underlying channel. Cache the
// active instrument list per base with a TTL so reconnects dedupe but the runtime
// picks up newly-listed daily expiries (and recovers from a transient empty/error
// result) within at most one TTL window.
const COINCALL_INSTRUMENT_TTL_MS = 15 * 60 * 1000;

interface CoincallInstrumentCacheEntry {
  promise: Promise<string[]>;
  expiresAt: number;
}

const coincallInstrumentCache = new Map<string, CoincallInstrumentCacheEntry>();

export function clearCoincallInstrumentCache(): void {
  coincallInstrumentCache.clear();
}

export function fetchCoincallInstrumentsForBase(base: string): Promise<string[]> {
  const now = Date.now();
  const cached = coincallInstrumentCache.get(base);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = (async () => {
    try {
      const res = await fetch(`${COINCALL_REST_BASE_URL}${COINCALL_INSTRUMENTS}/${base}`, {
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as { code?: number; msg?: string; data?: unknown };
      if (body.code !== 0) {
        log.warn(
          { venue: 'coincall', base, code: body.code, msg: body.msg },
          'coincall getInstruments returned non-success code — no trades for this base',
        );
        return [];
      }
      if (!Array.isArray(body.data)) {
        log.warn(
          { venue: 'coincall', base },
          'coincall getInstruments returned non-array data — no trades for this base',
        );
        return [];
      }
      const active: string[] = [];
      let total = 0;
      for (const item of body.data) {
        total++;
        const parsed = CoincallInstrumentEntrySchema.safeParse(item);
        if (parsed.success && parsed.data.isActive) active.push(parsed.data.symbolName);
      }
      if (active.length === 0) {
        log.warn(
          { venue: 'coincall', base, totalListed: total },
          'coincall has no active option instruments for base — live trade tape will receive no trades for this underlying',
        );
      } else {
        log.info(
          { venue: 'coincall', base, active: active.length, totalListed: total },
          'coincall option instruments fetched',
        );
      }
      return active;
    } catch (err) {
      log.warn(
        { venue: 'coincall', base, err: String(err) },
        'coincall getInstruments fetch failed — no trades for this base',
      );
      return [];
    }
  })();

  coincallInstrumentCache.set(base, { promise, expiresAt: now + COINCALL_INSTRUMENT_TTL_MS });
  return promise;
}

export function normalizeTradeUnderlying(underlying: string): string {
  return underlying.toUpperCase().split('_')[0] ?? underlying.toUpperCase();
}

export function getDeribitTradeCurrency(underlying: string): string | null {
  const normalizedUnderlying = normalizeTradeUnderlying(underlying);
  if (DERIBIT_INVERSE_OPTION_CURRENCIES.has(normalizedUnderlying)) return normalizedUnderlying;
  if (DERIBIT_USDC_OPTION_BASES.has(normalizedUnderlying)) return 'USDC';
  return null;
}

export function getDeribitUnderlyingFromInstrument(instrument: string): string | null {
  const instrumentFamily = instrument.split('-')[0];
  if (!instrumentFamily) return null;
  return normalizeTradeUnderlying(instrumentFamily);
}

function isDeribitTradeForUnderlying(instrument: string, underlying: string): boolean {
  return getDeribitUnderlyingFromInstrument(instrument) === normalizeTradeUnderlying(underlying);
}

function deribitTradeToEvent(
  raw: z.infer<typeof DeribitTradeSchema>,
  underlying: string,
): TradeEvent {
  return {
    venue: 'deribit',
    tradeId: raw.trade_id ?? raw.trade_seq,
    instrument: raw.instrument_name,
    underlying,
    side: raw.direction,
    price: raw.price,
    size: raw.amount,
    // Deribit sends IV as percentage (49.80 = 49.80%)
    iv: raw.iv != null ? raw.iv / 100 : null,
    markPrice: raw.mark_price ?? null,
    indexPrice: raw.index_price ?? null,
    isBlock: raw.block_trade_id != null,
    timestamp: raw.timestamp,
  };
}

const deribitSeedCache = new Map<string, Promise<TradeEvent[]>>();

function fetchDeribitTradesByCurrency(currency: string): Promise<TradeEvent[]> {
  const existing = deribitSeedCache.get(currency);
  if (existing) return existing;

  const promise = deribitRpcSeed(currency);
  deribitSeedCache.set(currency, promise);
  return promise;
}

function deribitRpcSeed(currency: string): Promise<TradeEvent[]> {
  return new Promise<TradeEvent[]>((resolve) => {
    const ws = new WebSocket(DERIBIT_WS_URL);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'public/get_last_trades_by_currency',
          params: { currency, kind: 'option', count: 50 },
        }),
      );
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (msg['id'] !== 1) return;

      ws.close();
      const trades = (msg['result'] as Record<string, unknown> | undefined)?.['trades'];
      if (!Array.isArray(trades)) {
        resolve([]);
        return;
      }

      resolve(
        trades.flatMap((t) => {
          const p = DeribitTradeSchema.safeParse(t);
          if (!p.success) return [];
          return [
            deribitTradeToEvent(
              p.data,
              getDeribitUnderlyingFromInstrument(p.data.instrument_name) ?? currency,
            ),
          ];
        }),
      );
    });

    ws.on('error', () => {
      ws.close();
      resolve([]);
    });
    setTimeout(() => {
      ws.close();
      resolve([]);
    }, 10_000);
  });
}

export const VENUE_STREAMS: VenueStream[] = [
  {
    venue: 'deribit',
    url: DERIBIT_WS_URL,
    // Deribit closes idle sockets silently when the app-level heartbeat isn't
    // configured on this connection. `public/test` is a free no-op RPC; we
    // send it every 25s so the server keeps pushing trades and, critically,
    // we see an inbound response that refreshes `lastMessageAt` for the watchdog.
    startKeepalive(ws) {
      return setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'public/test', params: {} }),
          );
        }
      }, 25_000);
    },
    connect(ws, underlying) {
      const tradeCurrency = getDeribitTradeCurrency(underlying);
      if (!tradeCurrency) return;

      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'public/subscribe',
          params: { channels: [`trades.option.${tradeCurrency}.100ms`] },
        }),
      );
    },
    parse(msg, underlying) {
      const m = msg as Record<string, unknown>;
      if (m['method'] !== 'subscription') return [];
      const params = m['params'] as Record<string, unknown> | undefined;
      const data = params?.['data'];
      if (!Array.isArray(data)) return [];

      const trades: TradeEvent[] = [];
      for (const item of data) {
        const parsed = DeribitTradeSchema.safeParse(item);
        if (
          !parsed.success ||
          !isDeribitTradeForUnderlying(parsed.data.instrument_name, underlying)
        )
          continue;
        trades.push(
          deribitTradeToEvent(
            parsed.data,
            getDeribitUnderlyingFromInstrument(parsed.data.instrument_name) ??
              normalizeTradeUnderlying(underlying),
          ),
        );
      }
      return trades;
    },
    async seed(underlying) {
      const tradeCurrency = getDeribitTradeCurrency(underlying);
      if (!tradeCurrency) return [];

      const allTrades = await fetchDeribitTradesByCurrency(tradeCurrency);
      return allTrades.filter((t) => isDeribitTradeForUnderlying(t.instrument, underlying));
    },
  },
  {
    venue: 'okx',
    url: OKX_WS_URL,
    // OKX drops idle connections — must send "ping" text every 25s
    startKeepalive(ws) {
      return setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 25_000);
    },
    connect(ws, underlying) {
      ws.send(
        JSON.stringify({
          op: 'subscribe',
          args: [{ channel: 'option-trades', instType: 'OPTION', instFamily: `${underlying}-USD` }],
        }),
      );
    },
    parse(msg, underlying) {
      const m = msg as Record<string, unknown>;
      if (!m['data'] || !Array.isArray(m['data'])) return [];
      const trades: TradeEvent[] = [];
      for (const item of m['data'] as unknown[]) {
        const parsed = OkxTradeSchema.safeParse(item);
        if (!parsed.success) continue;
        trades.push({
          venue: 'okx',
          tradeId: parsed.data.tradeId,
          instrument: parsed.data.instId,
          underlying,
          side: parsed.data.side,
          price: parsed.data.px,
          size: parsed.data.sz,
          iv: parsed.data.fillVol ?? null,
          markPrice: null,
          indexPrice: null,
          isBlock: false,
          timestamp: parsed.data.ts,
        });
      }
      return trades;
    },
    async seed(underlying) {
      try {
        const res = await fetch(
          `${OKX_REST_BASE_URL}${OKX_INSTRUMENT_FAMILY_TRADES}?instFamily=${underlying}-USD`,
          { signal: AbortSignal.timeout(10_000) },
        );
        const data = (await res.json()) as Record<string, unknown>;
        const items = data['data'] as Array<Record<string, unknown>> | undefined;
        if (!items) return [];
        // OKX REST groups trades by optType with a tradeInfo array
        const OkxRestTradeSchema = z.object({
          instId: z.string(),
          side: sideStr,
          px: numStr,
          sz: numStr,
          tradeId: z
            .union([z.string(), z.number()])
            .optional()
            .transform((value) => (value != null ? String(value) : null)),
          ts: numStr,
        });
        const trades: TradeEvent[] = [];
        for (const group of items) {
          const infos = group['tradeInfo'];
          if (!Array.isArray(infos)) continue;
          for (const raw of infos) {
            const p = OkxRestTradeSchema.safeParse(raw);
            if (!p.success) continue;
            trades.push({
              venue: 'okx',
              tradeId: p.data.tradeId,
              instrument: p.data.instId,
              underlying,
              side: p.data.side,
              price: p.data.px,
              size: p.data.sz,
              iv: null,
              markPrice: null,
              indexPrice: null,
              isBlock: false,
              timestamp: p.data.ts,
            });
          }
        }
        return trades;
      } catch {
        return [];
      }
    },
  },
  {
    venue: 'bybit',
    url: BYBIT_WS_URL,
    // Bybit requires JSON ping every 20s — not WS-level ping frames
    startKeepalive(ws) {
      return setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
      }, 20_000);
    },
    connect(ws, underlying) {
      ws.send(JSON.stringify({ op: 'subscribe', args: [`publicTrade.${underlying}`] }));
    },
    parse(msg) {
      const m = msg as Record<string, unknown>;
      if (!m['data'] || !Array.isArray(m['data'])) return [];
      const trades: TradeEvent[] = [];
      for (const item of m['data'] as unknown[]) {
        const parsed = BybitTradeSchema.safeParse(item);
        if (!parsed.success) continue;
        trades.push({
          venue: 'bybit',
          tradeId: parsed.data.i ?? null,
          instrument: parsed.data.s,
          underlying: parsed.data.s.split('-')[0]!,
          side: parsed.data.S,
          price: parsed.data.p,
          size: parsed.data.v,
          iv: parsed.data.iv ?? null,
          markPrice: parsed.data.mP,
          indexPrice: parsed.data.iP,
          isBlock: parsed.data.BT === true,
          timestamp: parsed.data.T,
        });
      }
      return trades;
    },
    async seed(underlying) {
      try {
        const res = await fetch(
          `${BYBIT_REST_BASE_URL}${BYBIT_RECENT_TRADE}?category=option&baseCoin=${underlying}&limit=50`,
          { signal: AbortSignal.timeout(10_000) },
        );
        const data = (await res.json()) as Record<string, unknown>;
        const result = data['result'] as Record<string, unknown> | undefined;
        const list = result?.['list'] as Array<Record<string, unknown>> | undefined;
        if (!list) return [];
        // Bybit REST trade fields differ from WS — use a simple schema
        const RestTradeSchema = z.object({
          symbol: z.string(),
          side: sideStr,
          execId: z.string().optional(),
          price: numStr,
          size: numStr,
          iv: numStr.optional(),
          mP: optNum,
          iP: optNum,
          isBlockTrade: z.boolean().optional(),
          time: numStr,
        });
        const trades: TradeEvent[] = [];
        for (const item of list) {
          const p = RestTradeSchema.safeParse(item);
          if (!p.success) continue;
          trades.push({
            venue: 'bybit',
            tradeId: p.data.execId ?? null,
            instrument: p.data.symbol,
            underlying,
            side: p.data.side,
            price: p.data.price,
            size: p.data.size,
            iv: p.data.iv ?? null,
            markPrice: p.data.mP,
            indexPrice: p.data.iP,
            isBlock: p.data.isBlockTrade === true,
            timestamp: p.data.time,
          });
        }
        return trades;
      } catch {
        return [];
      }
    },
  },
  {
    venue: 'binance',
    url: BINANCE_OPTIONS_WS_URL,
    // No seed: Binance's only public trade history endpoint (GET /eapi/v1/trades)
    // requires a specific symbol — there is no bulk "all trades for underlying"
    // equivalent without auth. Users see no history until a live trade arrives.
    //
    // Binance server pings every 5 min and disconnects on missed pong after 15 min
    // (per websocket-market-streams.md). Sending our own ping every 3 min keeps
    // NAT/proxy entries alive and forces an inbound pong that refreshes lastMessageAt.
    startKeepalive(ws) {
      return setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, 180_000);
    },
    connect(ws, underlying) {
      ws.send(
        JSON.stringify({
          method: 'SUBSCRIBE',
          params: [`${underlying.toLowerCase()}usdt@optionTrade`],
          id: 1,
        }),
      );
    },
    parse(msg) {
      const m = msg as Record<string, unknown>;
      const data = (m['data'] as Record<string, unknown> | undefined) ?? m;

      const parsed = BinanceTradeSchema.safeParse(data);
      if (!parsed.success) return [];

      return [
        {
          venue: 'binance' as VenueId,
          tradeId: parsed.data.t,
          instrument: parsed.data.s,
          underlying: parsed.data.s.split('-')[0]!,
          side: parsed.data.S,
          price: parsed.data.p,
          size: parsed.data.q,
          iv: null,
          markPrice: null,
          indexPrice: null,
          isBlock: parsed.data.X === 'BLOCK',
          timestamp: parsed.data.T,
        },
      ];
    },
  },
  {
    venue: 'derive',
    url: DERIVE_WS_URL,
    // Derive has no app-level heartbeat per core/CLAUDE.md — rely on WS ping/pong.
    // 20s cadence matches OKX/Bybit and keeps the socket warm against half-open TCP.
    startKeepalive(ws) {
      return setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, 20_000);
    },
    connect(ws, underlying) {
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'subscribe',
          params: { channels: [`trades.option.${underlying}`] },
        }),
      );
    },
    parse(msg, underlying) {
      const m = msg as Record<string, unknown>;
      if (m['method'] !== 'subscription') return [];
      const params = m['params'] as Record<string, unknown> | undefined;
      const data = params?.['data'];
      if (!Array.isArray(data)) return [];

      const trades: TradeEvent[] = [];
      for (const item of data) {
        const parsed = DeriveTradeSchema.safeParse(item);
        if (!parsed.success) continue;
        trades.push({
          venue: 'derive',
          tradeId: parsed.data.trade_id,
          instrument: parsed.data.instrument_name,
          underlying,
          side: parsed.data.direction,
          price: parsed.data.trade_price,
          size: parsed.data.trade_amount,
          iv: null,
          markPrice: parsed.data.mark_price,
          indexPrice: parsed.data.index_price,
          isBlock: parsed.data.rfq_id != null && parsed.data.rfq_id !== '',
          timestamp: parsed.data.timestamp,
        });
      }
      return trades;
    },
    async seed(underlying) {
      const ws = new WebSocket(DERIVE_WS_URL);
      return new Promise<TradeEvent[]>((resolve) => {
        let settled = false;
        const finish = (trades: TradeEvent[]) => {
          if (settled) return;
          settled = true;
          ws.close();
          resolve(trades);
        };

        ws.on('open', () => {
          ws.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'public/get_trade_history',
              params: {
                currency: underlying,
                instrument_type: 'option',
                page: 999999,
                page_size: 100,
              }, // last page = newest trades per Derive docs
            }),
          );
        });

        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (msg['id'] !== 1) return;

          const result = msg['result'] as Record<string, unknown> | undefined;
          const items = result?.['trades'];
          if (!Array.isArray(items)) {
            finish([]);
            return;
          }

          const trades: TradeEvent[] = [];
          for (const item of items) {
            const parsed = DeriveTradeSchema.safeParse(item);
            if (!parsed.success) continue;
            trades.push({
              venue: 'derive',
              tradeId: parsed.data.trade_id,
              instrument: parsed.data.instrument_name,
              underlying,
              side: parsed.data.direction,
              price: parsed.data.trade_price,
              size: parsed.data.trade_amount,
              iv: null,
              markPrice: parsed.data.mark_price,
              indexPrice: parsed.data.index_price,
              isBlock: parsed.data.rfq_id != null && parsed.data.rfq_id !== '',
              timestamp: parsed.data.timestamp,
            });
          }

          finish(trades);
        });

        ws.on('error', () => finish([]));
        setTimeout(() => finish([]), 10_000);
      });
    },
  },
  {
    venue: 'coincall',
    // Coincall is per-symbol with no bulk trade-history endpoint; the live WS
    // only emits prints after subscribe. Reseeding every 10 min keeps a rolling
    // historical slice visible in the tape. tradeId dedup in pushTradeEvents
    // prevents duplicates between the startup seed and each reseed cycle.
    reseedIntervalMs: 10 * 60 * 1000,
    // Coincall's public WS requires HMAC-signed query params — the signature
    // includes a timestamp that goes stale, so re-sign on every reconnect.
    url: () => buildSignedWsUrl(),
    // Coincall closes idle sockets after ~30s; heartbeat every 15s is well within.
    startKeepalive(ws) {
      return setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'heartbeat' }));
      }, 15_000);
    },
    connect(ws, underlying) {
      const base = normalizeTradeUnderlying(underlying);
      // lastTrade is per-symbol on Coincall — fetch the active instrument list
      // and fan out one subscribe per contract. Fire-and-forget; if the WS
      // closes before the fetch resolves, the readyState guard drops the sends.
      void fetchCoincallInstrumentsForBase(base).then((symbols) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        for (const symbol of symbols) {
          ws.send(
            JSON.stringify({
              action: 'subscribe',
              dataType: 'lastTrade',
              payload: { symbol },
            }),
          );
        }
      });
    },
    parse(msg, underlying) {
      const m = msg as Record<string, unknown>;
      if (m['dt'] !== 6 || !Array.isArray(m['d'])) return [];
      const trades: TradeEvent[] = [];
      for (const item of m['d'] as unknown[]) {
        const parsed = CoincallTradeEntrySchema.safeParse(item);
        if (!parsed.success) continue;
        trades.push({
          venue: 'coincall',
          // Coincall's public trades payload omits a stable trade id — synthesize
          // one from symbol+ts so the tradeStore dedupe key remains unique.
          tradeId: `${parsed.data.s}:${parsed.data.ts}`,
          instrument: parsed.data.s,
          underlying: normalizeTradeUnderlying(underlying),
          side: parsed.data.sd === 1 ? 'buy' : 'sell',
          price: parsed.data.pr,
          size: parsed.data.q,
          iv: null,
          markPrice: null,
          indexPrice: null,
          isBlock: false,
          timestamp: parsed.data.ts,
        });
      }
      return trades;
    },
    // Coincall has no bulk trade-history endpoint — the public `lastTrade` WS
    // channel fires only when a fresh trade hits a subscribed symbol, and
    // Coincall's options volume is sparse enough that most underlyings see no
    // pushes within a typical observation window. Seed per-symbol via the
    // `/open/option/trade/lasttrade/v1/{symbol}` REST endpoint so the ring
    // buffer reflects the most recent Coincall trade for every active contract.
    async seed(underlying) {
      if (!isCoincallTradeUnderlyingSupported(underlying)) return [];
      const base = normalizeTradeUnderlying(underlying);
      const symbols = await fetchCoincallInstrumentsForBase(base);
      if (symbols.length === 0) return [];

      const trades: TradeEvent[] = [];
      let cursor = 0;
      const worker = async () => {
        while (cursor < symbols.length) {
          const symbol = symbols[cursor++];
          if (!symbol) continue;
          try {
            const res = await fetch(
              `${COINCALL_REST_BASE_URL}${COINCALL_LAST_TRADE}/${symbol}`,
              { signal: AbortSignal.timeout(5_000) },
            );
            const body = (await res.json()) as { code?: number; data?: unknown };
            if (body.code !== 0 || !Array.isArray(body.data)) continue;
            for (const item of body.data) {
              const parsed = CoincallLastTradeRestSchema.safeParse(item);
              if (!parsed.success) continue;
              trades.push({
                venue: 'coincall',
                tradeId: `${symbol}:${parsed.data.time}`,
                instrument: symbol,
                underlying: base,
                side: parsed.data.tradeSide === 1 ? 'buy' : 'sell',
                price: parsed.data.price,
                size: parsed.data.qty,
                iv: null,
                markPrice: null,
                indexPrice: null,
                isBlock: false,
                timestamp: parsed.data.time,
              });
            }
          } catch {
            // Per-symbol failures are expected (timeouts, sparse data) — skip.
          }
        }
      };

      const concurrency = Math.min(10, symbols.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      return trades;
    },
  },
  {
    venue: 'thalex',
    url: THALEX_MARKET_WS_URL,
    // Thalex server pings natively — the `ws` client auto-pongs, so no app-level
    // heartbeat is required (confirmed by feeds/thalex/ws-client.ts).
    connect(ws, underlying) {
      const base = normalizeTradeUnderlying(underlying);
      // Channel expects the pair (BTCUSD/ETHUSD), not the bare base. The initial
      // notification is a snapshot of recent trades, which also serves as the seed.
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'public/subscribe',
          params: { channels: [`recent_trades.${base}USD.options`] },
        }),
      );
    },
    parse(msg, underlying) {
      const m = msg as Record<string, unknown>;
      const channelName = m['channel_name'];
      if (typeof channelName !== 'string' || !channelName.startsWith('recent_trades.')) return [];
      const notification = m['notification'];
      if (!Array.isArray(notification)) return [];

      const trades: TradeEvent[] = [];
      for (const item of notification) {
        const parsed = ThalexTradeTupleSchema.safeParse(item);
        if (!parsed.success) continue;
        const [price, size, side, tsSeconds, instrument] = parsed.data;
        trades.push({
          venue: 'thalex',
          // Thalex trade tuples have no stable id — synthesize from symbol+ts.
          tradeId: `${instrument}:${tsSeconds}`,
          instrument,
          underlying: normalizeTradeUnderlying(underlying),
          side,
          price,
          size,
          iv: null,
          markPrice: null,
          indexPrice: null,
          isBlock: false,
          // Thalex timestamps are float seconds — convert to the internal ms convention.
          timestamp: Math.round(tsSeconds * 1000),
        });
      }
      return trades;
    },
  },
  {
    venue: 'gateio',
    url: GATEIO_OPTIONS_WS_URL,
    // Gate.io `options.trades` is per-contract and the contract set is fetched
    // once on WS open (see `connect` below). Daily strikes listed after that
    // are never WS-subscribed until reconnect, so their trades drop. Reseed
    // every 10 min via `/options/trades?underlying=…` to backfill any gaps;
    // pushTradeEvents dedupes on tradeId so this doesn't double-count overlap
    // with the live stream.
    reseedIntervalMs: GATEIO_TRADE_RESEED_INTERVAL_MS,
    // Gate.io requires an app-level JSON ping every 15s on this socket
    // (per references/options-docs/gateio/summary.json + feeds/gateio/ws-client.ts).
    // WS-level pings alone are not enough.
    startKeepalive(ws) {
      return setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: 'options.ping' }),
          );
        }
      }, GATEIO_PING_INTERVAL_MS);
    },
    seed: fetchGateioRecentTrades,
    connect(ws, underlying) {
      // `restBase` is what Gate.io expects in the contracts query (`CL_USDT`
      // for the frontend's `XTI`); contract names from the response keep that
      // prefix and the parse step matches them as-is.
      const restBase = toGateioRestBase(normalizeTradeUnderlying(underlying));
      // options.trades is per-contract — fetch the live contract list and
      // chunk-subscribe (50 per frame). REST happens async after `open`; trades
      // start flowing on whichever batch lands first.
      void fetchGateioContractNames(restBase)
        .then((contracts) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const time = Math.floor(Date.now() / 1000);
          for (const batch of chunkArray(contracts, GATEIO_TRADE_BATCH)) {
            ws.send(
              JSON.stringify({
                time,
                channel: 'options.trades',
                event: 'subscribe',
                payload: batch,
              }),
            );
          }
        })
        .catch((err: unknown) => {
          log.warn(
            { venue: 'gateio', underlying: restBase, err: String(err) },
            'gateio trade contract enumeration failed',
          );
        });
    },
    parse(msg, underlying) {
      const envelope = GateioWsEnvelopeSchema.safeParse(msg);
      if (!envelope.success) return [];
      if (envelope.data.channel !== 'options.trades') return [];
      if (envelope.data.event !== 'update' && envelope.data.event !== 'all') return [];
      if (envelope.data.error != null) return [];

      const list = GateioTradeListSchema.safeParse(envelope.data.result);
      if (!list.success) return [];

      return gateioRowsToTradeEvents(list.data, underlying);
    },
  },
];
