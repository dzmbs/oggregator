import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import type { GateioContract, GateioTicker } from './types.js';
import { parseGateioSymbol } from './types.js';

function num(raw: string | number | undefined | null): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function positiveOrNull(raw: number | undefined | null): number | null {
  if (raw == null) return null;
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

export function buildGateioInstrument(c: GateioContract): CachedInstrument {
  if (c.is_active === false) {
    throw new Error(`gateio: inactive contract ${c.name}`);
  }
  const parsed = parseGateioSymbol(c.name);
  const yy = parsed.expiry.slice(2, 4);
  const mm = parsed.expiry.slice(5, 7);
  const dd = parsed.expiry.slice(8, 10);
  const rc = parsed.right === 'call' ? 'C' : 'P';

  return {
    symbol: `${parsed.base}/USD:USDT-${yy}${mm}${dd}-${parsed.strike}-${rc}`,
    exchangeSymbol: c.name,
    base: parsed.base,
    quote: 'USDT',
    settle: 'USDT',
    expiry: parsed.expiry,
    expirationTimestamp: c.expiration_time * 1000,
    strike: parsed.strike,
    right: parsed.right,
    inverse: false,
    contractSize: num(c.multiplier),
    contractValueCurrency: parsed.base,
    tickSize: num(c.order_price_round ?? null),
    minQty: c.order_size_min ?? null,
    makerFee: num(c.maker_fee_rate),
    takerFee: num(c.taker_fee_rate),
  };
}

function applyTickerFields(prev: LiveQuote, t: GateioTicker, timestampMs: number): LiveQuote {
  return {
    ...prev,
    bidPrice: num(t.bid1_price) ?? prev.bidPrice,
    askPrice: num(t.ask1_price) ?? prev.askPrice,
    bidSize: positiveOrNull(t.bid1_size ?? null) ?? prev.bidSize,
    askSize: positiveOrNull(t.ask1_size ?? null) ?? prev.askSize,
    markPrice: num(t.mark_price) ?? prev.markPrice,
    lastPrice: num(t.last_price) ?? prev.lastPrice,
    underlyingPrice: num(t.underlying_price) ?? prev.underlyingPrice,
    indexPrice: num(t.index_price) ?? prev.indexPrice,
    openInterest: positiveOrNull(t.position_size ?? null) ?? prev.openInterest,
    greeks: {
      ...prev.greeks,
      markIv: num(t.mark_iv) ?? prev.greeks.markIv,
      bidIv: num(t.bid_iv) ?? prev.greeks.bidIv,
      askIv: num(t.ask_iv) ?? prev.greeks.askIv,
      delta: num(t.delta) ?? prev.greeks.delta,
      gamma: num(t.gamma) ?? prev.greeks.gamma,
      vega: num(t.vega) ?? prev.greeks.vega,
      theta: num(t.theta) ?? prev.greeks.theta,
      rho: num(t.rho) ?? prev.greeks.rho,
    },
    timestamp: timestampMs > 0 ? timestampMs : prev.timestamp,
  };
}

export function mergeGateioRestTicker(
  prev: LiveQuote,
  ticker: GateioTicker,
  timestampMs: number,
): LiveQuote {
  return applyTickerFields(prev, ticker, timestampMs);
}

export function mergeGateioWsContractTicker(
  prev: LiveQuote,
  ticker: GateioTicker,
  timestampMs: number,
): LiveQuote {
  return applyTickerFields(prev, ticker, timestampMs);
}

export function mergeGateioTrade(
  prev: LiveQuote,
  trade: { price: string; timestampMs: number },
): LiveQuote {
  const lastPrice = num(trade.price);
  return {
    ...prev,
    lastPrice: lastPrice ?? prev.lastPrice,
    timestamp: trade.timestampMs > 0 ? trade.timestampMs : prev.timestamp,
  };
}

export function mergeGateioUnderlyingTicker(
  prev: LiveQuote,
  indexPriceStr: string | undefined | null,
  timestampMs: number,
): LiveQuote {
  const price = num(indexPriceStr ?? null);
  if (price == null) return prev;
  return {
    ...prev,
    indexPrice: price,
    underlyingPrice: price,
    timestamp: timestampMs > 0 ? timestampMs : prev.timestamp,
  };
}
