import WebSocket from 'ws';
import { z } from 'zod';
import { feedLogger } from '../utils/logger.js';
import { backoffDelay } from '../utils/reconnect.js';
import type { VenueId } from '../types/common.js';

const log = feedLogger('block-flow');

// ── Canonical types ───────────────────────────────────────────

export interface BlockTradeLeg {
  instrument: string;
  direction: 'buy' | 'sell';
  price: number;
  size: number;
  ratio: number;
}

export interface BlockTradeEvent {
  venue: VenueId;
  tradeId: string;
  timestamp: number;
  underlying: string;
  direction: 'buy' | 'sell';
  strategy: string | null;
  legs: BlockTradeLeg[];
  totalSize: number;
  notionalUsd: number;
  indexPrice: number | null;
}

// ── Venue stream interface ────────────────────────────────────

interface BlockVenueStream {
  venue: VenueId;
  connect: (onTrades: (trades: BlockTradeEvent[]) => void) => void;
  dispose: () => void;
}

interface BlockVenuePoller {
  venue: VenueId;
  intervalMs: number;
  poll: () => Promise<BlockTradeEvent[]>;
}

const BUFFER_SIZE = 300;

/**
 * Aggregates block/RFQ trades across all venues.
 * Deribit + Bybit via WebSocket (real-time), OKX + Binance + Derive via REST polling.
 */
export class BlockFlowService {
  private buffer: BlockTradeEvent[] = [];
  private seenIds = new Set<string>();
  private streams: BlockVenueStream[] = [];
  private pollTimers: ReturnType<typeof setInterval>[] = [];

