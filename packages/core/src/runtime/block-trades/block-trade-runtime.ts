import WebSocket from 'ws';
import { z } from 'zod';
import {
  BINANCE_BLOCK_TRADES,
  BINANCE_REST_BASE_URL,
  BYBIT_RFQ_WS_URL,
  DERIBIT_GET_BLOCK_RFQ_TRADES,
  DERIBIT_REST_BASE_URL,
  DERIBIT_WS_URL,
  DERIVE_GET_TRADE_HISTORY,
  DERIVE_REST_BASE_URL,
  OKX_REST_BASE_URL,
  OKX_RFQ_PUBLIC_TRADES,
} from '../../feeds/shared/endpoints.js';
import { feedLogger } from '../../utils/logger.js';
import { backoffDelay } from '../../utils/reconnect.js';
import type { VenueId } from '../../types/common.js';
import { computeBlockTradeAmounts } from '../../trade-persistence.js';
import { createBlockVenueState, mergeBlockVenueState } from './health.js';
import {
  BLOCK_TRADE_RUNTIME_BUFFER_SIZE,
  insertBlockTrades,
} from './retention.js';
import type {
  BlockTradeEvent,
  BlockTradeLeg,
  BlockTradeRuntimeHealth,
  BlockVenuePoller,
  BlockVenueState,
  BlockVenueStream,
  BlockVenueStreamHandlers,
} from './types.js';

const log = feedLogger('block-trade-runtime');

// ── Runtime configuration ─────────────────────────────────────
const DERIBIT_SEED_COUNT = 250;
// Deribit docs say max 1000 but the API enforces [10, 50].
const DERIBIT_SEED_PAGE_SIZE = 50;
const DERIBIT_SEED_RETRIES = 5;
const DERIVE_INITIAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const DERIVE_POLL_OVERLAP_MS = 60_000;
const DERIVE_PAGE_SIZE = 1_000;
const MAX_DERIVE_PAGES_PER_POLL = 25;

/**
 * Aggregates block/RFQ trades across all venues.
 * Deribit + Bybit via WebSocket (real-time), OKX + Binance + Derive via REST polling.
 */
export class BlockTradeRuntime {
  private buffer: BlockTradeEvent[] = [];
  private seenTradeTimestamps = new Map<string, number>();
  private streams: BlockVenueStream[] = [];
  private pollTimers: ReturnType<typeof setInterval>[] = [];
  private listeners = new Set<(trade: BlockTradeEvent) => void>();
  private venueState = new Map<VenueId, BlockVenueState>();

  async start(): Promise<void> {
    const wsStreams = [deribitBlockStream(), bybitBlockStream()];
    const pollers = [okxBlockPoller(), binanceBlockPoller(), deriveBlockPoller()];

    for (const stream of wsStreams) {
      this.venueState.set(stream.venue, createBlockVenueState('ws', null));
      stream.connect({
        onTrades: (trades) => {
          this.recordPollResult(stream.venue, trades.length, null);
          this.pushTrades(trades);
        },
        onConnected: () => {
          this.updateVenueState(stream.venue, { connected: true, lastStatusAt: Date.now() });
        },
        onDisconnected: () => {
          this.updateVenueState(stream.venue, { connected: false, lastStatusAt: Date.now() });
        },
        onError: () => {
          this.updateVenueState(stream.venue, {
            errors: (this.venueState.get(stream.venue)?.errors ?? 0) + 1,
            lastStatusAt: Date.now(),
          });
        },
        onReconnect: () => {
          this.updateVenueState(stream.venue, {
            reconnects: (this.venueState.get(stream.venue)?.reconnects ?? 0) + 1,
            lastStatusAt: Date.now(),
          });
        },
      });
      this.streams.push(stream);
    }

    for (const poller of pollers) {
      this.venueState.set(poller.venue, createBlockVenueState('poll', poller.limit ?? null));
      void this.runPoller(poller, true);
      const timer = setInterval(() => {
        void this.runPoller(poller, false);
      }, poller.intervalMs);
      this.pollTimers.push(timer);
    }

    log.info('block flow service started');
  }

