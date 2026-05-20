import { z } from 'zod';
import {
  BINANCE_REST_BASE_URL,
  BYBIT_REST_BASE_URL,
  COINCALL_REST_BASE_URL,
  DERIBIT_REST_BASE_URL,
  DERIVE_REST_BASE_URL,
  GATEIO_REST_BASE_URL,
  OKX_REST_BASE_URL,
  THALEX_REST_URL,
} from '../feeds/shared/endpoints.js';
import { loadCoincallCredentials, signCoincallRequest } from '../feeds/coincall/rest-client.js';
import { loadGateioCredentials, signGateioRequest } from '../feeds/gateio/rest-client.js';
import { feedLogger } from '../utils/logger.js';
import type {
  InstrumentCandle,
  InstrumentMarkPoint,
  InstrumentCandleInterval,
  InstrumentCandleRange,
  InstrumentCandlesResponse,
  VenueId,
} from '@oggregator/protocol';
import type { MarkHistoryBuffer } from './mark-history-buffer.js';

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

// Merge two RawCandle series by timestamp. Live-buffer rows win on tie so
// the latest in-progress bucket reflects the freshest WS print/quote;
// otherwise the bars are unioned and sorted ascending.
export function mergeCandlesByTs(historical: readonly RawCandle[], live: readonly RawCandle[]): RawCandle[] {
  const merged = new Map<number, RawCandle>();
  for (const c of historical) merged.set(c.ts, c);
  for (const c of live) merged.set(c.ts, c);
  return [...merged.values()].sort((a, b) => a.ts - b.ts);
}

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

