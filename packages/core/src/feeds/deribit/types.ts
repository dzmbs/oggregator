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
  stats: z
    .object({
      volume: z.number().optional(),
    })
    .optional(),
  greeks: z
    .object({
      delta: z.number().nullable(),
      gamma: z.number().nullable(),
      theta: z.number().nullable(),
      vega: z.number().nullable(),
      rho: z.number().nullable(),
    })
    .optional(),
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
  volume_usd: z.number().nullable().optional(),
  open_interest: z.number().nullable().optional(),
  mark_iv: z.number().nullable().optional(),
  creation_timestamp: z.number().optional(),
});
export type DeribitBookSummary = z.infer<typeof DeribitBookSummarySchema>;

// deribit_price_index.{index_name} — live underlying/index price (~1s updates)
export const DeribitPriceIndexSchema = z.object({
  index_name: z.string(),
  price: z.number(),
  timestamp: z.number(),
});
export type DeribitPriceIndex = z.infer<typeof DeribitPriceIndexSchema>;

// get_instruments / get_instrument response item
export const DeribitInstrumentSchema = z.object({
  instrument_name: z.string(),
  settlement_currency: z.string().optional(),
  // quote_currency from the API: "BTC" for inverse BTC, "ETH" for inverse ETH,
  // "USDC" for all linear options. Never "USD".
  quote_currency: z.string().optional(),
  instrument_type: z.string().optional(),
  // strike and option_type come directly from the API — no need to regex-parse from name.
  strike: z.number().optional(),
  option_type: z.enum(['call', 'put']).optional(),
  // price_index maps this instrument to its Deribit index (e.g. "btc_usdc", "avax_usdc").
  price_index: z.string().optional(),
  contract_size: z.number().optional(),
  tick_size: z.number().optional(),
  min_trade_amount: z.number().optional(),
  maker_commission: z.number().optional(),
  taker_commission: z.number().optional(),
});
export type DeribitInstrument = z.infer<typeof DeribitInstrumentSchema>;

// instrument.state.option.any — lifecycle notifications for options
export const DeribitInstrumentStateSchema = z.object({
  instrument_name: z.string(),
  state: z.string(),
  timestamp: z.number().optional(),
});
export type DeribitInstrumentState = z.infer<typeof DeribitInstrumentStateSchema>;

// platform_state — maintenance and locked index notifications
export const DeribitPlatformStateSchema = z.object({
  price_index: z.string().optional(),
  locked: z.boolean().optional(),
  maintenance: z.boolean().optional(),
});
export type DeribitPlatformState = z.infer<typeof DeribitPlatformStateSchema>;

export const DeribitPublicStatusSchema = z.object({
  locked: z.union([z.boolean(), z.literal('true'), z.literal('partial'), z.literal('false')]),
  locked_indices: z.array(z.string()).optional(),
  locked_currencies: z.array(z.string()).optional(),
});
export type DeribitPublicStatus = z.infer<typeof DeribitPublicStatusSchema>;