  getTrades(underlying?: string): BlockTradeEvent[] {
    if (!underlying) return this.buffer;
    const upper = underlying.toUpperCase();
    return this.buffer.filter((t) => t.underlying === upper);
  }

  subscribe(listener: (trade: BlockTradeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getHealth(): BlockTradeRuntimeHealth[] {
    return Array.from(this.venueState.entries()).map(([venue, state]) => ({
      venue,
      transport: state.transport,
      connected: state.connected,
      lastSuccessAt: state.lastSuccessAt,
      lastTradeAt: state.lastTradeAt,
      lastStatusAt: state.lastStatusAt,
      lastPollCount: state.lastPollCount,
      pollLimit: state.pollLimit,
      hitLimitCount: state.hitLimitCount,
      reconnects: state.reconnects,
      errors: state.errors,
      bufferedTrades: this.buffer.filter((trade) => trade.venue === venue).length,
    }));
  }

  private async runPoller(poller: BlockVenuePoller, initial: boolean): Promise<void> {
    try {
      const trades = await poller.poll();
      this.recordPollResult(poller.venue, trades.length, poller.limit ?? null);
      this.pushTrades(trades);
    } catch (err) {
      this.updateVenueState(poller.venue, {
        errors: (this.venueState.get(poller.venue)?.errors ?? 0) + 1,
        lastStatusAt: Date.now(),
      });
      log.warn({ venue: poller.venue, err: String(err) }, initial ? 'initial block trade poll failed' : 'block trade poll failed');
    }
  }

  private updateVenueState(venue: VenueId, patch: Partial<BlockVenueState>): void {
    const current = this.venueState.get(venue);
    if (!current) return;
    this.venueState.set(venue, mergeBlockVenueState(current, patch));
  }

  private recordPollResult(venue: VenueId, tradeCount: number, limit: number | null): void {
    const now = Date.now();
    const state = this.venueState.get(venue);

    this.updateVenueState(venue, {
      connected: true,
      lastSuccessAt: now,
      lastStatusAt: now,
      lastPollCount: tradeCount,
      pollLimit: limit,
      hitLimitCount: limit != null && tradeCount >= limit ? (state?.hitLimitCount ?? 0) + 1 : state?.hitLimitCount ?? 0,
    });

    if (limit != null && tradeCount >= limit) {
      log.warn({ venue, count: tradeCount, limit }, 'block trade poll hit limit');
    }
  }

  private pushTrades(trades: BlockTradeEvent[]): void {
    const { inserted, latestByVenue } = insertBlockTrades(
      this.buffer,
      this.seenTradeTimestamps,
      trades,
      BLOCK_TRADE_RUNTIME_BUFFER_SIZE,
    );

    for (const [venue, timestamp] of latestByVenue) {
      this.updateVenueState(venue, { lastTradeAt: timestamp });
    }

    for (const trade of inserted) {
      for (const listener of this.listeners) {
        try {
          listener(trade);
        } catch (error) {
          log.warn({ err: String(error), venue: trade.venue, tradeId: trade.tradeId }, 'block trade listener failed');
        }
      }
    }
  }

  dispose(): void {
    for (const s of this.streams) s.dispose();
    this.streams = [];
    for (const t of this.pollTimers) clearInterval(t);
    this.pollTimers = [];
  }
}

// ── Helpers ───────────────────────────────────────────────────

function extractUnderlying(instrument: string): string {
  return instrument.split('-')[0]!.replace(/_.*$/, '').toUpperCase();
}

function isOptionInstrument(instrument: string): boolean {
  const parts = instrument.split('-');
  // Bybit appended a currency suffix in 2026: BTC-28MAR26-60000-C-USDT.
  // Find C/P from the end so both old and new formats work.
  let typeIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === 'C' || parts[i] === 'P') { typeIdx = i; break; }
  }
  if (typeIdx < 0) return false;
  const strike = parts[typeIdx - 1];
  const expiry = parts[typeIdx - 2];
  const hasStrike = strike != null && /^[0-9]+(?:\.[0-9]+)?$/.test(strike);
  const hasExpiry = expiry != null && (/^\d{1,2}[A-Z]{3}\d{2}$/.test(expiry) || /^\d{6,8}$/.test(expiry));
  return hasStrike && hasExpiry;
}