// Gate.io publishes a sibling auth-gated endpoint for mark-price OHLC at
//   GET /api/v4/options/mark_price_candlesticks
// Same row shape as /options/candlesticks ({t,o,h,l,c,v}), but requires the
// standard v4 signing (KEY/SIGN/Timestamp). Missing credentials → buffer-only
// fallback at the caller (parallel to fetchCoincallKline).
export async function fetchGateioMark(
  symbol: string,
  interval: InstrumentCandleInterval,
  range: InstrumentCandleRange,
): Promise<RawCandle[]> {
  const credentials = loadGateioCredentials();
  if (credentials == null) return [];

  const now = Math.floor(Date.now() / 1000);
  const start = now - Math.floor(RANGE_TO_MS[range] / 1000);
  const path = '/api/v4/options/mark_price_candlesticks';
  const { url, headers } = signGateioRequest(
    'GET',
    path,
    {
      contract: symbol,
      interval: INTERVAL_TO_GATEIO[interval],
      from: start,
      to: now,
    },
    credentials,
  );

  const res = await fetch(`${GATEIO_REST_BASE_URL}${url}`, {
    method: 'GET',
    signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json', ...headers },
  });
  if (res.status === 404) throw new InstrumentCandlesError('not_found', `Gate.io: ${symbol}`);
  if (!res.ok) {
    log.warn({ symbol, status: res.status }, 'gateio mark candles http error');
    return [];
  }

  const result = GateioCandleSchema.safeParse(await res.json());
  if (!result.success) {
    log.warn({ issues: result.error.issues, symbol }, 'gateio mark candles parse failed');
    return [];
  }
  return result.data.map((row) => ({
    ts: row.t * 1000,
    o: Number(row.o),
    h: Number(row.h),
    l: Number(row.l),
    c: Number(row.c),
    // Mark series carries no volume; the trade-derived candles do.
    vol: 0,
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
// POST /public/get_tradingview_chart_data returns ClickHouse-backed OHLCV
// candles by instrument. Probe-verified contract (api.lyra.finance):
//   body: { instrument_name, start_timestamp, end_timestamp, period }
//   timestamps are Unix SECONDS (not ms — note the divergence from every
//     other Derive REST endpoint we call)
//   period is integer seconds; enum: 60, 300, 900, 1800, 3600, 14400, 86400
//   row shape: {
//     open_price, high_price, low_price, close_price, // strings
//     volume_usd, volume_contracts,                   // strings
//     timestamp, timestamp_bucket,                    // seconds
//   }
// Mark line still comes from the live MarkHistoryBuffer — Derive does not
// expose a REST mark-price-history endpoint.
const INTERVAL_TO_DERIVE_PERIOD: Record<InstrumentCandleInterval, number> = {
  '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400,
};

const DeriveChartDataSchema = z.object({
  result: z.array(
    z.object({
      open_price: z.string(),
      high_price: z.string(),
      low_price: z.string(),
      close_price: z.string(),
      volume_contracts: z.string(),
      volume_usd: z.string().optional(),
      timestamp: z.number(),
      timestamp_bucket: z.number().optional(),
    }),
  ),
});

export async function fetchDeriveTrade(
  symbol: string,
  interval: InstrumentCandleInterval,
  range: InstrumentCandleRange,
): Promise<RawCandle[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = nowSec - Math.floor(RANGE_TO_MS[range] / 1000);
  const res = await fetch(`${DERIVE_REST_BASE_URL}/public/get_tradingview_chart_data`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      instrument_name: symbol,
      start_timestamp: startSec,
      end_timestamp: nowSec,
      period: INTERVAL_TO_DERIVE_PERIOD[interval],
    }),
  });
  if (res.status === 404) throw new InstrumentCandlesError('not_found', `Derive: ${symbol}`);
  if (!res.ok) throw new InstrumentCandlesError('upstream', `Derive ${res.status}`);
  const parsed = DeriveChartDataSchema.safeParse(await res.json());
  if (!parsed.success) {
    log.warn({ symbol, issues: parsed.error.issues.slice(0, 3) }, 'derive chart parse failed');
    return [];
  }
  const candles: RawCandle[] = [];
  for (const row of parsed.data.result) {
    const ts = row.timestamp * 1000;
    const o = Number(row.open_price);
    const h = Number(row.high_price);
    const l = Number(row.low_price);
    const c = Number(row.close_price);
    const vol = Number(row.volume_contracts);
    if (!Number.isFinite(ts) || !Number.isFinite(o)) continue;
    candles.push({ ts, o, h, l, c, vol: Number.isFinite(vol) ? vol : 0 });
  }
  return candles.sort((a, b) => a.ts - b.ts);
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

// ── Coincall ───────────────────────────────────────────────────────
// Path: GET /open/option/market/kline/history/v1/{optionName}
// Signed (HMAC-SHA256 — see feeds/coincall/rest-client.ts). Required query
// params per Coincall docs:
//   period: m1 | m5 | m15 | m30 | h1 | h4 | d1 | w1 | mn1 | quarter
//   start:  start time in ms
//   end:    end time in ms
//   limit:  documented as "must be 1" — server still returns the full bar
//           series; we send 1 to match the docs verbatim.
// Response rows use { open, close, low, high, volume, time, period } with
// `time` in ms and numeric OHLCV. The schema below is intentionally lenient
// so the WS field naming (ts/t/o/h/l/c/v) parses too.
const INTERVAL_TO_COINCALL: Record<InstrumentCandleInterval, string> = {
  '1m': 'm1', '5m': 'm5', '15m': 'm15', '1h': 'h1', '4h': 'h4', '1d': 'd1',
};

// Lenient by design — the kline payload field names aren't fully nailed
// down in our docs. Accept the common variants; anything missing degrades
// the row, not the whole response.
const NumericLike = z.union([z.string(), z.number()]).transform((v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
});

const CoincallKlineEntrySchema = z.object({
  // Timestamp: `ts` (WS), `time`, or `t` are all plausible.
  ts: NumericLike.optional(),
  time: NumericLike.optional(),
  t: NumericLike.optional(),
  // OHLCV: short and long forms both seen across Coincall endpoints.
  open: NumericLike.optional(),
  o: NumericLike.optional(),
  high: NumericLike.optional(),
  h: NumericLike.optional(),
  low: NumericLike.optional(),
  l: NumericLike.optional(),
  close: NumericLike.optional(),
  c: NumericLike.optional(),
  volume: NumericLike.optional(),
  v: NumericLike.optional(),
}).passthrough();

const CoincallKlineResponseSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: z.array(CoincallKlineEntrySchema).nullable().optional(),
});

