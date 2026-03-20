import { z } from 'zod';

// ── REST: GET /api/v5/public/instruments?instType=OPTION ───────

export const OkxInstrumentSchema = z.object({
  instId: z.string(),
  instType: z.string(),
  uly: z.string().optional(),
  instFamily: z.string().optional(),
  settleCcy: z.string().optional(),
  ctVal: z.string().optional(),
  ctMult: z.string().optional(),
  ctValCcy: z.string().optional(),
  optType: z.string().optional(),
  stk: z.string().optional(),
  listTime: z.string().optional(),
  expTime: z.string().optional(),
  tickSz: z.string().optional(),
  lotSz: z.string().optional(),
  minSz: z.string().optional(),
  state: z.string().optional(),
});
export type OkxInstrument = z.infer<typeof OkxInstrumentSchema>;

export const OkxRestResponseSchema = z.object({
  code: z.string(),
  msg: z.string(),
  data: z.array(z.unknown()),
});
export type OkxRestResponse = z.infer<typeof OkxRestResponseSchema>;

// ── REST: GET /api/v5/market/tickers?instType=OPTION ───────────
// Per-instrument bid/ask/last/volume

export const OkxTickerSchema = z.object({
  instType: z.string(),
  instId: z.string(),
  last: z.string(),
  lastSz: z.string(),
  askPx: z.string(),
  askSz: z.string(),
  bidPx: z.string(),
  bidSz: z.string(),
  open24h: z.string(),
  high24h: z.string(),
  low24h: z.string(),
  volCcy24h: z.string(),
  vol24h: z.string(),
  ts: z.string(),
  sodUtc0: z.string(),
  sodUtc8: z.string(),
});
export type OkxTicker = z.infer<typeof OkxTickerSchema>;

// ── REST/WS: opt-summary (greeks for all options) ──────────────
// Fields are the same for REST GET /api/v5/public/opt-summary
// and WS channel "opt-summary"

export const OkxOptSummarySchema = z.object({
  instType: z.string(),
  instId: z.string(),
  uly: z.string().optional(),
  delta: z.string().optional(),
  deltaBS: z.string().optional(),
  gamma: z.string().optional(),
  gammaBS: z.string().optional(),
  theta: z.string().optional(),
  thetaBS: z.string().optional(),
  vega: z.string().optional(),
  vegaBS: z.string().optional(),
  lever: z.string().optional(),
  markVol: z.string().optional(),
  bidVol: z.string().optional(),
  askVol: z.string().optional(),
  realVol: z.string().optional(),
  volLv: z.string().optional(),
  fwdPx: z.string().optional(),
  ts: z.string(),
});
export type OkxOptSummary = z.infer<typeof OkxOptSummarySchema>;

// ── WS message wrappers ────────────────────────────────────────

export const OkxWsOptSummaryMsgSchema = z.object({
  arg: z.object({
    channel: z.literal('opt-summary'),
    instFamily: z.string(),
  }),
  data: z.array(OkxOptSummarySchema),
});
export type OkxWsOptSummaryMsg = z.infer<typeof OkxWsOptSummaryMsgSchema>;

export const OkxWsTickerMsgSchema = z.object({
  arg: z.object({
    channel: z.literal('tickers'),
    instId: z.string(),
  }),
  data: z.array(OkxTickerSchema),
});
export type OkxWsTickerMsg = z.infer<typeof OkxWsTickerMsgSchema>;

// ── Symbol regex ───────────────────────────────────────────────
// Matches: BTC-USD-260328-60000-C
export const OKX_OPTION_SYMBOL_RE = /^(\w+)-(\w+)-(\d{6})-(\d+)-([CP])$/;