function areOptionLegs(instruments: string[]): boolean {
  return instruments.length > 0 && instruments.every((instrument) => isOptionInstrument(instrument));
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json() as Promise<unknown>;
}

// ── Deribit (WS real-time) ────────────────────────────────────

const DeribitBlockRfqSchema = z.object({
  id: z.number(),
  timestamp: z.number(),
  amount: z.number(),
  direction: z.enum(['buy', 'sell']),
  mark_price: z.number().optional(),
  combo_id: z.string().nullable().optional(),
  index_prices: z.record(z.string(), z.number()).optional(),
  legs: z.array(z.object({
    price: z.number(),
    direction: z.enum(['buy', 'sell']),
    instrument_name: z.string(),
    ratio: z.number(),
  })),
});

const DeribitBlockRfqResponseSchema = z.object({
  result: z.object({
    block_rfqs: z.array(DeribitBlockRfqSchema),
    continuation: z.string().nullable().optional(),
  }).optional(),
});

function mapDeribitBlockTrade(trade: z.infer<typeof DeribitBlockRfqSchema>): BlockTradeEvent | null {
  const instruments = trade.legs.map((leg) => leg.instrument_name);
  if (!areOptionLegs(instruments)) return null;

  const underlying = extractUnderlying(trade.legs[0]?.instrument_name ?? 'BTC');
  const indexPriceEntries = Object.entries(trade.index_prices ?? {});
  const indexPrice = indexPriceEntries[0]?.[1] ?? null;

  const blockTrade: BlockTradeEvent = {
    venue: 'deribit',
    tradeId: String(trade.id),
    timestamp: trade.timestamp,
    underlying,
    direction: trade.direction,
    strategy: deriveStrategy(trade.combo_id, trade.legs.length),
    legs: trade.legs.map((leg) => ({
      instrument: leg.instrument_name,
      direction: leg.direction,
      price: indexPrice != null ? leg.price * indexPrice : leg.price,
      size: trade.amount,
      ratio: leg.ratio,
    })),
    totalSize: trade.amount,
    notionalUsd: 0,
    indexPrice,
  };

  blockTrade.notionalUsd = computeBlockTradeAmounts(blockTrade, indexPrice).notionalUsd ?? 0;
  return blockTrade;
}

async function fetchDeribitSeedTrades(): Promise<BlockTradeEvent[]> {
  const trades: BlockTradeEvent[] = [];
  const seen = new Set<string>();
  let continuation: string | undefined;

  while (trades.length < DERIBIT_SEED_COUNT) {
    const params = new URLSearchParams({ currency: 'any', count: String(DERIBIT_SEED_PAGE_SIZE) });
    if (continuation) params.set('continuation', continuation);

    const json = await fetchJson(`${DERIBIT_REST_BASE_URL}${DERIBIT_GET_BLOCK_RFQ_TRADES}?${params}`);
    const parsed = DeribitBlockRfqResponseSchema.safeParse(json);
    if (!parsed.success) break;

    const page = parsed.data.result?.block_rfqs ?? [];
    if (page.length === 0) break;

    for (const item of page) {
      const tradeId = String(item.id);
      if (seen.has(tradeId)) continue;
      seen.add(tradeId);
      const trade = mapDeribitBlockTrade(item);
      if (!trade) continue;
      trades.push(trade);
      if (trades.length >= DERIBIT_SEED_COUNT) break;
    }

    continuation = parsed.data.result?.continuation ?? undefined;
    if (!continuation) break;
  }

  return trades;
}