  async start(): Promise<void> {
    const wsStreams = [deribitBlockStream(), bybitBlockStream()];
    const pollers  = [okxBlockPoller(), binanceBlockPoller(), deriveBlockPoller()];

    for (const stream of wsStreams) {
      stream.connect((trades) => this.pushTrades(trades));
      this.streams.push(stream);
    }

    for (const poller of pollers) {
      void poller.poll().then((trades) => this.pushTrades(trades)).catch((err) => {
        log.warn({ venue: poller.venue, err: String(err) }, 'initial block trade poll failed');
      });
      const timer = setInterval(() => {
        void poller.poll().then((trades) => this.pushTrades(trades)).catch((err) => {
          log.warn({ venue: poller.venue, err: String(err) }, 'block trade poll failed');
        });
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

  private pushTrades(trades: BlockTradeEvent[]): void {
    for (const t of trades) {
      const key = `${t.venue}:${t.tradeId}`;
      if (this.seenIds.has(key)) continue;
      this.seenIds.add(key);
      this.buffer.push(t);
    }

    this.buffer.sort((a, b) => b.timestamp - a.timestamp);

    if (this.buffer.length > BUFFER_SIZE) {
      const removed = this.buffer.splice(BUFFER_SIZE);
      for (const t of removed) this.seenIds.delete(`${t.venue}:${t.tradeId}`);
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

function deribitBlockStream(): BlockVenueStream {
  let ws: WebSocket | null = null;
  let shouldReconnect = true;
  let onTradesFn: ((trades: BlockTradeEvent[]) => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect(attempt = 0): void {
    if (!shouldReconnect) return;
    ws = new WebSocket('wss://www.deribit.com/ws/api/v2');
    let didOpen = false;

    ws.on('open', () => {
      didOpen = true;
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
          const d = parsed.data;
          const underlying = extractUnderlying(d.legs[0]?.instrument_name ?? 'BTC');
          const idxKeys = Object.keys(d.index_prices ?? {});
          const indexPrice = idxKeys.length > 0 && d.index_prices ? (d.index_prices[idxKeys[0]!] ?? null) : null;
          const strategy = deriveStrategy(d.combo_id, d.legs.length);

          trades.push({
            venue: 'deribit',
            tradeId: String(d.id),
            timestamp: d.timestamp,
            underlying,
            direction: d.direction,
            strategy,
            legs: d.legs.map((l) => ({
              instrument: l.instrument_name,
              direction: l.direction,
              price: indexPrice != null ? l.price * indexPrice : l.price,
              size: d.amount,
              ratio: l.ratio,
            })),
            totalSize: d.amount,
            notionalUsd: indexPrice != null ? d.legs.reduce((sum, l) => sum + l.price * d.amount * l.ratio * indexPrice, 0) : 0,
            indexPrice,
          });
        }
        if (trades.length > 0) onTradesFn?.(trades);
      } catch (err) { log.debug({ err: String(err) }, 'malformed WS frame'); }
    });

    ws.on('close', () => {
      if (shouldReconnect) {
        const delay = backoffDelay(didOpen ? 0 : attempt + 1);
        reconnectTimer = setTimeout(() => connect(didOpen ? 0 : attempt + 1), delay);
      }
    });

    ws.on('error', (err) => {
      log.warn({ venue: 'deribit', err: err.message }, 'block trade WS error');
    });
  }

  async function seed(): Promise<BlockTradeEvent[]> {
    try {
      const res = await fetch(
        'https://www.deribit.com/api/v2/public/get_block_rfq_trades?currency=BTC&count=50',
        { signal: AbortSignal.timeout(10_000) },
      );
      const json = await res.json() as Record<string, unknown>;
      const result = json['result'] as Record<string, unknown> | undefined;
      const rfqs = result?.['block_rfqs'];
      if (!Array.isArray(rfqs)) return [];

      const trades: BlockTradeEvent[] = [];
      for (const item of rfqs) {
        const parsed = DeribitBlockRfqSchema.safeParse(item);
        if (!parsed.success) continue;
        const d = parsed.data;
        const underlying = extractUnderlying(d.legs[0]?.instrument_name ?? 'BTC');
        const idxKeys = Object.keys(d.index_prices ?? {});
        const indexPrice = idxKeys.length > 0 && d.index_prices ? (d.index_prices[idxKeys[0]!] ?? null) : null;
        const strategy = deriveStrategy(d.combo_id, d.legs.length);

        trades.push({
          venue: 'deribit',
          tradeId: String(d.id),
          timestamp: d.timestamp,
          underlying,
          direction: d.direction,
          strategy,
          legs: d.legs.map((l) => ({
            instrument: l.instrument_name,
            direction: l.direction,
            price: indexPrice != null ? l.price * indexPrice : l.price,
            size: d.amount,
            ratio: l.ratio,
          })),
          totalSize: d.amount,
          notionalUsd: indexPrice != null ? d.legs.reduce((sum, l) => sum + l.price * d.amount * l.ratio * indexPrice, 0) : 0,
          indexPrice,
        });
      }
      return trades;
    } catch (err) {
      log.warn({ venue: 'deribit', err: String(err) }, 'block trade seed failed');
      return [];
    }
  }

  return {
    venue: 'deribit',
    connect(onTrades) {
      onTradesFn = onTrades;
      connect();
      void seed().then((t) => { if (t.length > 0) onTrades(t); });
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

function bybitBlockStream(): BlockVenueStream {
  let ws: WebSocket | null = null;
  let shouldReconnect = true;
  let onTradesFn: ((trades: BlockTradeEvent[]) => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  function connect(attempt = 0): void {
    if (!shouldReconnect) return;
    ws = new WebSocket('wss://stream.bybit.com/v5/public/option');
    let didOpen = false;

    ws.on('open', () => {
      didOpen = true;
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
          const d = item as Record<string, unknown>;
          const legs = d['legs'] as Array<Record<string, unknown>> | undefined;
          if (!legs?.length) continue;

          const underlying = extractUnderlying(String(legs[0]?.['symbol'] ?? 'BTC'));
          trades.push({
            venue: 'bybit',
            tradeId: String(d['tradeId'] ?? d['blockTradeId'] ?? `${Date.now()}`),
            timestamp: Number(d['timestamp'] ?? d['createdAt'] ?? Date.now()),
            underlying,
            direction: String(d['side'] ?? 'buy').toLowerCase() as 'buy' | 'sell',
            strategy: legs.length > 1 ? 'CUSTOM' : null,
            legs: legs.map((l) => ({
              instrument: String(l['symbol'] ?? ''),
              direction: String(l['side'] ?? 'buy').toLowerCase() as 'buy' | 'sell',
              price: Number(l['price'] ?? 0),
              size: Number(l['size'] ?? l['qty'] ?? 0),
              ratio: 1,
            })),
            totalSize: Number(d['qty'] ?? legs[0]?.['size'] ?? 0),
            notionalUsd: 0,
            indexPrice: null,
          });
        }
        if (trades.length > 0) onTradesFn?.(trades);
      } catch (err) { log.debug({ err: String(err) }, 'malformed WS frame'); }
    });

    ws.on('close', () => {
      if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
      if (shouldReconnect) {
        const delay = backoffDelay(didOpen ? 0 : attempt + 1);
        reconnectTimer = setTimeout(() => connect(didOpen ? 0 : attempt + 1), delay);
      }
    });

    ws.on('error', (err) => {
      log.warn({ venue: 'bybit', err: err.message }, 'block trade WS error');
    });
  }

  return {
    venue: 'bybit',
    connect(onTrades) {
      onTradesFn = onTrades;
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
    async poll() {
      try {
        const res = await fetch('https://www.okx.com/api/v5/rfq/public-trades?limit=100', {
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
    async poll() {
      try {
        const res = await fetch('https://eapi.binance.com/eapi/v1/blockTrades?limit=100', {
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

function deriveBlockPoller(): BlockVenuePoller {
  return {
    venue: 'derive',
    intervalMs: 90_000,
    async poll() {
      try {
        const now = Date.now();
        const from = now - 7 * 24 * 60 * 60 * 1000; // 7 days back
        const res = await fetch(
          `https://api.lyra.finance/public/get_trade_history?currency=BTC&instrument_type=option&page_size=200&page=1&from_timestamp=${from}&to_timestamp=${now}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        const json = await res.json() as Record<string, unknown>;
        const result = json['result'] as Record<string, unknown> | undefined;
        const items = result?.['trades'];
        if (!Array.isArray(items)) return [];

        const trades: BlockTradeEvent[] = [];
        // Derive returns both sides of each trade — deduplicate by trade_id, keep taker side
        const seen = new Set<string>();
        for (const item of items) {
          const parsed = DeriveTradeSchema.safeParse(item);
          if (!parsed.success) continue;
          const d = parsed.data;
          if (!d.rfq_id) continue;
          if (seen.has(d.trade_id)) continue;
          seen.add(d.trade_id);

          const underlying = extractUnderlying(d.instrument_name);
          const price = Number(d.trade_price);
          const size = Number(d.trade_amount);
          const indexPrice = d.index_price ? Number(d.index_price) : null;

          trades.push({
            venue: 'derive',
            tradeId: d.trade_id,
            timestamp: d.timestamp,
            underlying,
            direction: d.direction,
            strategy: null,
            legs: [{
              instrument: d.instrument_name,
              direction: d.direction,
              price,
              size,
              ratio: 1,
            }],
            totalSize: size,
            notionalUsd: price * size,
            indexPrice,
          });
        }
        if (trades.length > 0) log.info({ venue: 'derive', count: trades.length }, 'polled block trades');
        return trades;
      } catch (err) {
        log.warn({ venue: 'derive', err: String(err) }, 'block trade poll failed');
        return [];
      }
    },
  };
}
