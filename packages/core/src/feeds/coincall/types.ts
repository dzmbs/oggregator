import { z } from 'zod';

// ── REST: GET /time ────────────────────────────────────────────
// Envelope is { code, msg, i18nArgs, data }. ws-client.ts unwraps
// to `data`, so the schemas below model the unwrapped payload.

export const CoincallTimeSchema = z.object({
  serverTime: z.number(),
});
export type CoincallTime = z.infer<typeof CoincallTimeSchema>;

// ── REST: GET /open/option/getInstruments/{base} ───────────────
// Native symbol field is `symbolName` (not `symbol`). Expiry arrives
// as a unix ms timestamp in `expirationTimestamp`. baseCurrency is
// the bare asset ("BTC"), while optionConfig keys are pair names
// ("BTCUSD"). See state.ts for the join.

export const CoincallInstrumentSchema = z.object({
  baseCurrency: z.string(),
  startTimestamp: z.number(),
  expirationTimestamp: z.number(),
  strike: z.number(),
  symbolName: z.string(),
  isActive: z.boolean(),
  minQty: z.number(),
  tickSize: z.number(),
});
export type CoincallInstrument = z.infer<typeof CoincallInstrumentSchema>;

export const CoincallInstrumentsResponseSchema = z.array(CoincallInstrumentSchema);
export type CoincallInstrumentsResponse = z.infer<typeof CoincallInstrumentsResponseSchema>;

// ── REST: GET /open/public/config/v1 ───────────────────────────
// Config fields arrive as numbers or numeric strings depending on the
// asset (spotConfig has string fees on some pairs). optionConfig is
// numeric-only in observed captures, but z.union guards against future
// drift.

const NumericLike = z.union([z.number(), z.string().transform((s) => Number(s))]);

export const CoincallOptionConfigEntrySchema = z.object({
  symbol: z.string(),
  base: z.string(),
  settle: z.string(),
  takerFee: NumericLike,
  makerFee: NumericLike,
  multiplier: NumericLike.optional(),
  tickSize: NumericLike,
  priceDecimal: z.number(),
  qtyDecimal: z.number(),
  greeksDecimal: z.number().optional(),
  minQty: z.number().optional(),
  maxOrderNumber: z.number().optional(),
  maxPositionQty: z.number().optional(),
  marketMaxQty: z.number().optional(),
  limitMaxQty: z.number().optional(),
});
export type CoincallOptionConfigEntry = z.infer<typeof CoincallOptionConfigEntrySchema>;

export const CoincallPublicConfigSchema = z.object({
  optionConfig: z.record(z.string(), CoincallOptionConfigEntrySchema),
});
export type CoincallPublicConfig = z.infer<typeof CoincallPublicConfigSchema>;

// ── WS: bsInfo push (pricing info per instrument) ──────────────
// Fixture: references/options-docs/coincall/option_ws_en.md (## Pricing Information)
// Envelope: { dt: 3, c: 20, d: { ... fields below ... } }
// bsInfo does NOT include bid/ask — that lives in tOption.

// Coincall changed their API — numeric fields now arrive as strings.
// Same pattern as NumericLike in config.

export const CoincallBsInfoDataSchema = z.object({
  s: z.string(),
  mp: NumericLike.optional(),
  lp: NumericLike.optional(),
  ip: NumericLike.optional(),
  iv: NumericLike.optional(),
  delta: NumericLike.optional(),
  gamma: NumericLike.optional(),
  theta: NumericLike.optional(),
  vega: NumericLike.optional(),
  up: NumericLike.optional(),
  oi: NumericLike.optional(),
  v: NumericLike.optional(),
  v24: NumericLike.optional(),
  uv: NumericLike.optional(),
  uv24: NumericLike.optional(),
  h: NumericLike.optional(),
  l: NumericLike.optional(),
  cp: NumericLike.optional(),
  cr: NumericLike.optional(),
  pr0: NumericLike.optional(),
  rt: NumericLike.optional(),
  ts: NumericLike,
});
export type CoincallBsInfoData = z.infer<typeof CoincallBsInfoDataSchema>;

