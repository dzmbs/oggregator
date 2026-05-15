import { z } from 'zod';
import {
  BINANCE_REST_BASE_URL,
  BYBIT_REST_BASE_URL,
  DERIBIT_REST_BASE_URL,
  DERIVE_REST_BASE_URL,
  GATEIO_REST_BASE_URL,
  OKX_REST_BASE_URL,
  THALEX_REST_URL,
} from '../feeds/shared/endpoints.js';
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
  const markByTs = new Map(mark.map((c) => [c.ts, c]));
  const allTs = new Set<number>([...tradeByTs.keys(), ...markByTs.keys()]);
  const candles: InstrumentCandle[] = [];
  const markLine: InstrumentMarkPoint[] = [];
  for (const ts of allTs) {
    const t = tradeByTs.get(ts);
    const m = markByTs.get(ts);
    if (t && t.vol > 0) {
      candles.push({ ts, o: t.o, h: t.h, l: t.l, c: t.c, vol: t.vol, synthetic: false });
    } else if (m) {
      candles.push({ ts, o: m.o, h: m.h, l: m.l, c: m.c, vol: 0, synthetic: true });
    } else if (t) {
      candles.push({ ts, o: t.o, h: t.h, l: t.l, c: t.c, vol: 0, synthetic: false });
    }
    if (m) markLine.push({ ts, c: m.c });
  }
  candles.sort((a, b) => a.ts - b.ts);
  markLine.sort((a, b) => a.ts - b.ts);
  return { candles, markLine };
}

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

export function bucketTicks(
  ticks: ReadonlyArray<[number, number]>,
  bucketMs: number,
): RawCandle[] {
  const sorted = [...ticks].sort((a, b) => a[0] - b[0]);
  const out = new Map<number, RawCandle>();
  for (const [ts, v] of sorted) {
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

// ── Deribit ────────────────────────────────────────────────────────
const INTERVAL_TO_DERIBIT: Record<InstrumentCandleInterval, string> = {
  '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': '1D',
};

const DeribitTradingViewSchema = z.object({
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

const DeribitMarkHistorySchema = z.object({
  result: z.array(z.tuple([z.number(), z.number()])),
});

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
  const result = DeribitTradingViewSchema.safeParse(await res.json());
  if (!result.success) {
    log.warn({ issues: result.error.issues, symbol }, 'deribit trade parse failed');
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
  const result = DeribitMarkHistorySchema.safeParse(await res.json());
  if (!result.success) {
    log.warn({ issues: result.error.issues, symbol }, 'deribit mark parse failed');
    return [];
  }
  return bucketTicks(result.data.result, INTERVAL_TO_MS[interval]);
}

// ── Binance ────────────────────────────────────────────────────────
const INTERVAL_TO_BINANCE: Record<InstrumentCandleInterval, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d',
};

const BinanceKlineSchema = z.array(
  z.tuple([
    z.number(),  // openTime
    z.string(),  // open
    z.string(),  // high
    z.string(),  // low
    z.string(),  // close
    z.string(),  // volume
    z.number(),  // closeTime
    z.string(),  // quoteVolume
    z.number(),  // takerVolume
    z.string(),  // takerQuoteVolume
    z.string(),  // amount
    z.string(),  // ignore
  ]).rest(z.unknown()),
);

export async function fetchBinanceTrade(
  symbol: string,
  interval: InstrumentCandleInterval,
  range: InstrumentCandleRange,
): Promise<RawCandle[]> {
  const now = Date.now();
  const start = now - RANGE_TO_MS[range];
  const params = new URLSearchParams({
    symbol,
    interval: INTERVAL_TO_BINANCE[interval],
    startTime: String(start),
    endTime: String(now),
    limit: '500',
  });
  const res = await fetch(
    `${BINANCE_REST_BASE_URL}/eapi/v1/klines?${params}`,
    { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } },
  );
  if (res.status === 400 || res.status === 404) {
    throw new InstrumentCandlesError('not_found', `Binance: ${symbol}`);
  }
  if (!res.ok) throw new InstrumentCandlesError('upstream', `Binance ${res.status}`);
  const result = BinanceKlineSchema.safeParse(await res.json());
  if (!result.success) {
    log.warn({ issues: result.error.issues, symbol }, 'binance klines parse failed');
    return [];
  }
  return result.data.map((row) => ({
    ts: row[0],
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    vol: Number(row[5]),
  }));
}

// ── OKX ────────────────────────────────────────────────────────────
const INTERVAL_TO_OKX: Record<InstrumentCandleInterval, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1D',
};

// market/candles returns [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
const OkxCandleSchema = z.object({
  code: z.string(),
  data: z.array(z.array(z.string())),
});
// history-mark-price-candles returns [ts, o, h, l, c, confirm]
const OkxMarkCandleSchema = z.object({
  code: z.string(),
  data: z.array(z.array(z.string())),
});

export async function fetchOkxTrade(
  symbol: string,
  interval: InstrumentCandleInterval,
  range: InstrumentCandleRange,
): Promise<RawCandle[]> {
  const now = Date.now();
  const start = now - RANGE_TO_MS[range];
  const params = new URLSearchParams({
    instId: symbol,
    bar: INTERVAL_TO_OKX[interval],
    after: String(now),
    before: String(start),
    limit: '300',
  });
  const res = await fetch(
    `${OKX_REST_BASE_URL}/api/v5/market/candles?${params}`,
    { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } },
  );
  if (res.status === 404) throw new InstrumentCandlesError('not_found', `OKX: ${symbol}`);
  if (!res.ok) throw new InstrumentCandlesError('upstream', `OKX ${res.status}`);
  const result = OkxCandleSchema.safeParse(await res.json());
  if (!result.success || result.data.code !== '0') {
    log.warn({ symbol, code: result.success ? result.data.code : null }, 'okx candles parse failed');
    return [];
  }
  return result.data.data.map((row) => ({
    ts: Number(row[0]),
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    vol: Number(row[5] ?? '0'),
  }));
}

