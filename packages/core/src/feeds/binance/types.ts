import { z } from 'zod';

// optionMarkPrice bulk WS item — confirmed field list 2026-03-28
export const BinanceMarkPriceSchema = z.object({
  e: z.literal('markPrice'),
  s: z.string(), // symbol
  mp: z.string(), // markPrice
  i: z.string().optional(), // indexPrice
  bo: z.string().optional(), // bestBid
  ao: z.string().optional(), // bestAsk
  bq: z.string().optional(), // bidQty
  aq: z.string().optional(), // askQty
  vo: z.string().optional(), // markIV (fraction, e.g. 0.41 = 41%)
  b: z.string().optional(), // bidIV — "-1.0" means no quote, handled by positiveOrNull
  a: z.string().optional(), // askIV — same
  d: z.string().optional(), // delta
  g: z.string().optional(), // gamma
  t: z.string().optional(), // theta
  v: z.string().optional(), // vega
  E: z.number().optional(), // eventTime
});
export type BinanceMarkPrice = z.infer<typeof BinanceMarkPriceSchema>;

// Combined stream wrapper: {"stream":"...","data":[...]}
export const BinanceCombinedStreamSchema = z.object({
  stream: z.string(),
  data: z.array(z.unknown()),
});
export type BinanceCombinedStream = z.infer<typeof BinanceCombinedStreamSchema>;

export const BinancePriceFilterSchema = z.object({
  filterType: z.string(),
  tickSize: z.string().optional(),
  minPrice: z.string().optional(),
  maxPrice: z.string().optional(),
});
export type BinancePriceFilter = z.infer<typeof BinancePriceFilterSchema>;

// GET /eapi/v1/exchangeInfo optionSymbols item
export const BinanceInstrumentSchema = z.object({
  symbol: z.string(),
  status: z.string().optional(),
  quoteAsset: z.string().optional(),
  unit: z.number().optional(),
  minQty: z.string().optional(),
  filters: z.array(BinancePriceFilterSchema).optional(),
  // Available directly — no need to parse from symbol name
  strikePrice: z.string().optional(),
  side: z.string().optional(), // "CALL" | "PUT"
  expiryDate: z.number().optional(), // ms timestamp
});
export type BinanceInstrument = z.infer<typeof BinanceInstrumentSchema>;

// !optionSymbol WS stream — new listing notification at 50ms
export const BinanceNewSymbolSchema = z.object({
  e: z.literal('optionSymbol'),
  s: z.string(), // symbol, e.g. "BTC-250926-140000-C"
  ps: z.string(), // underlying, e.g. "BTCUSDT"
  qa: z.string(), // quote asset, e.g. "USDT"
  d: z.string(), // direction: "CALL" | "PUT"
  sp: z.string(), // strike price
  dt: z.number(), // delivery timestamp (ms)
  u: z.number().optional(), // contract unit
  cs: z.string().optional(), // contract status
});
export type BinanceNewSymbol = z.infer<typeof BinanceNewSymbolSchema>;

// underlying@openInterest@YYMMDD WS stream — 60s update
export const BinanceOiEventSchema = z.object({
  e: z.literal('openInterest'),
  s: z.string(), // symbol
  o: z.string(), // open interest in contracts
  h: z.string(), // open interest in USDT
});
export type BinanceOiEvent = z.infer<typeof BinanceOiEventSchema>;

// GET /eapi/v1/ticker response item — confirmed fields 2026-03-28
export const BinanceRestTickerSchema = z.object({
  symbol: z.string(),
  lastPrice: z.string().optional(),
  volume: z.string().optional(),
});
export type BinanceRestTicker = z.infer<typeof BinanceRestTickerSchema>;

export const BinanceHealthTimeSchema = z.object({
  serverTime: z.number(),
});
export type BinanceHealthTime = z.infer<typeof BinanceHealthTimeSchema>;

export const BinanceHealthExchangeInfoSchema = z
  .object({
    optionSymbols: z.array(z.unknown()).optional(),
    symbols: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type BinanceHealthExchangeInfo = z.infer<typeof BinanceHealthExchangeInfoSchema>;