export async function fetchCoincallKline(
  symbol: string,
  interval: InstrumentCandleInterval,
  range: InstrumentCandleRange,
): Promise<RawCandle[]> {
  const credentials = loadCoincallCredentials();
  if (credentials == null) return [];

  const path = `/open/option/market/kline/history/v1/${symbol}`;
  const end = Date.now();
  const start = end - RANGE_TO_MS[range];
  const { url, headers } = signCoincallRequest(
    'GET',
    path,
    {
      end,
      limit: 1,
      period: INTERVAL_TO_COINCALL[interval],
      start,
    },
    credentials,
  );

  const res = await fetch(`${COINCALL_REST_BASE_URL}${url}`, {
    method: 'GET',
    signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json', ...headers },
  });
  if (res.status === 404) {
    throw new InstrumentCandlesError('not_found', `Coincall: ${symbol}`);
  }
  if (!res.ok) {
    log.warn({ symbol, status: res.status }, 'coincall kline http error');
    return [];
  }

  const parsed = CoincallKlineResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    log.warn({ symbol, issues: parsed.error.issues.slice(0, 3) }, 'coincall kline parse failed');
    return [];
  }
  if (parsed.data.code !== 0) {
    log.warn(
      { symbol, code: parsed.data.code, msg: parsed.data.msg },
      'coincall kline non-success code',
    );
    return [];
  }

  const rows = parsed.data.data ?? [];
  const candles: RawCandle[] = [];
  for (const r of rows) {
    const ts = r.ts ?? r.time ?? r.t;
    const o = r.open ?? r.o;
    const h = r.high ?? r.h;
    const l = r.low ?? r.l;
    const c = r.close ?? r.c;
    const vol = r.volume ?? r.v ?? 0;
    if (ts == null || o == null || h == null || l == null || c == null) continue;
    candles.push({ ts, o, h, l, c, vol: vol ?? 0 });
  }
  return candles.sort((a, b) => a.ts - b.ts);
}

// ── Venue capability map ──────────────────────────────────────────
// Wired venues: deribit, binance, okx, gateio, bybit, derive, thalex, coincall.
//
// Coincall reads chart data from its signed REST kline endpoint (see
// fetchCoincallKline above). The live MarkHistoryBuffer is layered on top
// to add intra-bucket freshness between REST calls. If credentials are
// missing or the endpoint returns nothing, we degrade to buffer-only.
//
// Gate.io's public `/options/candlesticks` is trade-derived and returns []
// for sparse altcoin strikes that never trade. The sibling
// `/options/mark_price_candlesticks` carries mark-price OHLC but is
// auth-gated (signed v4: KEY/SIGN/Timestamp); we sign it when credentials
// are configured and otherwise fall back to the MarkHistoryBuffer so untraded
// strikes still get a mark line.
//
// Deribit's get_mark_price_history is restricted to options that participate
// in volatility index calculations — every other strike (and all futures/
// perpetuals) returns []. The MarkHistoryBuffer overlay covers the gap so
// the chart still shows a live mark line for ordinary strikes the user has
// open in the chain.
const SUPPORTED_VENUES = new Set<VenueId>([
  'deribit', 'binance', 'okx', 'gateio', 'bybit', 'derive', 'thalex', 'coincall',
]);

const PRICE_CURRENCY: Record<string, string> = {
  deribit: 'BASE',    // BTC for BTC options, ETH for ETH options
  binance: 'USDT',
  okx: 'BASE',        // inverse — quoted in BTC/ETH
  gateio: 'USDT',
  bybit: 'USDT',
  derive: 'USDC',
  thalex: 'USD',
  coincall: 'USD',    // Coincall options are USD-quoted (e.g. BTCUSD-…)
};

function priceCurrencyFor(venue: VenueId, symbol: string): string {
  const base = PRICE_CURRENCY[venue] ?? 'USD';
  if (base !== 'BASE') return base;
  const head = symbol.split('-')[0] ?? symbol.split('_')[0] ?? '';
  return head || 'BASE';
}

