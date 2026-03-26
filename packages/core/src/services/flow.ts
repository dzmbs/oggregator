import WebSocket from 'ws';
import { z } from 'zod';
import {
  BINANCE_OPTIONS_WS_URL,
  BYBIT_REST_BASE_URL,
  BYBIT_WS_URL,
  DERIBIT_REST_BASE_URL,
  DERIBIT_WS_URL,
  DERIVE_WS_URL,
  OKX_REST_BASE_URL,
  OKX_WS_URL,
} from '../feeds/shared/endpoints.js';
import { feedLogger } from '../utils/logger.js';
import { backoffDelay } from '../utils/reconnect.js';
import type { VenueId } from '../types/common.js';

const log = feedLogger('flow');

export interface TradeEvent {
  venue: VenueId;
  tradeId: string | null;
  instrument: string;
  underlying: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  iv: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  isBlock: boolean;
  timestamp: number;
}

interface VenueStream {
  venue: VenueId;
  url: string;
  connect: (ws: WebSocket, underlying: string) => void;
  parse: (msg: unknown, underlying: string) => TradeEvent[];
  seed?: (underlying: string) => Promise<TradeEvent[]>;
  /** Interval keepalive — some venues drop idle connections without application-level pings */
  startKeepalive?: (ws: WebSocket) => ReturnType<typeof setInterval>;
}

const BUFFER_SIZE = 500;

/**
 * Subscribes to bulk option trade streams across all 5 venues.
 * Maintains a ring buffer of the last N trades per underlying.
 */
export class FlowService {
  private buffers = new Map<string, TradeEvent[]>();
  private connections = new Map<string, WebSocket>();
  private keepaliveTimers = new Map<string, ReturnType<typeof setInterval>>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<(trade: TradeEvent) => void>();
  private shouldReconnect = true;

  async start(underlyings: string[] = ['BTC', 'ETH']): Promise<void> {
    // Open live WS connections and return immediately — callers can flip the
    // readiness flag and start serving /flow without waiting for REST seeds.
    for (const underlying of underlyings) {
      this.buffers.set(underlying, []);
      for (const stream of VENUE_STREAMS) {
        this.connectStream(stream, underlying);
      }
    }

    // Seed historical trades in the background. Fire-and-forget: a slow or
    // failing REST endpoint must never delay live-stream availability.
    void Promise.allSettled(underlyings.map(u => this.seedFromRest(u)));
  }

  private async seedFromRest(underlying: string): Promise<void> {
    const seedStreams = VENUE_STREAMS.filter((stream) => stream.seed != null);
    const results = await Promise.allSettled(
      seedStreams.map((stream) => stream.seed!(underlying)),
    );

    let total = 0;
    for (const [index, result] of results.entries()) {
      const stream = seedStreams[index];
      if (!stream) continue;

      if (result.status === 'rejected') {
        log.warn({ venue: stream.venue, underlying, err: String(result.reason) }, 'trade seed failed');
        continue;
      }

      const count = result.value.length;
      log.info({ venue: stream.venue, underlying, count }, 'trade seed completed');

      if (count === 0) continue;
      this.pushTrades(underlying, result.value);
      total += count;
    }

    if (total > 0) log.info({ underlying, count: total }, 'seeded trades total');
  }

  getTrades(underlying: string, minNotional = 0): TradeEvent[] {
    const buffer = this.buffers.get(underlying) ?? [];
    if (minNotional <= 0) return buffer;
    return buffer.filter(t => t.price * t.size >= minNotional);
  }

