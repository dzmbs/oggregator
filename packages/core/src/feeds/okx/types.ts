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
  // Available directly — no need to parse from instId string
  optType: z.string().optional(), // "C" | "P"
  stk: z.string().optional(), // strike price
  listTime: z.string().optional(),
  expTime: z.string().optional(), // ms timestamp
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

// ── REST/WS: tickers ───────────────────────────────────────────

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

// ── REST/WS: opt-summary (greeks + IV, no markPx) ─────────────

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

// ── REST/WS: mark-price ────────────────────────────────────────
// GET /api/v5/public/mark-price?instType=OPTION&instFamily=BTC-USD
// WS channel: { channel: 'mark-price', instId: '...' }
// Confirmed live: { instId, instType, markPx, ts } — no bulk WS variant.

export const OkxMarkPriceSchema = z.object({
  instType: z.string(),
  instId: z.string(),
  markPx: z.string(),
  ts: z.string(),
});
export type OkxMarkPrice = z.infer<typeof OkxMarkPriceSchema>;

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

export const OkxWsMarkPriceMsgSchema = z.object({
  arg: z.object({
    channel: z.literal('mark-price'),
    instId: z.string(),
  }),
  data: z.array(OkxMarkPriceSchema),
});
export type OkxWsMarkPriceMsg = z.infer<typeof OkxWsMarkPriceMsgSchema>;

export const OkxWsInstrumentsMsgSchema = z.object({
  arg: z.object({
    channel: z.literal('instruments'),
    instType: z.string(),
  }),
  action: z.string().optional(), // "snapshot" | "update"
  data: z.array(OkxInstrumentSchema),
});
export type OkxWsInstrumentsMsg = z.infer<typeof OkxWsInstrumentsMsgSchema>;

export const OkxWsNoticeSchema = z.object({
  event: z.literal('notice'),
  code: z.string().optional(),
  msg: z.string().optional(),
});
export type OkxWsNotice = z.infer<typeof OkxWsNoticeSchema>;

export const OkxWsStatusDataSchema = z.object({
  title: z.string().optional(),
  state: z.string(),
  begin: z.string().optional(),
  end: z.string().optional(),
  serviceType: z.string().optional(),
  maintType: z.string().optional(),
  env: z.string().optional(),
  ts: z.string().optional(),
});
export const OkxWsStatusMsgSchema = z.object({
  arg: z.object({
    channel: z.literal('status'),
  }),
  data: z.array(OkxWsStatusDataSchema),
});
export type OkxWsStatusMsg = z.infer<typeof OkxWsStatusMsgSchema>;

// ── Symbol regex ───────────────────────────────────────────────
// Matches: BTC-USD-260328-60000-C
// Still needed for base extraction — optType/stk cover right and strike.
export const OKX_OPTION_SYMBOL_RE = /^(\w+)-(\w+)-(\d{6})-(\d+)-([CP])$/;