function deribitBlockStream(): BlockVenueStream {
  let ws: WebSocket | null = null;
  let shouldReconnect = true;
  let handlers: BlockVenueStreamHandlers | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect(attempt = 0): void {
    if (!shouldReconnect) return;
    ws = new WebSocket(DERIBIT_WS_URL);
    let didOpen = false;

    ws.on('open', () => {
      didOpen = true;
      handlers?.onConnected();
      log.info({ venue: 'deribit' }, 'block trade WS connected');
      ws!.send(JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'public/subscribe',
        params: { channels: ['block_rfq.trades.any'] },
      }));
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg['method'] !== 'subscription') return;
        const params = msg['params'] as Record<string, unknown> | undefined;
        const data = params?.['data'];
        if (!data || typeof data !== 'object') return;
        // Deribit pushes single block_rfq objects, not arrays
        const items = Array.isArray(data) ? data : [data];
        const trades: BlockTradeEvent[] = [];
        for (const item of items) {
          const parsed = DeribitBlockRfqSchema.safeParse(item);
          if (!parsed.success) continue;
          const trade = mapDeribitBlockTrade(parsed.data);
          if (!trade) continue;
          trades.push(trade);
        }
        if (trades.length > 0) handlers?.onTrades(trades);
      } catch (err) {
        log.debug({ err: String(err) }, 'malformed WS frame');
      }
    });

    ws.on('close', () => {
      handlers?.onDisconnected();
      if (shouldReconnect) {
        handlers?.onReconnect();
        const delay = backoffDelay(didOpen ? 0 : attempt + 1);
        reconnectTimer = setTimeout(() => connect(didOpen ? 0 : attempt + 1), delay);
      }
    });

    ws.on('error', (err) => {
      handlers?.onError();
      log.warn({ venue: 'deribit', err: err.message }, 'block trade WS error');
    });
  }

  async function seed(): Promise<BlockTradeEvent[]> {
    for (let attempt = 0; attempt < DERIBIT_SEED_RETRIES; attempt++) {
      try {
        return await fetchDeribitSeedTrades();
      } catch (err) {
        log.warn({ venue: 'deribit', err: String(err), attempt: attempt + 1, retries: DERIBIT_SEED_RETRIES }, 'block trade seed failed');
        if (attempt < DERIBIT_SEED_RETRIES - 1) {
          await new Promise(r => setTimeout(r, backoffDelay(attempt)));
        }
      }
    }
    return [];
  }

  return {
    venue: 'deribit',
    connect(streamHandlers) {
      handlers = streamHandlers;
      connect();
      void seed().then((trades) => {
        if (trades.length > 0) {
          streamHandlers.onTrades(trades);
        }
      });
    },
    dispose() {
      shouldReconnect = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}

// Deribit combo_id encodes strategy: BTC-STRD-27MAR26-70000, BTC-CS-..., etc.
function deriveStrategy(comboId: string | null | undefined, legCount: number): string | null {
  if (!comboId) return legCount > 1 ? 'CUSTOM' : null;
  const parts = comboId.split('-');
  const code = parts[1]?.toUpperCase();
  const STRATEGY_MAP: Record<string, string> = {
    STRD: 'STRADDLE', STRG: 'STRANGLE',
    CS: 'CALL_SPREAD', PS: 'PUT_SPREAD',
    CF: 'CALL_BUTTERFLY', PF: 'PUT_BUTTERFLY',
    IC: 'IRON_CONDOR', IB: 'IRON_BUTTERFLY',
    CR: 'CALL_RATIO', PR: 'PUT_RATIO',
    CCS: 'CALL_CALENDAR_SPREAD', PCS: 'PUT_CALENDAR_SPREAD',
    CD: 'CALL_DIAGONAL', PD: 'PUT_DIAGONAL',
    FSR: 'FUTURE_SPREAD', COMBO: 'COMBO',
  };
  return STRATEGY_MAP[code ?? ''] ?? (legCount > 1 ? 'CUSTOM' : null);
}

// ── Bybit (WS real-time) ─────────────────────────────────────

const BybitBlockTradeSchema = z.object({
  rfqId: z.string(),
  strategyType: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  legs: z.array(z.object({
    category: z.string().optional(),
    symbol: z.string(),
    side: z.string(),
    price: z.string(),
    qty: z.string(),
    markPrice: z.string().optional(),
  })).min(1),
});

function mapBybitBlockTrade(trade: z.infer<typeof BybitBlockTradeSchema>): BlockTradeEvent | null {
  const optionLegs = trade.legs.filter((leg) => leg.category?.toLowerCase() === 'option' && isOptionInstrument(leg.symbol));
  const firstLeg = optionLegs[0];
  if (!firstLeg || optionLegs.length !== trade.legs.length) return null;

  const underlying = extractUnderlying(firstLeg.symbol);
  const totalSize = optionLegs.reduce((sum, leg) => sum + Number(leg.qty), 0);

  return {
    venue: 'bybit',
    tradeId: trade.rfqId,
    timestamp: Number(trade.updatedAt ?? trade.createdAt),
    underlying,
    direction: firstLeg.side.toLowerCase() as 'buy' | 'sell',
    strategy: trade.strategyType?.trim() ? trade.strategyType.toUpperCase() : (optionLegs.length > 1 ? 'CUSTOM' : null),
    legs: optionLegs.map((leg) => ({
      instrument: leg.symbol,
      direction: leg.side.toLowerCase() as 'buy' | 'sell',
      price: Number(leg.price),
      size: Number(leg.qty),
      ratio: 1,
    })),
    totalSize,
    // markPrice per leg is the option's mark price at execution time (USDT ≈ USD).
    // Fall back to execution price if markPrice is absent.
    notionalUsd: optionLegs.reduce((sum, leg) => sum + Number(leg.markPrice ?? leg.price) * Number(leg.qty), 0),
    indexPrice: null,
  };
}

function bybitBlockStream(): BlockVenueStream {
  let ws: WebSocket | null = null;
  let shouldReconnect = true;
  let handlers: BlockVenueStreamHandlers | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  function connect(attempt = 0): void {
    if (!shouldReconnect) return;
    ws = new WebSocket(BYBIT_RFQ_WS_URL);
    let didOpen = false;

    ws.on('open', () => {
      didOpen = true;
      handlers?.onConnected();
      log.info({ venue: 'bybit' }, 'block trade WS connected');
      ws!.send(JSON.stringify({ op: 'subscribe', args: ['rfq.open.public.trades'] }));
      keepaliveTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
      }, 20_000);
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        const data = msg['data'];
        if (!data || !Array.isArray(data)) return;

        const trades: BlockTradeEvent[] = [];
        for (const item of data) {
          const parsed = BybitBlockTradeSchema.safeParse(item);
          if (!parsed.success) continue;
          const trade = mapBybitBlockTrade(parsed.data);
          if (!trade) continue;
          trades.push(trade);
        }
        if (trades.length > 0) handlers?.onTrades(trades);
      } catch (err) {
        log.debug({ err: String(err) }, 'malformed WS frame');
      }
    });

    ws.on('close', () => {
      handlers?.onDisconnected();
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
      if (shouldReconnect) {
        handlers?.onReconnect();
        const delay = backoffDelay(didOpen ? 0 : attempt + 1);
        reconnectTimer = setTimeout(() => connect(didOpen ? 0 : attempt + 1), delay);
      }
    });

    ws.on('error', (err) => {
      handlers?.onError();
      log.warn({ venue: 'bybit', err: err.message }, 'block trade WS error');
    });
  }

  return {
    venue: 'bybit',
    connect(streamHandlers) {
      handlers = streamHandlers;
      connect();
    },
    dispose() {
      shouldReconnect = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      ws?.close();
    },
  };
}

