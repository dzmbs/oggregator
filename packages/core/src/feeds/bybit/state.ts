import type { LiveQuote } from '../shared/sdk-base.js';
import type { BybitRestTicker, BybitWsTicker } from './types.js';

export function buildBybitRestQuote(
  ticker: BybitRestTicker,
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  return {
    bidPrice: safeNum(ticker.bid1Price),
    askPrice: safeNum(ticker.ask1Price),
    bidSize: safeNum(ticker.bid1Size),
    askSize: safeNum(ticker.ask1Size),
    markPrice: safeNum(ticker.markPrice),
    lastPrice: safeNum(ticker.lastPrice),
    underlyingPrice: safeNum(ticker.underlyingPrice),
    indexPrice: safeNum(ticker.indexPrice),
    volume24h: safeNum(ticker.volume24h),
    openInterest: safeNum(ticker.openInterest),
    openInterestUsd: safeNum(ticker.openInterestValue),
    volume24hUsd: safeNum(ticker.turnover24h),
    greeks: {
      delta: safeNum(ticker.delta),
      gamma: safeNum(ticker.gamma),
      theta: safeNum(ticker.theta),
      vega: safeNum(ticker.vega),
      rho: null,
      markIv: safeNum(ticker.markIv),
      bidIv: safeNum(ticker.bid1Iv),
      askIv: safeNum(ticker.ask1Iv),
    },
    timestamp: Date.now(),
  };
}

export function buildBybitWsQuote(
  ticker: BybitWsTicker,
  envelopeTs: number,
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  return {
    bidPrice: safeNum(ticker.bidPrice),
    askPrice: safeNum(ticker.askPrice),
    bidSize: safeNum(ticker.bidSize),
    askSize: safeNum(ticker.askSize),
    markPrice: safeNum(ticker.markPrice),
    lastPrice: safeNum(ticker.lastPrice),
    underlyingPrice: safeNum(ticker.underlyingPrice),
    indexPrice: safeNum(ticker.indexPrice),
    volume24h: safeNum(ticker.volume24h),
    openInterest: safeNum(ticker.openInterest),
    openInterestUsd: safeNum(ticker.openInterestValue),
    volume24hUsd: safeNum(ticker.turnover24h),
    greeks: {
      delta: safeNum(ticker.delta),
      gamma: safeNum(ticker.gamma),
      theta: safeNum(ticker.theta),
      vega: safeNum(ticker.vega),
      rho: null,
      markIv: safeNum(ticker.markPriceIv),
      bidIv: safeNum(ticker.bidIv),
      askIv: safeNum(ticker.askIv),
    },
    timestamp: envelopeTs,
  };
}
