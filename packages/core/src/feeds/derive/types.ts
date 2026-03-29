import { z } from 'zod';

// Derive sends ALL numeric values as strings (except stats.n).
// We keep them as strings in the schema and coerce in the normalizer.
const numStr = z.string().nullable().optional();

// Derive abbreviated ticker format — values are STRINGS, not numbers.
// Verified against live WS + REST data 2026-03-20.
export const DeriveTickerSchema = z.object({
  B: numStr,                    // best_bid_amount (size)
  best_bid_amount: numStr,
  b: numStr,                    // best_bid_price
  best_bid_price: numStr,
  A: numStr,                    // best_ask_amount (size)
  best_ask_amount: numStr,
  a: numStr,                    // best_ask_price
  best_ask_price: numStr,
  M: numStr,                    // mark_price
  mark_price: numStr,
  I: numStr,                    // index_price
  index_price: numStr,
  f: numStr,                    // funding_rate (null for options)
  t: z.number().optional(),     // timestamp (this one IS a number — unix ms)
  timestamp: z.number().optional(),
  option_pricing: z.object({
    d: numStr,                  // delta
    delta: numStr,
    g: numStr,                  // gamma
    gamma: numStr,
    t: numStr,                  // theta
    theta: numStr,
    v: numStr,                  // vega
    vega: numStr,
    r: numStr,                  // rho
    rho: numStr,
    i: numStr,                  // iv
    iv: numStr,
    m: numStr,                  // mark price (option)
    mark: numStr,
    f: numStr,                  // forward_price
    df: numStr,                 // discount_factor
    bi: numStr,                 // bid_iv
    bid_iv: numStr,
    ai: numStr,                 // ask_iv
    ask_iv: numStr,
  }).nullable().optional(),
  stats: z.object({
    oi: numStr,                 // current open interest (contracts)
    v: numStr,                  // notional volume traded last 24h (USD)
    c: numStr,                  // contracts traded last 24h
    pr: numStr,                 // premium volume traded last 24h (USDC)
    n: z.number().optional(),   // number of trades last 24h (only non-string field)
    h: numStr,                  // highest trade price last 24h
    l: numStr,                  // lowest trade price last 24h
    p: numStr,                  // 24h percent change in premium
  }).nullable().optional(),
  minp: numStr,                 // min order price
  maxp: numStr,                 // max order price
  instrument_ticker: z.unknown().optional(), // WS notification wrapper
}).passthrough();
export type DeriveTicker = z.infer<typeof DeriveTickerSchema>;

// public/get_instruments response item
// Docs: result is a direct array of these objects
export const DeriveInstrumentSchema = z.object({
  instrument_name: z.string(),
  instrument_type: z.string(),
  is_active: z.boolean().optional(),
  quote_currency: z.string().optional(),
  option_details: z.object({
    expiry: z.number(),            // Unix seconds (NOT ms)
    index: z.string(),             // e.g. "BTC-USD"
    option_type: z.string(),       // "C" or "P"
    strike: z.string(),            // Strike as string
    settlement_price: z.string().nullable().optional(),
  }).optional(),
  tick_size: z.string().optional(),
  minimum_amount: z.string().optional(),
  maximum_amount: z.string().optional(),
  amount_step: z.string().optional(),
  maker_fee_rate: z.string().optional(),
  taker_fee_rate: z.string().optional(),
}).passthrough();
export type DeriveInstrument = z.infer<typeof DeriveInstrumentSchema>;

// public/get_instruments: result is a direct array, or { instruments: [...] } on some API versions
export const DeriveInstrumentsResponseSchema = z.union([
  z.array(DeriveInstrumentSchema),
  z.object({ instruments: z.array(DeriveInstrumentSchema) }).transform((r) => r.instruments),
]);

// public/get_tickers: { tickers: { [instrument_name]: ticker } }
export const DeriveTickersResponseSchema = z.object({
  tickers: z.record(z.string(), DeriveTickerSchema),
});
export type DeriveTickersResponse = z.infer<typeof DeriveTickersResponseSchema>;

export const DeriveHealthTimeSchema = z.number();

export const DeriveHealthIncidentsSchema = z.object({
  incidents: z.array(z.unknown()),
}).passthrough();
export type DeriveHealthIncidents = z.infer<typeof DeriveHealthIncidentsSchema>;
