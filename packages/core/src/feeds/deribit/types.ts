import { z } from 'zod';

// markprice.options.{index_name} — array of objects
export const DeribitMarkPriceItemSchema = z.object({
  instrument_name: z.string(),
  mark_price: z.number(),
  iv: z.number(),
  timestamp: z.number().optional(),
});
export type DeribitMarkPriceItem = z.infer<typeof DeribitMarkPriceItemSchema>;

export const DeribitMarkPriceDataSchema = z.array(DeribitMarkPriceItemSchema);

// ticker.{instrument}.100ms — full ticker with greeks
export const DeribitTickerSchema = z.object({
  instrument_name: z.string(),
  best_bid_price: z.number().nullable(),
  best_ask_price: z.number().nullable(),
  mark_price: z.number().nullable(),
  last_price: z.number().nullable(),
  underlying_price: z.number().nullable().optional(),
  index_price: z.number().nullable().optional(),
  open_interest: z.number().nullable().optional(),
  mark_iv: z.number().nullable().optional(),
  bid_iv: z.number().nullable().optional(),
  ask_iv: z.number().nullable().optional(),
  best_bid_amount: z.number().nullable().optional(),
  best_ask_amount: z.number().nullable().optional(),
  timestamp: z.number().optional(),
  stats: z.object({
    volume: z.number().optional(),
  }).optional(),
  greeks: z.object({
    delta: z.number().nullable(),
    gamma: z.number().nullable(),
    theta: z.number().nullable(),
    vega: z.number().nullable(),
    rho: z.number().nullable(),
  }).optional(),
});
export type DeribitTicker = z.infer<typeof DeribitTickerSchema>;

// get_book_summary_by_currency response item
export const DeribitBookSummarySchema = z.object({
  instrument_name: z.string(),
  bid_price: z.number().nullable().optional(),
  ask_price: z.number().nullable().optional(),
  mark_price: z.number().nullable().optional(),
  last: z.number().nullable().optional(),
  underlying_price: z.number().nullable().optional(),
  volume: z.number().nullable().optional(),
  open_interest: z.number().nullable().optional(),
  mark_iv: z.number().nullable().optional(),
  creation_timestamp: z.number().optional(),
});
export type DeribitBookSummary = z.infer<typeof DeribitBookSummarySchema>;

// get_instruments response item
export const DeribitInstrumentSchema = z.object({
  instrument_name: z.string(),
  settlement_currency: z.string().optional(),
  instrument_type: z.string().optional(),
  contract_size: z.number().optional(),
  tick_size: z.number().optional(),
  min_trade_amount: z.number().optional(),
  maker_commission: z.number().optional(),
  taker_commission: z.number().optional(),
});
export type DeribitInstrument = z.infer<typeof DeribitInstrumentSchema>;