  subscribe(listener: (trade: TradeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private connectStream(stream: VenueStream, underlying: string, attempt = 0): void {
    if (!this.shouldReconnect) return;

    const key = `${stream.venue}:${underlying}`;
    const ws = new WebSocket(stream.url);

    // Track whether this connection ever opened so we can reset backoff after a
    // healthy session. Without this, a few early failures permanently inflate the
    // delay even after hours of stable operation.
    let didOpen = false;

    ws.on('open', () => {
      didOpen = true;
      log.info({ venue: stream.venue, underlying }, 'trade stream connected');
      stream.connect(ws, underlying);

      if (stream.startKeepalive) {
        const timer = stream.startKeepalive(ws);
        this.keepaliveTimers.set(key, timer);
      }
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        const trades = stream.parse(msg, underlying);
        if (trades.length > 0) this.pushTrades(underlying, trades);
      } catch { /* malformed frame */ }
    });

    ws.on('close', () => {
      this.connections.delete(key);
      const ka = this.keepaliveTimers.get(key);
      if (ka) { clearInterval(ka); this.keepaliveTimers.delete(key); }

      if (this.shouldReconnect) {
        const nextAttempt = didOpen ? 0 : attempt + 1;
        const delay = backoffDelay(nextAttempt);
        const timer = setTimeout(() => {
          this.reconnectTimers.delete(key);
          this.connectStream(stream, underlying, nextAttempt);
        }, delay);
        this.reconnectTimers.set(key, timer);
      }
    });

    ws.on('error', (err) => {
      log.warn({ venue: stream.venue, underlying, err: err.message }, 'trade stream error');
    });

    this.connections.set(key, ws);
  }

  private pushTrades(underlying: string, trades: TradeEvent[]): void {
    const buffer = this.buffers.get(underlying);
    if (!buffer) return;
    buffer.push(...trades);
    if (buffer.length > BUFFER_SIZE) {
      buffer.splice(0, buffer.length - BUFFER_SIZE);
    }
    for (const trade of trades) {
      for (const listener of this.listeners) {
        listener(trade);
      }
    }
  }

  dispose(): void {
    this.shouldReconnect = false;
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    for (const timer of this.keepaliveTimers.values()) clearInterval(timer);
    this.keepaliveTimers.clear();
    for (const ws of this.connections.values()) ws.close();
    this.connections.clear();
  }
}

// ── Per-venue stream definitions ──────────────────────────────

// ── Per-venue trade schemas ────────────────────────────────────

const numStr = z.union([z.string(), z.number()]).transform(Number).refine(Number.isFinite);
const optNum = z.union([z.string(), z.number(), z.null()]).optional().transform((v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
});
const sideStr = z.string().transform((s) => s.toLowerCase()).pipe(z.enum(['buy', 'sell']));

const DeribitTradeSchema = z.object({
  instrument_name: z.string(),
  direction: z.enum(['buy', 'sell']),
  price: z.number(),
  amount: z.number(),
  iv: z.number().optional(),
  mark_price: z.number().optional(),
  index_price: z.number().optional(),
  block_trade_id: z.string().optional(),
  trade_id: z.union([z.string(), z.number()]).optional().transform((value) => value != null ? String(value) : null),
  trade_seq: z.union([z.string(), z.number()]).optional().transform((value) => value != null ? String(value) : null),
  timestamp: z.number(),
});

const OkxTradeSchema = z.object({
  instId: z.string(),
  side: sideStr,
  px: numStr,
  sz: numStr,
  fillVol: numStr.optional(),
  tradeId: z.union([z.string(), z.number()]).optional().transform((value) => value != null ? String(value) : null),
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
  t: z.union([z.string(), z.number()]).optional().transform((value) => value != null ? String(value) : null),
  X: z.string().optional(),
  T: z.number(),
});

const DeriveTradeSchema = z.object({
  instrument_name: z.string(),
  direction: sideStr,
  trade_id: z.union([z.string(), z.number()]).optional().transform((value) => value != null ? String(value) : null),
  trade_price: numStr,
  trade_amount: numStr,
  mark_price: optNum,
  index_price: optNum,
  rfq_id: z.string().nullable().optional(),
  timestamp: z.number(),
});

function deribitTradeToEvent(raw: z.infer<typeof DeribitTradeSchema>, underlying: string): TradeEvent {
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

const VENUE_STREAMS: VenueStream[] = [
  {
    venue: 'deribit',
    url: DERIBIT_WS_URL,
    connect(ws, underlying) {
      ws.send(JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'public/subscribe',
        params: { channels: [`trades.option.${underlying}.100ms`] },
      }));
    },
    parse(msg) {
      const m = msg as Record<string, unknown>;
      if (m['method'] !== 'subscription') return [];
      const params = m['params'] as Record<string, unknown> | undefined;
      const data = params?.['data'];
      if (!Array.isArray(data)) return [];

      const trades: TradeEvent[] = [];
      for (const item of data) {
        const parsed = DeribitTradeSchema.safeParse(item);
        if (!parsed.success) continue;
        trades.push(deribitTradeToEvent(parsed.data, parsed.data.instrument_name.split('-')[0]!));
      }
      return trades;
    },
    async seed(underlying) {
      const ws = new WebSocket(DERIBIT_WS_URL);
      return new Promise<TradeEvent[]>((resolve) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1,
            method: 'public/get_last_trades_by_currency',
            params: { currency: underlying, kind: 'option', count: 50 },
          }));
        });
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (msg['id'] !== 1) return;
          const result = msg['result'] as Record<string, unknown> | undefined;
          const trades = result?.['trades'] as Array<Record<string, unknown>> | undefined;
          ws.close();
          if (!trades) { resolve([]); return; }
          const events: TradeEvent[] = [];
          for (const t of trades) {
            const p = DeribitTradeSchema.safeParse(t);
            if (p.success) events.push(deribitTradeToEvent(p.data, underlying));
          }
          resolve(events);
        });
        ws.on('error', () => { ws.close(); resolve([]); });
        setTimeout(() => { ws.close(); resolve([]); }, 10000);
      });
    },
  },
  {
    venue: 'okx',
    url: OKX_WS_URL,
    // OKX drops idle connections — must send "ping" text every 25s
    startKeepalive(ws) {
      return setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 25_000);
    },
    connect(ws, underlying) {
      ws.send(JSON.stringify({
        op: 'subscribe',
        args: [{ channel: 'option-trades', instFamily: `${underlying}-USD` }],
      }));
    },
    parse(msg, underlying) {
      const m = msg as Record<string, unknown>;
      if (!m['data'] || !Array.isArray(m['data'])) return [];
      const trades: TradeEvent[] = [];
      for (const item of m['data'] as unknown[]) {
        const parsed = OkxTradeSchema.safeParse(item);
        if (!parsed.success) continue;
        trades.push({
          venue: 'okx', tradeId: parsed.data.tradeId,
          instrument: parsed.data.instId, underlying,
          side: parsed.data.side,
          price: parsed.data.px, size: parsed.data.sz,
          iv: parsed.data.fillVol ?? null,
          markPrice: null, indexPrice: null, isBlock: false,
          timestamp: parsed.data.ts,
        });
      }
      return trades;
    },
    async seed(underlying) {
      try {
        const res = await fetch(
          `${OKX_REST_BASE_URL}/api/v5/market/option/instrument-family-trades?instFamily=${underlying}-USD`,
          { signal: AbortSignal.timeout(10_000) },
        );
        const data = await res.json() as Record<string, unknown>;
        const items = data['data'] as Array<Record<string, unknown>> | undefined;
        if (!items) return [];
        // OKX REST groups trades by optType with a tradeInfo array
        const OkxRestTradeSchema = z.object({
          instId: z.string(),
          side: sideStr,
          px: numStr,
          sz: numStr,
          tradeId: z.union([z.string(), z.number()]).optional().transform((value) => value != null ? String(value) : null),
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
              venue: 'okx', tradeId: p.data.tradeId,
              instrument: p.data.instId, underlying,
              side: p.data.side, price: p.data.px, size: p.data.sz,
              iv: null, markPrice: null, indexPrice: null,
              isBlock: false, timestamp: p.data.ts,
            });
          }
        }
        return trades;
      } catch { return []; }
    },
  },
  {
    venue: 'bybit',
    url: BYBIT_WS_URL,
    // Bybit requires JSON ping every 20s — not WS-level ping frames
    startKeepalive(ws) {
      return setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' })); }, 20_000);
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
          venue: 'bybit', tradeId: parsed.data.i ?? null,
          instrument: parsed.data.s,
          underlying: parsed.data.s.split('-')[0]!,
          side: parsed.data.S,
          price: parsed.data.p, size: parsed.data.v,
          iv: parsed.data.iv ?? null,
          markPrice: parsed.data.mP, indexPrice: parsed.data.iP,
          isBlock: parsed.data.BT === true,
          timestamp: parsed.data.T,
        });
      }
      return trades;
    },
    async seed(underlying) {
      try {
        const res = await fetch(`${BYBIT_REST_BASE_URL}/v5/market/recent-trade?category=option&baseCoin=${underlying}&limit=50`, { signal: AbortSignal.timeout(10_000) });
        const data = await res.json() as Record<string, unknown>;
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
            venue: 'bybit', tradeId: p.data.execId ?? null,
            instrument: p.data.symbol, underlying,
            side: p.data.side,
            price: p.data.price, size: p.data.size,
            iv: p.data.iv ?? null,
            markPrice: p.data.mP, indexPrice: p.data.iP,
            isBlock: p.data.isBlockTrade === true,
            timestamp: p.data.time,
          });
        }
        return trades;
      } catch { return []; }
    },
  },
  {
    venue: 'binance',
    url: BINANCE_OPTIONS_WS_URL,
    connect(ws, underlying) {
      ws.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: [`${underlying.toLowerCase()}usdt@optionTrade`],
        id: 1,
      }));
    },
    parse(msg) {
      const m = msg as Record<string, unknown>;
      const data = (m['data'] as Record<string, unknown> | undefined) ?? m;

      const parsed = BinanceTradeSchema.safeParse(data);
      if (!parsed.success) return [];

      return [{
        venue: 'binance' as VenueId,
        tradeId: parsed.data.t,
        instrument: parsed.data.s,
        underlying: parsed.data.s.split('-')[0]!,
        side: parsed.data.S,
        price: parsed.data.p,
        size: parsed.data.q,
        iv: null,
        markPrice: null, indexPrice: null,
        isBlock: parsed.data.X === 'BLOCK',
        timestamp: parsed.data.T,
      }];
    },
  },
  {
    venue: 'derive',
    url: DERIVE_WS_URL,
    connect(ws, underlying) {
      ws.send(JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'subscribe',
        params: { channels: [`trades.option.${underlying}`] },
      }));
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
          venue: 'derive', tradeId: parsed.data.trade_id,
          instrument: parsed.data.instrument_name, underlying,
          side: parsed.data.direction,
          price: parsed.data.trade_price, size: parsed.data.trade_amount,
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
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'public/get_trade_history',
            params: {
              currency: underlying,
              instrument_type: 'option',
              page: 999999,
              page_size: 100,
            }, // last page = newest trades per Derive docs

          }));
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
];