export const CoincallBsInfoMessageSchema = z.object({
  dt: z.literal(3),
  c: z.number(),
  d: CoincallBsInfoDataSchema,
});
export type CoincallBsInfoMessage = z.infer<typeof CoincallBsInfoMessageSchema>;

// ── WS: tOption push (option chain bid/ask for a whole expiry) ─
// Fixture: references/options-docs/coincall/option_ws_en.md (## Option Chain Data)
// Envelope: { dt: 4, c: 20, d: [ { ...per-contract snapshot... } ] }
// tOption provides bid/ask/biv/aiv/bs/as — no markIv.

export const CoincallTOptionEntrySchema = z.object({
  s: z.string(),
  mp: z.number().optional(),
  lp: z.number().optional(),
  bid: z.number().optional(),
  ask: z.number().optional(),
  bs: z.number().optional(),
  as: z.number().optional(),
  biv: z.number().optional(),
  aiv: z.number().optional(),
  delta: z.number().optional(),
  gamma: z.number().optional(),
  theta: z.number().optional(),
  vega: z.number().optional(),
  up: z.number().optional(),
  upv: z.number().optional(),
  oi: z.number().optional(),
  v: z.number().optional(),
  v24: z.number().optional(),
  cp: z.number().optional(),
  cr: z.number().optional(),
  ts: z.number(),
});
export type CoincallTOptionEntry = z.infer<typeof CoincallTOptionEntrySchema>;

export const CoincallTOptionMessageSchema = z.object({
  dt: z.literal(4),
  c: z.number(),
  d: z.array(CoincallTOptionEntrySchema),
});
export type CoincallTOptionMessage = z.infer<typeof CoincallTOptionMessageSchema>;

// ── WS: orderBook push (top-of-book per instrument) ─────────────
// Fixture: references/options-docs/coincall/option_ws_en.md (## OrderBook)
// Envelope: { dt: 5, c: 20, d: { s, asks, bids, ts } }

export const CoincallOrderBookLevelSchema = z.object({
  pr: z.coerce.number(),
  sz: z.coerce.number(),
});
export type CoincallOrderBookLevel = z.infer<typeof CoincallOrderBookLevelSchema>;

export const CoincallOrderBookDataSchema = z.object({
  s: z.string(),
  asks: z.array(CoincallOrderBookLevelSchema),
  bids: z.array(CoincallOrderBookLevelSchema),
  ts: z.number(),
});
export type CoincallOrderBookData = z.infer<typeof CoincallOrderBookDataSchema>;

export const CoincallOrderBookMessageSchema = z.object({
  dt: z.literal(5),
  c: z.number(),
  d: CoincallOrderBookDataSchema,
});
export type CoincallOrderBookMessage = z.infer<typeof CoincallOrderBookMessageSchema>;

// ── WS: heartbeat ack ──────────────────────────────────────────
// Fixture: option_ws_en.md (## HeartBeat) — response is { c: 11, rc: 1 }

export const CoincallHeartbeatAckSchema = z.object({
  c: z.literal(11),
  rc: z.number(),
});
export type CoincallHeartbeatAck = z.infer<typeof CoincallHeartbeatAckSchema>;

// ── Native symbol regex ────────────────────────────────────────
// Coincall options symbols: {base}USD-{DDMMMYY}-{strike}-{C|P}
// Examples: BTCUSD-14SEP23-22500-C, ETHUSD-27JUN25-3000-P
// Strike may be integer or decimal (small-cap assets).
export const COINCALL_OPTION_SYMBOL_RE =
  /^([A-Z]+)USD-(\d{1,2}[A-Z]{3}\d{2})-([\d.]+)-([CP])$/;