export async function fetchOkxMark(
  symbol: string,
  interval: InstrumentCandleInterval,
  range: InstrumentCandleRange,
): Promise<RawCandle[]> {
  const now = Date.now();
  const start = now - RANGE_TO_MS[range];
  const params = new URLSearchParams({
    instId: symbol,
    bar: INTERVAL_TO_OKX[interval],
    after: String(now),
    before: String(start),
    limit: '300',
  });
  const res = await fetch(
    `${OKX_REST_BASE_URL}/api/v5/market/history-mark-price-candles?${params}`,
    { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } },
  );
  if (res.status === 404) throw new InstrumentCandlesError('not_found', `OKX: ${symbol}`);
  if (!res.ok) throw new InstrumentCandlesError('upstream', `OKX ${res.status}`);
  const result = OkxMarkCandleSchema.safeParse(await res.json());
  if (!result.success || result.data.code !== '0') {
    log.warn({ symbol, code: result.success ? result.data.code : null }, 'okx mark parse failed');
    return [];
  }
  return result.data.data.map((row) => ({
    ts: Number(row[0]),
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    vol: 0,
  }));
}

// ── Gate.io ────────────────────────────────────────────────────────
const INTERVAL_TO_GATEIO: Record<InstrumentCandleInterval, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d',
};

const GateioCandleSchema = z.array(
  z.object({
    t: z.number(),
    o: z.string(),
    h: z.string(),
    l: z.string(),
    c: z.string(),
    v: z.number(),
  }),
);

export async function fetchGateioTrade(
  symbol: string,
  interval: InstrumentCandleInterval,
  range: InstrumentCandleRange,
): Promise<RawCandle[]> {
  const now = Math.floor(Date.now() / 1000);
  const start = now - Math.floor(RANGE_TO_MS[range] / 1000);
  const params = new URLSearchParams({
    contract: symbol,
    interval: INTERVAL_TO_GATEIO[interval],
    from: String(start),
    to: String(now),
  });
  const res = await fetch(
    `${GATEIO_REST_BASE_URL}/api/v4/options/candlesticks?${params}`,
    { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } },
  );
  if (res.status === 404) throw new InstrumentCandlesError('not_found', `Gate.io: ${symbol}`);
  if (!res.ok) throw new InstrumentCandlesError('upstream', `Gate.io ${res.status}`);
  const result = GateioCandleSchema.safeParse(await res.json());
  if (!result.success) {
    log.warn({ issues: result.error.issues, symbol }, 'gateio candles parse failed');
    return [];
  }
  return result.data.map((row) => ({
    ts: row.t * 1000,
    o: Number(row.o),
    h: Number(row.h),
    l: Number(row.l),
    c: Number(row.c),
    vol: row.v,
  }));
}