// Venues whose REST "trade" endpoint fills non-trade buckets with
// mark-derived OHLC, making candle close ≈ venue mark per bucket. For
// these we synthesize markLine entries from candle closes whenever the
// real mark series is shorter than the candle series — gives the orange
// mark overlay continuous coverage instead of a 1-point live blip.
// Verified live behavior (2026-05-20):
//   - derive: get_tradingview_chart_data → vol=0 buckets are o=h=l=c=mark
//   - coincall: signed kline → vol=0 buckets carry intra-bar mark range
//   - binance: eapi/v1/klines → vol=0 buckets are o=h=l=c=mark (flat)
//   - deribit: get_tradingview_chart_data → vol=0 buckets are flat marks;
//             needed because Deribit's mark-history endpoint only covers
//             vol-index strikes and returns [] for every other contract.
// Excluded:
//   - okx / bybit / thalex: dedicated mark-history REST already returns
//     full coverage, so markLine.length >= candles.length naturally.
//   - gateio: public /options/candlesticks is trade-only and returns []
//     for untraded strikes — trade close ≠ mark. The signed
//     /mark_price_candlesticks endpoint (with creds) already fills the
//     mark series properly.
const TRADE_CLOSE_IS_MARK: ReadonlySet<VenueId> = new Set([
  'deribit', 'binance', 'derive', 'coincall',
]);

interface CacheEntry {
  fetchedAt: number;
  response: InstrumentCandlesResponse;
}

export interface InstrumentCandleServiceOptions {
  /**
   * Live rolling buffer used to serve mark history for venues whose REST API
   * does not expose a mark-price-history endpoint (Derive). When the buffer is
   * cold for a symbol, REST trade history is still used.
   */
  markHistoryBuffer?: MarkHistoryBuffer;
}

export class InstrumentCandleService {
  // Map preserves insertion order; we use that for FIFO eviction once the cap
  // is exceeded. Bound: ~5KB per entry × 500 keys = ~2.5MB ceiling.
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 30_000;
  private readonly cacheMaxEntries = 500;
  private ready = false;
  private readonly markHistoryBuffer: MarkHistoryBuffer | null;

  constructor(options: InstrumentCandleServiceOptions = {}) {
    this.markHistoryBuffer = options.markHistoryBuffer ?? null;
  }

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