// ── OKX (REST poll every 90s) ─────────────────────────────────

const OkxBlockTradeSchema = z.object({
  blockTdId: z.string(),
  cTime: z.string(),
  strategy: z.string().optional(),
  legs: z.array(z.object({
    instId: z.string(),
    side: z.string(),
    sz: z.string(),
    px: z.string(),
  })),
});

function okxBlockPoller(): BlockVenuePoller {
  return {
    venue: 'okx',
    intervalMs: 90_000,
    limit: 100,
    async poll() {
      try {
        const res = await fetch(`${OKX_REST_BASE_URL}${OKX_RFQ_PUBLIC_TRADES}?limit=100`, {
          signal: AbortSignal.timeout(10_000),
        });
        const json = await res.json() as Record<string, unknown>;
        const items = json['data'];
        if (!Array.isArray(items)) return [];

        const trades: BlockTradeEvent[] = [];
        for (const item of items) {
          const parsed = OkxBlockTradeSchema.safeParse(item);
          if (!parsed.success) continue;
          const d = parsed.data;

          // Skip non-option trades (spot, futures, swaps)
          const hasOptionLeg = d.legs.some((l) => /-[CP]$/.test(l.instId));
          if (!hasOptionLeg) continue;

          const underlying = extractUnderlying(d.legs[0]?.instId ?? 'BTC');
          const totalSize = d.legs.reduce((sum, l) => sum + Number(l.sz), 0);

          trades.push({
            venue: 'okx',
            tradeId: d.blockTdId,
            timestamp: Number(d.cTime),
            underlying,
            direction: d.legs[0]?.side.toLowerCase() as 'buy' | 'sell' ?? 'buy',
            strategy: d.strategy && d.strategy !== '' ? d.strategy : (d.legs.length > 1 ? 'CUSTOM' : null),
            legs: d.legs.map((l) => ({
              instrument: l.instId,
              direction: l.side.toLowerCase() as 'buy' | 'sell',
              price: Number(l.px),
              size: Number(l.sz),
              ratio: 1,
            })),
            totalSize,
            notionalUsd: 0,
            indexPrice: null,
          });
        }
        if (trades.length > 0) log.info({ venue: 'okx', count: trades.length }, 'polled block trades');
        return trades;
      } catch (err) {
        log.warn({ venue: 'okx', err: String(err) }, 'block trade poll failed');
        return [];
      }
    },
  };
}

