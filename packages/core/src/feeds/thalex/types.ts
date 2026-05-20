import { z } from 'zod';

// ── REST: GET /public/instruments ────────────────────────────────
// Envelope is { result: Instrument[] }. ws-client unwraps to `result`, so
// the schemas below model the unwrapped payload.
//
// Source: https://thalex.com/docs/api.yaml#Instrument + live capture at
// references/options-docs/thalex/instrument-sample.json.

export const ThalexInstrumentSchema = z.object({
  instrument_name: z.string(),
  product: z.string().optional(),
  underlying: z.string(),
  type: z.string(),
  option_type: z.enum(['call', 'put']).optional(),
  expiry_date: z.string().optional(),
  expiration_timestamp: z.number().optional(),
  strike_price: z.number().optional(),
  tick_size: z.number().optional(),
  volume_tick_size: z.number().optional(),
  min_order_amount: z.number().optional(),
  base_currency: z.string().optional(),
  create_time: z.number().optional(),
});
export type ThalexInstrument = z.infer<typeof ThalexInstrumentSchema>;

export const ThalexInstrumentsResponseSchema = z.array(ThalexInstrumentSchema);
export type ThalexInstrumentsResponse = z.infer<typeof ThalexInstrumentsResponseSchema>;

// ── REST: GET /public/system_info ────────────────────────────────
// Envelope { result: { environment, api_version, banners, ... } }.
// Used only for health probes — the adapter does not need every field.

export const ThalexSystemInfoSchema = z.object({
  environment: z.string().optional(),
  api_version: z.string().optional(),
  banners: z.array(z.unknown()).optional(),
});
export type ThalexSystemInfo = z.infer<typeof ThalexSystemInfoSchema>;

// ── WS: ticker.<instrument>.<delay> notification ─────────────────
// Fixture: references/options-docs/thalex/ticker-pushes.json (live capture).
// Only `delta` + `iv` are exposed as greeks — gamma/theta/vega/bid_iv/ask_iv
// are never present, per both the OpenAPI spec and live probe.

export const ThalexTickerSchema = z.object({
  mark_price: z.number().nullable().optional(),
  mark_timestamp: z.number(),
  best_bid_price: z.number().nullable().optional(),
  best_bid_amount: z.number().nullable().optional(),
  best_ask_price: z.number().nullable().optional(),
  best_ask_amount: z.number().nullable().optional(),
  last_price: z.number().nullable().optional(),
  iv: z.number().nullable().optional(),
  delta: z.number().nullable().optional(),
  index: z.number().nullable().optional(),
  forward: z.number().nullable().optional(),
  volume_24h: z.number().nullable().optional(),
  value_24h: z.number().nullable().optional(),
  low_price_24h: z.number().nullable().optional(),
  high_price_24h: z.number().nullable().optional(),
  change_24h: z.number().nullable().optional(),
  collar_low: z.number().nullable().optional(),
  collar_high: z.number().nullable().optional(),
  open_interest: z.number().nullable().optional(),
});
export type ThalexTicker = z.infer<typeof ThalexTickerSchema>;

export const ThalexTickerNotificationSchema = z.object({
  channel_name: z.string(),
  notification: ThalexTickerSchema,
  snapshot: z.boolean().optional(),
});
export type ThalexTickerNotification = z.infer<typeof ThalexTickerNotificationSchema>;

// ── WS: price_index.<underlying> notification ────────────────────
// Fixture: references/options-docs/thalex/index-pushes.json.
// Used as a spot reference when ticker.index is absent (rare — ticker
// already carries `index`, but the channel is a useful fallback during
// quiet periods where no ticker fires for an underlying).

export const ThalexIndexSchema = z.object({
  index_name: z.string(),
  price: z.number(),
  timestamp: z.number(),
  previous_settlement_price: z.number().optional(),
  expiration_print_average: z.number().optional(),
  expiration_progress: z.number().optional(),
  expected_expiration_price: z.number().optional(),
});
export type ThalexIndex = z.infer<typeof ThalexIndexSchema>;

export const ThalexIndexNotificationSchema = z.object({
  channel_name: z.string(),
  notification: ThalexIndexSchema,
  snapshot: z.boolean().optional(),
});
export type ThalexIndexNotification = z.infer<typeof ThalexIndexNotificationSchema>;

// ── WS: RPC responses ────────────────────────────────────────────

export const ThalexSubscribeAckSchema = z.object({
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  result: z.array(z.string()),
});
export type ThalexSubscribeAck = z.infer<typeof ThalexSubscribeAckSchema>;

export const ThalexRpcErrorSchema = z.object({
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
  }),
});
export type ThalexRpcError = z.infer<typeof ThalexRpcErrorSchema>;

// ── Native symbol regex ──────────────────────────────────────────
// Thalex option symbols: {UNDERLYING}-{DDMMMYY}-{strike}-{C|P}
// Example: BTC-21APR26-75000-P. Unlike Coincall there is no USD suffix
// on the base; unlike Deribit (same shape) Thalex is always linear, so
// the inverse flag is NOT implied by settlement asset.
// Base capped at 4 chars so "BTCUSD-..." (Coincall style) is rejected.
export const THALEX_OPTION_SYMBOL_RE =
  /^([A-Z]{2,4})-(\d{1,2}[A-Z]{3}\d{2})-([\d.]+)-([CP])$/;