    // For venues whose REST trade endpoint fills non-trade buckets with
    // mark-derived OHLC (see TRADE_CLOSE_IS_MARK above), synthesize
    // markLine entries from candle closes for any bucket the live
    // MarkHistoryBuffer didn't already cover. Buffer-derived marks
    // (sub-bucket fresh, e.g., the active 1m bar updating mid-bucket)
    // still win on collisions because they were added to markLine first
    // by mergeTradeAndMark — the loop only fills gaps, never overwrites.
    if (TRADE_CLOSE_IS_MARK.has(venue) && merged.markLine.length < merged.candles.length) {
      const haveMark = new Set<number>(merged.markLine.map((m) => m.ts));
      for (const c of merged.candles) {
        if (!haveMark.has(c.ts)) merged.markLine.push({ ts: c.ts, c: c.c });
      }
      merged.markLine.sort((a, b) => a.ts - b.ts);
    }

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
      case 'deribit': {
        const buffer = this.markHistoryBuffer;
        // get_mark_price_history is restricted by Deribit to options that
        // participate in volatility index calculations — all other strikes
        // (and every future/perpetual) come back as []. Overlay the live
        // MarkHistoryBuffer so the chart still has a mark line for ordinary
        // strikes; REST mark wins on overlap when the venue does provide it.
        const [tradeCandles, markCandles] = await Promise.all([
          fetchDeribitTrade(symbol, interval, range),
          fetchDeribitMark(symbol, interval, range),
        ]);
        const bufferedMark = buffer?.getMarkCandles(
          'deribit',
          symbol,
          INTERVAL_TO_MS[interval],
          RANGE_TO_MS[range],
        );
        const mark = mergeCandlesByTs(markCandles, bufferedMark ?? []);
        return [tradeCandles, mark];
      }
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
      case 'gateio': {
        const buffer = this.markHistoryBuffer;
        // /options/candlesticks is trade-derived — empty for untraded strikes.
        // /options/mark_price_candlesticks is the auth-gated sibling that
        // returns mark-price OHLC; we sign it when credentials are set and
        // overlay the live MarkHistoryBuffer for sub-bucket freshness. With
        // no credentials we degrade to buffer-only marks, keeping prior
        // behaviour for unconfigured deployments.
        const [tradeCandles, markCandles] = await Promise.all([
          fetchGateioTrade(symbol, interval, range),
          fetchGateioMark(symbol, interval, range).catch((err: unknown) => {
            if (err instanceof InstrumentCandlesError) throw err;
            log.warn({ symbol, err: String(err) }, 'gateio mark fetch error');
            return [] as RawCandle[];
          }),
        ]);
        const bufferedMark = buffer?.getMarkCandles(
          'gateio',
          symbol,
          INTERVAL_TO_MS[interval],
          RANGE_TO_MS[range],
        );
        // REST mark wins when present; live buffer fills the current bucket
        // (mergeCandlesByTs gives live the tie-break on overlap).
        const mark = mergeCandlesByTs(markCandles, bufferedMark ?? []);
        return [tradeCandles, mark];
      }
      case 'coincall': {
        const buffer = this.markHistoryBuffer;
        // REST kline carries OHLCV historical bars; the live buffer adds
        // sub-bucket freshness for the current candle (chain adapter feeds
        // mark via bsInfo `mp`, TradeRuntime feeds prints). When REST is
        // empty (auth missing, network error, untraded contract), fall back
        // to buffer alone.
        const restPromise = fetchCoincallKline(symbol, interval, range).catch((err: unknown) => {
          if (err instanceof InstrumentCandlesError) throw err;
          log.warn({ symbol, err: String(err) }, 'coincall kline fetch error');
          return [] as RawCandle[];
        });
        const bufferedTrades = buffer?.getTradeCandles(
          'coincall',
          symbol,
          INTERVAL_TO_MS[interval],
          RANGE_TO_MS[range],
        );
        const bufferedMark = buffer?.getMarkCandles(
          'coincall',
          symbol,
          INTERVAL_TO_MS[interval],
          RANGE_TO_MS[range],
        );
        const restCandles = await restPromise;
        // REST candles are trade-derived (OHLCV); buffered trades from the
        // live tape are additive and dedupe naturally via timestamp bucket.
        const trades = mergeCandlesByTs(restCandles, bufferedTrades ?? []);
        return [trades, bufferedMark ?? []];
      }
      case 'bybit':
        return Promise.all([
          fetchBybitTradeBucketed(symbol, interval, range),
          fetchBybitMark(symbol, interval, range),
        ]);
      case 'derive': {
        const buffer = this.markHistoryBuffer;
        // get_tradingview_chart_data gives ClickHouse-backed OHLCV history
        // in one call; the live MarkHistoryBuffer overlays sub-bucket
        // freshness so the active candle tracks the WS tape. Mark stays
        // buffer-only — Derive doesn't expose a REST mark-price-history
        // endpoint. REST failures degrade to buffer-only rather than 502.
        const restPromise = fetchDeriveTrade(symbol, interval, range).catch((err: unknown) => {
          if (err instanceof InstrumentCandlesError) throw err;
          log.warn({ symbol, err: String(err) }, 'derive chart fetch error');
          return [] as RawCandle[];
        });
        const bufferedTrades = buffer?.getTradeCandles(
          'derive',
          symbol,
          INTERVAL_TO_MS[interval],
          RANGE_TO_MS[range],
        );
        const bufferedMark = buffer?.getMarkCandles(
          'derive',
          symbol,
          INTERVAL_TO_MS[interval],
          RANGE_TO_MS[range],
        );
        const restCandles = await restPromise;
        const trades = mergeCandlesByTs(restCandles, bufferedTrades ?? []);
        return [trades, bufferedMark ?? []];
      }
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