// ── Binance (REST poll every 120s) ────────────────────────────

const BinanceBlockTradeSchema = z.object({
  id: z.number(),
  symbol: z.string(),
  price: z.string(),
  qty: z.string(),
  side: z.number(),
  time: z.number(),
});

function binanceBlockPoller(): BlockVenuePoller {
  return {
    venue: 'binance',
    intervalMs: 120_000,
    limit: 100,
    async poll() {
      try {
        const res = await fetch(`${BINANCE_REST_BASE_URL}${BINANCE_BLOCK_TRADES}?limit=100`, {
          signal: AbortSignal.timeout(10_000),
        });
        const items = await res.json() as unknown[];
        if (!Array.isArray(items)) return [];

        const trades: BlockTradeEvent[] = [];
        for (const item of items) {
          const parsed = BinanceBlockTradeSchema.safeParse(item);
          if (!parsed.success) continue;
          const d = parsed.data;
          const underlying = extractUnderlying(d.symbol);
          const price = Number(d.price);
          const size = Math.abs(Number(d.qty));

          trades.push({
            venue: 'binance',
            tradeId: String(d.id),
            timestamp: d.time,
            underlying,
            direction: d.side === 1 ? 'buy' : 'sell',
            strategy: null,
            legs: [{
              instrument: d.symbol,
              direction: d.side === 1 ? 'buy' : 'sell',
              price,
              size,
              ratio: 1,
            }],
            totalSize: size,
            notionalUsd: price * size,
            indexPrice: null,
          });
        }
        if (trades.length > 0) log.info({ venue: 'binance', count: trades.length }, 'polled block trades');
        return trades;
      } catch (err) {
        log.warn({ venue: 'binance', err: String(err) }, 'block trade poll failed');
        return [];
      }
    },
  };
}