// ── Bybit ──────────────────────────────────────────────────────────
// Bybit has no /v5/market/kline support for category=option (verified:
// retCode 10001 PARAMS_ERROR). The mark-price-kline endpoint does work,
// and we seed traded-price candles by bucketing /v5/market/recent-trade
// locally — Bybit's documented and intended workflow for option charts.
const INTERVAL_TO_BYBIT: Record<InstrumentCandleInterval, string> = {
  '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': 'D',
};

const BybitMarkKlineSchema = z.object({
  retCode: z.number(),
  retMsg: z.string().optional(),
  result: z.object({
    category: z.string().optional(),
    symbol: z.string().optional(),
    // mark-price-kline rows are [ts, o, h, l, c] as strings; newest-first.
    list: z.array(z.array(z.string())),
  }),
});

const BybitRecentTradeSchema = z.object({
  retCode: z.number(),
  retMsg: z.string().optional(),
  result: z.object({
    list: z.array(z.object({
      execId: z.string(),
      price: z.string(),
      size: z.string(),
      time: z.string(),
    })),
  }),
});

export async function fetchBybitMark(
  symbol: string,
  interval: InstrumentCandleInterval,
  range: InstrumentCandleRange,
): Promise<RawCandle[]> {
  const now = Date.now();
  const start = now - RANGE_TO_MS[range];
  const params = new URLSearchParams({
    category: 'option',
    symbol,
    interval: INTERVAL_TO_BYBIT[interval],
    start: String(start),
    end: String(now),
    limit: '1000',
  });
  const res = await fetch(
    `${BYBIT_REST_BASE_URL}/v5/market/mark-price-kline?${params}`,
    { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } },
  );
  if (res.status === 404) throw new InstrumentCandlesError('not_found', `Bybit: ${symbol}`);
  if (!res.ok) throw new InstrumentCandlesError('upstream', `Bybit ${res.status}`);
  const result = BybitMarkKlineSchema.safeParse(await res.json());
  if (!result.success || result.data.retCode !== 0) {
    log.warn({ symbol, retCode: result.success ? result.data.retCode : null }, 'bybit mark parse failed');
    return [];
  }
  return result.data.result.list.map((row) => ({
    ts: Number(row[0]),
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    vol: 0,
  }));
}

export async function fetchBybitTradeBucketed(
  symbol: string,
  interval: InstrumentCandleInterval,
  range: InstrumentCandleRange,
): Promise<RawCandle[]> {
  const cutoff = Date.now() - RANGE_TO_MS[range];
  const params = new URLSearchParams({
    category: 'option',
    symbol,
    limit: '1000',
  });
  const res = await fetch(
    `${BYBIT_REST_BASE_URL}/v5/market/recent-trade?${params}`,
    { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } },
  );
  if (res.status === 404) throw new InstrumentCandlesError('not_found', `Bybit: ${symbol}`);
  if (!res.ok) throw new InstrumentCandlesError('upstream', `Bybit ${res.status}`);
  const result = BybitRecentTradeSchema.safeParse(await res.json());
  if (!result.success || result.data.retCode !== 0) {
    log.warn({ symbol, retCode: result.success ? result.data.retCode : null }, 'bybit trade parse failed');
    return [];
  }
  return bucketTrades(
    result.data.result.list
      .filter((t) => Number(t.time) >= cutoff)
      .map((t) => ({ execId: t.execId, ts: Number(t.time), price: Number(t.price), size: Number(t.size) })),
    INTERVAL_TO_MS[interval],
  );
}

// ── Derive (Lyra v2) ───────────────────────────────────────────────
// Derive has no aggregated kline endpoint, so we paginate
// public/get_trade_history and bucket trades locally. Trades appear
// twice (one record per side of the fill, sharing trade_id) and we
// dedupe on trade_id before bucketing.
const DeriveTradeHistorySchema = z.object({
  result: z.object({
    trades: z.array(z.object({
      trade_id: z.string(),
      timestamp: z.number(),
      trade_price: z.string(),
      trade_amount: z.string(),
    })),
    pagination: z.object({
      num_pages: z.number(),
      count: z.number(),
    }).optional(),
  }),
});

const DERIVE_MAX_PAGES = 5;
const DERIVE_PAGE_SIZE = 1000;

