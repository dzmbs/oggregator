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
import { computeLiveTradeAmounts } from './trade-persistence.js';

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
  startKeepalive?: (ws: WebSocket) => ReturnType<typeof setInterval>;
}

export interface FlowStreamHealth {
  venue: VenueId;
  underlying: string;
  connected: boolean;
  lastMessageAt: number | null;
  lastTradeAt: number | null;
  lastStatusAt: number | null;
  reconnects: number;
  errors: number;
  seedTrades: number;
  bufferedTrades: number;
}

interface FlowStreamState {
  connected: boolean;
  lastMessageAt: number | null;
  lastTradeAt: number | null;
  lastStatusAt: number | null;
  reconnects: number;
  errors: number;
  seedTrades: number;
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
  private subscribedUnderlyingsByConnection = new Map<string, Set<string>>();
  private listeners = new Set<(trade: TradeEvent) => void>();
  private streamState = new Map<string, FlowStreamState>();
  private shouldReconnect = true;

  async start(underlyings: string[] = ['BTC', 'ETH']): Promise<void> {
    // Open live WS connections first so callers can serve /flow without waiting for REST seeds.
    for (const underlying of underlyings) {
      this.buffers.set(underlying, []);
      for (const stream of VENUE_STREAMS) {
        this.streamState.set(this.streamKey(stream.venue, underlying), {
          connected: false,
          lastMessageAt: null,
          lastTradeAt: null,
          lastStatusAt: null,
          reconnects: 0,
          errors: 0,
          seedTrades: 0,
        });

        if (stream.venue === 'deribit' && getDeribitTradeCurrency(underlying) == null) {
          continue;
        }

        this.registerConnectionUnderlying(stream, underlying);
        this.connectStream(stream, underlying);
      }
    }

    // Seed recent trades in the background. Slow REST venues must not delay live flow availability.
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
    if (minNotional <= 0) return buffer;
    return buffer.filter((trade) => {
      const amounts = computeLiveTradeAmounts(trade, trade.indexPrice);
      return (amounts.notionalUsd ?? 0) >= minNotional;
    });
  }

  subscribe(listener: (trade: TradeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getHealth(): FlowStreamHealth[] {
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
          bufferedTrades: this.buffers.get(underlying)?.filter((trade) => trade.venue === stream.venue).length ?? 0,
        } satisfies FlowStreamHealth;
      }),
    );
  }

  private connectStream(stream: VenueStream, underlying: string, attempt = 0): void {
    if (!this.shouldReconnect) return;

    const key = this.connectionKey(stream, underlying);
    if (this.connections.has(key) || this.reconnectTimers.has(key)) return;

    const subscribedUnderlyings = this.getConnectionUnderlyings(stream, underlying);
    const ws = new WebSocket(stream.url);
    let didOpen = false;

    ws.on('open', () => {
      didOpen = true;
      this.updateStreamStates(stream.venue, subscribedUnderlyings, {
        connected: true,
        lastStatusAt: Date.now(),
      });
      log.info({ venue: stream.venue, underlying: subscribedUnderlyings.join(',') }, 'trade stream connected');
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

    ws.on('close', () => {
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
            reconnects: (this.streamState.get(this.streamKey(stream.venue, subscribedUnderlying))?.reconnects ?? 0) + 1,
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
          errors: (this.streamState.get(this.streamKey(stream.venue, subscribedUnderlying))?.errors ?? 0) + 1,
          lastStatusAt: Date.now(),
        });
      }
      log.warn({ venue: stream.venue, underlying: subscribedUnderlyings.join(','), err: err.message }, 'trade stream error');
    });

    this.connections.set(key, ws);
  }

  private streamKey(venue: VenueId, underlying: string): string {
    return `${venue}:${underlying}`;
  }

  private connectionKey(stream: VenueStream, underlying: string): string {
    if (stream.venue !== 'deribit') return this.streamKey(stream.venue, underlying);
    const tradeCurrency = getDeribitTradeCurrency(underlying);
    return tradeCurrency ? this.streamKey(stream.venue, tradeCurrency) : this.streamKey(stream.venue, underlying);
  }

  private registerConnectionUnderlying(stream: VenueStream, underlying: string): void {
    const key = this.connectionKey(stream, underlying);
    const subscribedUnderlyings = this.subscribedUnderlyingsByConnection.get(key) ?? new Set<string>();
    subscribedUnderlyings.add(underlying);
    this.subscribedUnderlyingsByConnection.set(key, subscribedUnderlyings);
  }

  private getConnectionUnderlyings(stream: VenueStream, underlying: string): string[] {
    const key = this.connectionKey(stream, underlying);
    const subscribedUnderlyings = this.subscribedUnderlyingsByConnection.get(key);
    return subscribedUnderlyings ? [...subscribedUnderlyings] : [underlying];
  }

  private updateStreamState(venue: VenueId, underlying: string, patch: Partial<FlowStreamState>): void {
    const key = this.streamKey(venue, underlying);
    const current = this.streamState.get(key);
    if (!current) return;
    this.streamState.set(key, { ...current, ...patch });
  }

  private updateStreamStates(venue: VenueId, underlyings: string[], patch: Partial<FlowStreamState>): void {
    for (const underlying of underlyings) {
      this.updateStreamState(venue, underlying, patch);
    }
  }

  private pushTrades(underlying: string, trades: TradeEvent[]): void {
    const buffer = this.buffers.get(underlying);
    if (!buffer) return;
    buffer.push(...trades);
    buffer.sort((a, b) => a.timestamp - b.timestamp);
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
    this.subscribedUnderlyingsByConnection.clear();
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

const DERIBIT_INVERSE_OPTION_CURRENCIES = new Set(['BTC', 'ETH']);
const DERIBIT_USDC_OPTION_BASES = new Set(['AVAX', 'SOL', 'TRX', 'XRP']);

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
      const tradeCurrency = getDeribitTradeCurrency(underlying);
      if (!tradeCurrency) return;

      ws.send(JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'public/subscribe',
        params: { channels: [`trades.option.${tradeCurrency}.100ms`] },
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
        const parsed = DeribitTradeSchema.safeParse(item);
        if (!parsed.success || !isDeribitTradeForUnderlying(parsed.data.instrument_name, underlying)) continue;
        trades.push(
          deribitTradeToEvent(
            parsed.data,
            getDeribitUnderlyingFromInstrument(parsed.data.instrument_name) ?? normalizeTradeUnderlying(underlying),
          ),
        );
      }
      return trades;
    },
    async seed(underlying) {
      const tradeCurrency = getDeribitTradeCurrency(underlying);
      if (!tradeCurrency) return [];

      const ws = new WebSocket(DERIBIT_WS_URL);
      return new Promise<TradeEvent[]>((resolve) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1,
            method: 'public/get_last_trades_by_currency',
            params: { currency: tradeCurrency, kind: 'option', count: 50 },
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
            if (!p.success || !isDeribitTradeForUnderlying(p.data.instrument_name, underlying)) continue;
            events.push(
              deribitTradeToEvent(
                p.data,
                getDeribitUnderlyingFromInstrument(p.data.instrument_name) ?? normalizeTradeUnderlying(underlying),
              ),
            );
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
    // No seed: Binance's only public trade history endpoint (GET /eapi/v1/trades)
    // requires a specific symbol — there is no bulk "all trades for underlying"
    // equivalent without auth. Users see no history until a live trade arrives.
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
