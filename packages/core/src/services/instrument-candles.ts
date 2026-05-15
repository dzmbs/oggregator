import { z } from 'zod';
import { DERIBIT_REST_BASE_URL } from '../feeds/shared/endpoints.js';
import { feedLogger } from '../utils/logger.js';
import type {
  InstrumentCandle,
  InstrumentMarkPoint,
  InstrumentCandleInterval,
  InstrumentCandleRange,
  InstrumentCandlesResponse,
  VenueId,
} from '@oggregator/protocol';

const log = feedLogger('instrument-candles');

interface RawCandle {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  vol: number;
}

export class InstrumentCandlesError extends Error {
  constructor(
    public readonly code: 'not_found' | 'unsupported_venue' | 'upstream',
    message: string,
  ) {
    super(message);
    this.name = 'InstrumentCandlesError';
  }
}

export function mergeTradeAndMark(
  trade: readonly RawCandle[],
  mark: readonly RawCandle[],
): { candles: InstrumentCandle[]; markLine: InstrumentMarkPoint[] } {
  const tradeByTs = new Map(trade.map((c) => [c.ts, c]));
  const candles: InstrumentCandle[] = [];
  const markLine: InstrumentMarkPoint[] = [];
  for (const m of mark) {
    markLine.push({ ts: m.ts, c: m.c });
    const t = tradeByTs.get(m.ts);
    if (t && t.vol > 0) {
      candles.push({ ts: t.ts, o: t.o, h: t.h, l: t.l, c: t.c, vol: t.vol, synthetic: false });
    } else {
      candles.push({ ts: m.ts, o: m.o, h: m.h, l: m.l, c: m.c, vol: 0, synthetic: true });
    }
  }
  candles.sort((a, b) => a.ts - b.ts);
  markLine.sort((a, b) => a.ts - b.ts);
  return { candles, markLine };
}

const INTERVAL_TO_DERIBIT: Record<InstrumentCandleInterval, string> = {
  '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': '1D',
};

const INTERVAL_TO_MS: Record<InstrumentCandleInterval, number> = {
  '1m': 60_000, '5m': 5 * 60_000, '15m': 15 * 60_000,
  '1h': 60 * 60_000, '4h': 4 * 60 * 60_000, '1d': 24 * 60 * 60_000,
};

const RANGE_TO_MS: Record<InstrumentCandleRange, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  max: 365 * 24 * 60 * 60 * 1000,
};

const TradingViewSchema = z.object({
  result: z.object({
    status: z.string(),
    ticks: z.array(z.number()),
    open: z.array(z.number()),
    high: z.array(z.number()),
    low: z.array(z.number()),
    close: z.array(z.number()),
    volume: z.array(z.number()).optional(),
  }),
});

const MarkHistorySchema = z.object({
  result: z.array(z.tuple([z.number(), z.number()])),
});

export function bucketTicks(
  ticks: ReadonlyArray<[number, number]>,
  bucketMs: number,
): RawCandle[] {
  const out = new Map<number, RawCandle>();
  for (const [ts, v] of ticks) {
    const b = Math.floor(ts / bucketMs) * bucketMs;
    const cur = out.get(b);
    if (!cur) out.set(b, { ts: b, o: v, h: v, l: v, c: v, vol: 0 });
    else {
      cur.h = Math.max(cur.h, v);
      cur.l = Math.min(cur.l, v);
      cur.c = v;
    }
  }
  return [...out.values()].sort((a, b) => a.ts - b.ts);
}

export async function fetchDeribitTrade(
  symbol: string,
  interval: InstrumentCandleInterval,
  range: InstrumentCandleRange,
): Promise<RawCandle[]> {
  const now = Date.now();
  const start = now - RANGE_TO_MS[range];
  const params = new URLSearchParams({
    instrument_name: symbol,
    resolution: INTERVAL_TO_DERIBIT[interval],
    start_timestamp: String(start),
    end_timestamp: String(now),
  });
  const res = await fetch(
    `${DERIBIT_REST_BASE_URL}/api/v2/public/get_tradingview_chart_data?${params}`,
    { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } },
  );
  if (res.status === 404) throw new InstrumentCandlesError('not_found', `Deribit: ${symbol}`);
  if (!res.ok) throw new InstrumentCandlesError('upstream', `Deribit ${res.status}`);
  const result = TradingViewSchema.safeParse(await res.json());
  if (!result.success) {
    log.warn({ issues: result.error.issues, symbol }, 'deribit response parse failed');
    return [];
  }
  const r = result.data.result;
  if (r.status === 'no_data') return [];
  const len = Math.min(
    r.ticks.length, r.open.length, r.high.length, r.low.length, r.close.length,
  );
  const candles: RawCandle[] = [];
  for (let i = 0; i < len; i++) {
    candles.push({
      ts: r.ticks[i]!,
      o: r.open[i]!,
      h: r.high[i]!,
      l: r.low[i]!,
      c: r.close[i]!,
      vol: r.volume?.[i] ?? 0,
    });
  }
  return candles;
}

export async function fetchDeribitMark(
  symbol: string,
  interval: InstrumentCandleInterval,
  range: InstrumentCandleRange,
): Promise<RawCandle[]> {
  const now = Date.now();
  const start = now - RANGE_TO_MS[range];
  const params = new URLSearchParams({
    instrument_name: symbol,
    start_timestamp: String(start),
    end_timestamp: String(now),
  });
  const res = await fetch(
    `${DERIBIT_REST_BASE_URL}/api/v2/public/get_mark_price_history?${params}`,
    { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } },
  );
  if (res.status === 404) throw new InstrumentCandlesError('not_found', `Deribit: ${symbol}`);
  if (!res.ok) throw new InstrumentCandlesError('upstream', `Deribit ${res.status}`);
  const result = MarkHistorySchema.safeParse(await res.json());
  if (!result.success) {
    log.warn({ issues: result.error.issues, symbol }, 'deribit response parse failed');
    return [];
  }
  return bucketTicks(result.data.result, INTERVAL_TO_MS[interval]);
}

interface CacheEntry {
  fetchedAt: number;
  response: InstrumentCandlesResponse;
}

export class InstrumentCandleService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 30_000;
  private ready = false;

  async start(): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getCandles(
    venue: VenueId,
    symbol: string,
    interval: InstrumentCandleInterval,
    range: InstrumentCandleRange,
  ): Promise<InstrumentCandlesResponse> {
    const key = `${venue}:${symbol}:${interval}:${range}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.fetchedAt < this.cacheTtlMs) return hit.response;

    if (venue !== 'deribit') {
      throw new InstrumentCandlesError('unsupported_venue', `Venue ${venue} not yet supported`);
    }

    const [trade, mark] = await Promise.all([
      fetchDeribitTrade(symbol, interval, range),
      fetchDeribitMark(symbol, interval, range),
    ]);
    const merged = mergeTradeAndMark(trade, mark);
    const response: InstrumentCandlesResponse = {
      venue,
      symbol,
      interval,
      candles: merged.candles,
      markLine: merged.markLine,
    };
    this.cache.set(key, { fetchedAt: Date.now(), response });
    log.debug({ venue, symbol, interval, range, count: merged.candles.length }, 'instrument-candles fetched');
    return response;
  }
}

export const instrumentCandleService = new InstrumentCandleService();