export async function fetchDeriveTradeBucketed(
  symbol: string,
  interval: InstrumentCandleInterval,
  range: InstrumentCandleRange,
): Promise<RawCandle[]> {
  const cutoff = Date.now() - RANGE_TO_MS[range];
  const seen = new Set<string>();
  const trades: Array<{ execId: string; ts: number; price: number; size: number }> = [];

  for (let page = 1; page <= DERIVE_MAX_PAGES; page++) {
    const res = await fetch(`${DERIVE_REST_BASE_URL}/public/get_trade_history`, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        instrument_name: symbol,
        page_size: DERIVE_PAGE_SIZE,
        page,
      }),
    });
    if (res.status === 404) throw new InstrumentCandlesError('not_found', `Derive: ${symbol}`);
    if (!res.ok) throw new InstrumentCandlesError('upstream', `Derive ${res.status}`);
    const result = DeriveTradeHistorySchema.safeParse(await res.json());
    if (!result.success) {
      log.warn({ symbol, issues: result.error.issues }, 'derive trade parse failed');
      return [];
    }
    const pageTrades = result.data.result.trades;
    if (pageTrades.length === 0) break;

    let oldestTs = Number.POSITIVE_INFINITY;
    for (const t of pageTrades) {
      if (seen.has(t.trade_id)) continue;
      seen.add(t.trade_id);
      if (t.timestamp < oldestTs) oldestTs = t.timestamp;
      trades.push({
        execId: t.trade_id,
        ts: t.timestamp,
        price: Number(t.trade_price),
        size: Number(t.trade_amount),
      });
    }
    if (oldestTs < cutoff) break;
    if (pageTrades.length < DERIVE_PAGE_SIZE) break;
  }
  return bucketTrades(
    trades.filter((t) => t.ts >= cutoff),
    INTERVAL_TO_MS[interval],
  );
}

// Bucket dedup'd trades (execId-keyed at the caller) into OHLCV candles.
export function bucketTrades(
  trades: ReadonlyArray<{ execId: string; ts: number; price: number; size: number }>,
  bucketMs: number,
): RawCandle[] {
  const sorted = [...trades].sort((a, b) => a.ts - b.ts);
  const out = new Map<number, RawCandle>();
  for (const t of sorted) {
    if (!Number.isFinite(t.price) || !Number.isFinite(t.ts)) continue;
    const b = Math.floor(t.ts / bucketMs) * bucketMs;
    const cur = out.get(b);
    if (!cur) {
      out.set(b, { ts: b, o: t.price, h: t.price, l: t.price, c: t.price, vol: t.size });
    } else {
      cur.h = Math.max(cur.h, t.price);
      cur.l = Math.min(cur.l, t.price);
      cur.c = t.price;
      cur.vol += t.size;
    }
  }
  return [...out.values()].sort((a, b) => a.ts - b.ts);
}

// ── Thalex ─────────────────────────────────────────────────────────
// REST GET /api/v2/public/mark_price_historical_data. Options row format
// per the OpenAPI spec (rest_historical_data tag):
//   [ts, o, h, l, c, oIv, hIv, lIv, cIv, top_of_book | null]
// Timestamps are Unix seconds (number, may be float). Public, no auth.
const INTERVAL_TO_THALEX: Record<InstrumentCandleInterval, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '1h', '1d': '1d',
};
// Thalex resolutions: 1m, 5m, 15m, 30m, 1h, 1d, 1w — no 4h, fall back to 1h.

const ThalexHistoricalSchema = z.object({
  result: z.object({
    instrument_type: z.string(),
    mark: z.array(z.array(z.unknown())),
    no_data: z.boolean().optional(),
  }),
});

export async function fetchThalexMark(
  symbol: string,
  interval: InstrumentCandleInterval,
  range: InstrumentCandleRange,
): Promise<RawCandle[]> {
  const now = Math.floor(Date.now() / 1000);
  const start = now - Math.floor(RANGE_TO_MS[range] / 1000);
  const params = new URLSearchParams({
    instrument_name: symbol,
    from: String(start),
    to: String(now),
    resolution: INTERVAL_TO_THALEX[interval],
  });
  const res = await fetch(
    `${THALEX_REST_URL}/public/mark_price_historical_data?${params}`,
    { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } },
  );
  if (res.status === 404) throw new InstrumentCandlesError('not_found', `Thalex: ${symbol}`);
  if (!res.ok) throw new InstrumentCandlesError('upstream', `Thalex ${res.status}`);
  const result = ThalexHistoricalSchema.safeParse(await res.json());
  if (!result.success) {
    log.warn({ issues: result.error.issues, symbol }, 'thalex mark parse failed');
    return [];
  }
  if (result.data.result.no_data) return [];
  const candles: RawCandle[] = [];
  for (const row of result.data.result.mark) {
    if (row.length < 5) continue;
    const ts = Number(row[0]);
    if (!Number.isFinite(ts)) continue;
    candles.push({
      ts: Math.floor(ts * 1000),
      o: Number(row[1]),
      h: Number(row[2]),
      l: Number(row[3]),
      c: Number(row[4]),
      vol: 0,
    });
  }
  return candles;
}