// ── Derive (REST poll every 90s, filter rfq_id != null) ───────

const DeriveTradeSchema = z.object({
  trade_id: z.string(),
  instrument_name: z.string(),
  direction: z.enum(['buy', 'sell']),
  trade_price: z.string(),
  trade_amount: z.string(),
  index_price: z.string().optional(),
  rfq_id: z.string().nullable().optional(),
  timestamp: z.number(),
});

const DeriveTradeHistoryResponseSchema = z.object({
  result: z.object({
    trades: z.array(DeriveTradeSchema),
    pagination: z.object({
      count: z.number(),
      num_pages: z.number(),
    }).optional(),
  }).optional(),
});

function mapDeriveBlockTrade(trade: z.infer<typeof DeriveTradeSchema>): BlockTradeEvent {
  const price = Number(trade.trade_price);
  const size = Number(trade.trade_amount);
  const indexPrice = trade.index_price ? Number(trade.index_price) : null;

  return {
    venue: 'derive',
    tradeId: trade.trade_id,
    timestamp: trade.timestamp,
    underlying: extractUnderlying(trade.instrument_name),
    direction: trade.direction,
    strategy: null,
    legs: [{
      instrument: trade.instrument_name,
      direction: trade.direction,
      price,
      size,
      ratio: 1,
    }],
    totalSize: size,
    notionalUsd: price * size,
    indexPrice,
  };
}

async function fetchDeriveTradeHistory(fromTimestamp: number, toTimestamp: number): Promise<BlockTradeEvent[]> {
  const trades: BlockTradeEvent[] = [];
  const seen = new Set<string>();
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_DERIVE_PAGES_PER_POLL) {
    const params = new URLSearchParams({
      instrument_type: 'option',
      page: String(page),
      page_size: String(DERIVE_PAGE_SIZE),
      from_timestamp: String(fromTimestamp),
      to_timestamp: String(toTimestamp),
    });

    const json = await fetchJson(`${DERIVE_REST_BASE_URL}${DERIVE_GET_TRADE_HISTORY}?${params}`);
    const parsed = DeriveTradeHistoryResponseSchema.safeParse(json);
    if (!parsed.success) break;

    const result = parsed.data.result;
    const pageTrades = result?.trades ?? [];
    totalPages = result?.pagination?.num_pages ?? page;
    if (pageTrades.length === 0) break;

    for (const item of pageTrades) {
      if (!item.rfq_id) continue;
      if (seen.has(item.trade_id)) continue;
      seen.add(item.trade_id);
      trades.push(mapDeriveBlockTrade(item));
    }

    page += 1;
  }

  return trades;
}

function deriveBlockPoller(): BlockVenuePoller {
  let nextFromTimestamp: number | null = null;

  return {
    venue: 'derive',
    intervalMs: 90_000,
    async poll() {
      try {
        const now = Date.now();
        const fromTimestamp = nextFromTimestamp ?? (now - DERIVE_INITIAL_LOOKBACK_MS);
        const trades = await fetchDeriveTradeHistory(fromTimestamp, now);
        const newestTimestamp = trades.reduce<number | null>((latest, trade) => {
          if (latest == null || trade.timestamp > latest) return trade.timestamp;
          return latest;
        }, null);

        if (newestTimestamp != null) {
          nextFromTimestamp = Math.max(newestTimestamp - DERIVE_POLL_OVERLAP_MS, 0);
        } else {
          nextFromTimestamp = Math.max(now - DERIVE_POLL_OVERLAP_MS, fromTimestamp);
        }

        if (trades.length > 0) {
          log.info({ venue: 'derive', count: trades.length, fromTimestamp, toTimestamp: now }, 'polled block trades');
        }
        return trades;
      } catch (err) {
        log.warn({ venue: 'derive', err: String(err) }, 'block trade poll failed');
        return [];
      }
    },
  };
}
