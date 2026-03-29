import { z } from 'zod';

// ── REST: GET /v5/market/instruments-info?category=option ──────

export const BybitInstrumentSchema = z.object({
  symbol: z.string(),
  status: z.string(),
  baseCoin: z.string(),
  quoteCoin: z.string(),
  settleCoin: z.string(),
  optionsType: z.string(),
  launchTime: z.string(),
  deliveryTime: z.string(),
  deliveryFeeRate: z.string(),
  priceFilter: z.object({
    minPrice: z.string(),
    maxPrice: z.string(),
    tickSize: z.string(),
  }),
  lotSizeFilter: z.object({
    maxOrderQty: z.string(),
    minOrderQty: z.string(),
    qtyStep: z.string(),
  }),
});
export type BybitInstrument = z.infer<typeof BybitInstrumentSchema>;

export const BybitInstrumentsResponseSchema = z.object({
  retCode: z.number(),
  retMsg: z.string(),
  result: z.object({
    category: z.string(),
    list: z.array(BybitInstrumentSchema),
    nextPageCursor: z.string().optional(),
  }),
});
export type BybitInstrumentsResponse = z.infer<typeof BybitInstrumentsResponseSchema>;

// ── REST: GET /v5/market/tickers?category=option ───────────────
// Field names in REST differ from WS:
//   REST: bid1Price, ask1Price, bid1Iv, ask1Iv, markIv
//   WS:   bidPrice,  askPrice,  bidIv,  askIv,  markPriceIv

export const BybitRestTickerSchema = z.object({
  symbol: z.string(),
  bid1Price: z.string(),
  bid1Size: z.string(),
  bid1Iv: z.string(),
  ask1Price: z.string(),
  ask1Size: z.string(),
  ask1Iv: z.string(),
  lastPrice: z.string(),
  highPrice24h: z.string(),
  lowPrice24h: z.string(),
  markPrice: z.string(),
  indexPrice: z.string(),
  markIv: z.string(),
  underlyingPrice: z.string(),
  openInterest: z.string(),
  openInterestValue: z.string().optional(),
  turnover24h: z.string(),
  volume24h: z.string(),
  totalVolume: z.string(),
  totalTurnover: z.string(),
  delta: z.string(),
  gamma: z.string(),
  vega: z.string(),
  theta: z.string(),
  predictedDeliveryPrice: z.string(),
  change24h: z.string(),
});
export type BybitRestTicker = z.infer<typeof BybitRestTickerSchema>;

export const BybitTickersResponseSchema = z.object({
  retCode: z.number(),
  retMsg: z.string(),
  result: z.object({
    category: z.string(),
    list: z.array(BybitRestTickerSchema),
  }),
});
export type BybitTickersResponse = z.infer<typeof BybitTickersResponseSchema>;

// ── WS: tickers.{symbol} snapshot ──────────────────────────────
// Verified live 2026-03-19 — different field names from REST

export const BybitWsTickerSchema = z.object({
  symbol: z.string(),
  bidPrice: z.string(),
  bidSize: z.string(),
  bidIv: z.string(),
  askPrice: z.string(),
  askSize: z.string(),
  askIv: z.string(),
  lastPrice: z.string(),
  highPrice24h: z.string(),
  lowPrice24h: z.string(),
  markPrice: z.string(),
  indexPrice: z.string(),
  markPriceIv: z.string(),
  underlyingPrice: z.string(),
  openInterest: z.string(),
  openInterestValue: z.string().optional(),
  turnover24h: z.string(),
  volume24h: z.string(),
  totalVolume: z.string(),
  totalTurnover: z.string(),
  delta: z.string(),
  gamma: z.string(),
  vega: z.string(),
  theta: z.string(),
  predictedDeliveryPrice: z.string(),
  change24h: z.string(),
});
export type BybitWsTicker = z.infer<typeof BybitWsTickerSchema>;

export const BybitWsMessageSchema = z.object({
  topic: z.string(),
  ts: z.number(),
  type: z.string(),
  data: BybitWsTickerSchema,
});
export type BybitWsMessage = z.infer<typeof BybitWsMessageSchema>;

export const BybitSystemStatusItemSchema = z.object({
  state: z.string(),
  serviceTypes: z.array(z.number()).optional(),
  product: z.array(z.number()).optional(),
  maintainType: z.number().optional(),
  title: z.string().optional(),
});
export const BybitSystemStatusResponseSchema = z.object({
  retCode: z.number(),
  retMsg: z.string(),
  result: z.object({
    list: z.array(BybitSystemStatusItemSchema),
  }),
});
export type BybitSystemStatusResponse = z.infer<typeof BybitSystemStatusResponseSchema>;

// ── Symbol regex ───────────────────────────────────────────────
// Matches: BTC-25DEC26-67000-C-USDT (new) and BTC-28MAR26-60000-C (legacy)
// Strike can be decimal for low-price assets (DOGE: 0.07, XRP: 1.5)
export const BYBIT_OPTION_SYMBOL_RE = /^(\w+)-(\w+)-([\d.]+)-([CP])(?:-(\w+))?$/;