// ── Venue capability map ──────────────────────────────────────────
// Wired venues: deribit, binance, okx, gateio, bybit, derive, thalex.
// Intentionally NOT wired (verified against official docs):
//   coincall — GET /open/option/market/kline/history/v1/{optionName}
//              is the official kline path, but Coincall's own example
//              curl explicitly requires signed headers (X-CC-APIKEY,
//              sign, ts, X-REQ-TS-DIFF). Probing the endpoint without
//              auth returns code:4003 "token auth fail". Vendor-gated.
const SUPPORTED_VENUES = new Set<VenueId>([
  'deribit', 'binance', 'okx', 'gateio', 'bybit', 'derive', 'thalex',
]);

const PRICE_CURRENCY: Record<string, string> = {
  deribit: 'BASE',    // BTC for BTC options, ETH for ETH options
  binance: 'USDT',
  okx: 'BASE',        // inverse — quoted in BTC/ETH
  gateio: 'USDT',
  bybit: 'USDT',
  derive: 'USDC',
  thalex: 'USD',
};

function priceCurrencyFor(venue: VenueId, symbol: string): string {
  const base = PRICE_CURRENCY[venue] ?? 'USD';
  if (base !== 'BASE') return base;
  const head = symbol.split('-')[0] ?? symbol.split('_')[0] ?? '';
  return head || 'BASE';
}

interface CacheEntry {
  fetchedAt: number;
  response: InstrumentCandlesResponse;
}

export class InstrumentCandleService {
  // Map preserves insertion order; we use that for FIFO eviction once the cap
  // is exceeded. Bound: ~5KB per entry × 500 keys = ~2.5MB ceiling.
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 30_000;
  private readonly cacheMaxEntries = 500;
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

    if (!SUPPORTED_VENUES.has(venue)) {
      throw new InstrumentCandlesError('unsupported_venue', `Venue ${venue} not yet supported`);
    }

    const [trade, mark] = await this.fetchForVenue(venue, symbol, interval, range);
    const merged = mergeTradeAndMark(trade, mark);
    const response: InstrumentCandlesResponse = {
      venue,
      symbol,
      interval,
      candles: merged.candles,
      markLine: merged.markLine,
      priceCurrency: priceCurrencyFor(venue, symbol),
    };
    if (this.cache.size >= this.cacheMaxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { fetchedAt: Date.now(), response });
    log.debug({ venue, symbol, interval, range, count: merged.candles.length }, 'instrument-candles fetched');
    return response;
  }

  private async fetchForVenue(
    venue: VenueId,
    symbol: string,
    interval: InstrumentCandleInterval,
    range: InstrumentCandleRange,
  ): Promise<[RawCandle[], RawCandle[]]> {
    switch (venue) {
      case 'deribit':
        return Promise.all([
          fetchDeribitTrade(symbol, interval, range),
          fetchDeribitMark(symbol, interval, range),
        ]);
      case 'binance':
        return Promise.all([
          fetchBinanceTrade(symbol, interval, range),
          Promise.resolve([] as RawCandle[]),
        ]);
      case 'okx':
        return Promise.all([
          fetchOkxTrade(symbol, interval, range),
          fetchOkxMark(symbol, interval, range),
        ]);
      case 'gateio':
        return Promise.all([
          fetchGateioTrade(symbol, interval, range),
          Promise.resolve([] as RawCandle[]),
        ]);
      case 'bybit':
        return Promise.all([
          fetchBybitTradeBucketed(symbol, interval, range),
          fetchBybitMark(symbol, interval, range),
        ]);
      case 'derive':
        return Promise.all([
          fetchDeriveTradeBucketed(symbol, interval, range),
          Promise.resolve([] as RawCandle[]),
        ]);
      case 'thalex':
        return Promise.all([
          Promise.resolve([] as RawCandle[]),
          fetchThalexMark(symbol, interval, range),
        ]);
      default:
        throw new InstrumentCandlesError('unsupported_venue', `Venue ${venue} not yet supported`);
    }
  }
}

export const instrumentCandleService = new InstrumentCandleService();
