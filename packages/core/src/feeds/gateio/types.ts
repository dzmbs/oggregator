import { z } from 'zod';

export const GATEIO_SYMBOL_REGEX =
  /^(?<base>[A-Z0-9]+)_(?<quote>USDT)-(?<date>\d{8})-(?<strike>\d+(?:\.\d+)?)-(?<right>[CP])$/;

export interface ParsedGateioSymbol {
  base: string;
  quote: 'USDT';
  expiry: string;
  strike: number;
  right: 'call' | 'put';
}

export function parseGateioSymbol(raw: string): ParsedGateioSymbol {
  const m = GATEIO_SYMBOL_REGEX.exec(raw);
  if (!m?.groups) throw new Error(`gateio: malformed symbol "${raw}"`);
  const date = m.groups.date!;
  return {
    base: m.groups.base!,
    quote: 'USDT',
    expiry: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
    strike: Number(m.groups.strike),
    right: m.groups.right === 'C' ? 'call' : 'put',
  };
}

const passthrough = z.object({}).passthrough();

export const GateioUnderlyingSchema = passthrough.extend({
  name: z.string(),
  index_price: z.string().optional(),
  index_time: z.number().optional(),
});
export type GateioUnderlying = z.infer<typeof GateioUnderlyingSchema>;
export const GateioUnderlyingsResponseSchema = GateioUnderlyingSchema.array();

export const GateioExpirationsResponseSchema = z.number().array();

export const GateioContractSchema = passthrough.extend({
  name: z.string(),
  tag: z.string().optional(),
  underlying: z.string(),
  is_call: z.boolean(),
  is_active: z.boolean().optional(),
  multiplier: z.string(),
  strike_price: z.string(),
  create_time: z.number().optional(),
  expiration_time: z.number(),
  underlying_price: z.string().optional(),
  last_price: z.string().optional(),
  mark_price: z.string().optional(),
  index_price: z.string().optional(),
  maker_fee_rate: z.string().optional(),
  taker_fee_rate: z.string().optional(),
  price_limit_fee_rate: z.string().optional(),
  order_price_round: z.string().optional(),
  mark_price_round: z.string().optional(),
  order_size_min: z.number().optional(),
  order_size_max: z.number().optional(),
  orderbook_id: z.number().optional(),
  trade_id: z.number().optional(),
  trade_size: z.number().optional(),
  position_size: z.number().optional(),
  ask1_price: z.string().optional(),
  ask1_size: z.number().optional(),
  bid1_price: z.string().optional(),
  bid1_size: z.number().optional(),
});
export type GateioContract = z.infer<typeof GateioContractSchema>;
export const GateioContractsResponseSchema = GateioContractSchema.array();

export const GateioTickerSchema = passthrough.extend({
  name: z.string(),
  last_price: z.string().optional(),
  mark_price: z.string().optional(),
  index_price: z.string().optional(),
  underlying_price: z.string().optional(),
  ask1_price: z.string().optional(),
  ask1_size: z.number().optional(),
  bid1_price: z.string().optional(),
  bid1_size: z.number().optional(),
  position_size: z.number().optional(),
  mark_iv: z.string().optional(),
  bid_iv: z.string().optional(),
  ask_iv: z.string().optional(),
  leverage: z.string().optional(),
  delta: z.string().optional(),
  gamma: z.string().optional(),
  vega: z.string().optional(),
  theta: z.string().optional(),
  rho: z.string().optional(),
  expiration_time: z.number().optional(),
});
export type GateioTicker = z.infer<typeof GateioTickerSchema>;
export const GateioTickersResponseSchema = GateioTickerSchema.array();

export const GateioUnderlyingTickerSchema = passthrough.extend({
  trade_put: z.number().optional(),
  trade_call: z.number().optional(),
  index_price: z.string().optional(),
});
export type GateioUnderlyingTicker = z.infer<typeof GateioUnderlyingTickerSchema>;

// Public endpoint: GET /api/v4/options/settlements?underlying={BASE}_USDT
// One row per contract; settle_price is the index spot at expiration moment
// and is identical across all contracts sharing the same underlying+expiry.
// See references/options-docs/gateio/rest-settlements.json.
export const GateioSettlementSchema = passthrough.extend({
  time: z.number(),
  contract: z.string(),
  strike_price: z.string().optional(),
  settle_price: z.string(),
});
export type GateioSettlement = z.infer<typeof GateioSettlementSchema>;
export const GateioSettlementsResponseSchema = GateioSettlementSchema.array();

const GateioOrderBookLevelSchema = z.object({ p: z.string(), s: z.number() });
export const GateioOrderBookSchema = passthrough.extend({
  id: z.number().optional(),
  current: z.number().optional(),
  update: z.number().optional(),
  asks: GateioOrderBookLevelSchema.array(),
  bids: GateioOrderBookLevelSchema.array(),
});
export type GateioOrderBook = z.infer<typeof GateioOrderBookSchema>;

export const GateioWsContractTickerSchema = GateioTickerSchema;

export const GateioWsTradeSchema = z.object({
  id: z.number(),
  create_time: z.number(),
  create_time_ms: z.number().optional(),
  contract: z.string(),
  size: z.number(),
  price: z.string(),
});
export type GateioWsTrade = z.infer<typeof GateioWsTradeSchema>;

export const GateioWsOrderBookUpdateSchema = passthrough.extend({
  t: z.number().optional(),
  s: z.string(),
  U: z.number().optional(),
  u: z.number().optional(),
  b: z.tuple([z.string(), z.number()]).array().optional(),
  a: z.tuple([z.string(), z.number()]).array().optional(),
});
export type GateioWsOrderBookUpdate = z.infer<typeof GateioWsOrderBookUpdateSchema>;

export const GateioWsUnderlyingTickerSchema = passthrough.extend({
  name: z.string(),
  index_price: z.string().optional(),
});
export type GateioWsUnderlyingTicker = z.infer<typeof GateioWsUnderlyingTickerSchema>;

export const GateioWsEnvelopeSchema = z.object({
  time: z.number().optional(),
  time_ms: z.number().optional(),
  id: z.number().optional(),
  channel: z.string(),
  event: z.enum(['subscribe', 'unsubscribe', 'update', 'all', 'pong']),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
export type GateioWsEnvelope = z.infer<typeof GateioWsEnvelopeSchema>;
