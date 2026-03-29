import { EMPTY_GREEKS, type OptionGreeks } from '../../core/types.js';
import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import type { OkxMarkPrice, OkxOptSummary, OkxTicker } from './types.js';

// OKX contract sizes are usually provided by the API; this fallback covers
// edge cases where the instrument cache hasn't received the full spec yet.
const DEFAULT_CONTRACT_SIZE = 0.01;

export function buildOkxGreeks(
  item: OkxOptSummary,
  safeNum: (value: unknown) => number | null,
): OptionGreeks {
  return {
    delta: safeNum(item.deltaBS) ?? safeNum(item.delta),
    gamma: safeNum(item.gammaBS) ?? safeNum(item.gamma),
    theta: safeNum(item.thetaBS) ?? safeNum(item.theta),
    vega: safeNum(item.vegaBS) ?? safeNum(item.vega),
    rho: null,
    markIv: safeNum(item.markVol),
    bidIv: safeNum(item.bidVol),
    askIv: safeNum(item.askVol),
  };
}

export function buildOkxTickerQuote(
  ticker: OkxTicker,
  contractSize: number | null,
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  const ctSize = contractSize ?? DEFAULT_CONTRACT_SIZE;
  const volContracts = safeNum(ticker.vol24h);
  const volBase = volContracts != null ? volContracts * ctSize : null;

  return {
    bidPrice: safeNum(ticker.bidPx),
    askPrice: safeNum(ticker.askPx),
    bidSize: safeNum(ticker.bidSz),
    askSize: safeNum(ticker.askSz),
    markPrice: null,
    lastPrice: safeNum(ticker.last),
    underlyingPrice: null,
    indexPrice: null,
    volume24h: volBase,
    openInterest: null,
    openInterestUsd: null,
    volume24hUsd: null,
    greeks: { ...EMPTY_GREEKS },
    timestamp: Number(ticker.ts) || Date.now(),
  };
}

export function mergeOkxOptSummary(
  previous: LiveQuote | undefined,
  item: OkxOptSummary,
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  if (previous != null) {
    return {
      ...previous,
      underlyingPrice: safeNum(item.fwdPx) ?? previous.underlyingPrice,
      greeks: buildOkxGreeks(item, safeNum),
      timestamp: Number(item.ts) || previous.timestamp,
    };
  }

  return {
    bidPrice: null,
    askPrice: null,
    bidSize: null,
    askSize: null,
    markPrice: null,
    lastPrice: null,
    underlyingPrice: safeNum(item.fwdPx),
    indexPrice: null,
    volume24h: null,
    openInterest: null,
    openInterestUsd: null,
    volume24hUsd: null,
    greeks: buildOkxGreeks(item, safeNum),
    timestamp: Number(item.ts) || Date.now(),
  };
}

export function mergeOkxWsTicker(
  previous: LiveQuote | undefined,
  ticker: OkxTicker,
  instrument: CachedInstrument,
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  const ctSize = instrument.contractSize ?? DEFAULT_CONTRACT_SIZE;
  const volContracts = safeNum(ticker.vol24h);
  const volBase = volContracts != null ? volContracts * ctSize : previous?.volume24h ?? null;
  const underlying = previous?.underlyingPrice ?? null;
  const volUsd = volBase != null && underlying != null ? volBase * underlying : previous?.volume24hUsd ?? null;

  return {
    bidPrice: safeNum(ticker.bidPx),
    askPrice: safeNum(ticker.askPx),
    bidSize: safeNum(ticker.bidSz),
    askSize: safeNum(ticker.askSz),
    markPrice: previous?.markPrice ?? null,
    lastPrice: safeNum(ticker.last),
    underlyingPrice: previous?.underlyingPrice ?? null,
    indexPrice: null,
    volume24h: volBase,
    openInterest: previous?.openInterest ?? null,
    openInterestUsd: previous?.openInterestUsd ?? null,
    volume24hUsd: volUsd,
    greeks: previous?.greeks ?? { ...EMPTY_GREEKS },
    timestamp: Number(ticker.ts) || Date.now(),
  };
}

export function mergeOkxMarkPrice(
  previous: LiveQuote,
  item: OkxMarkPrice,
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  return {
    ...previous,
    markPrice: safeNum(item.markPx),
    timestamp: Number(item.ts) || Date.now(),
  };
}

export function mergeOkxRestOpenInterest(
  previous: LiveQuote,
  item: { oi?: string; oiCcy?: string; oiUsd?: string },
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  return {
    ...previous,
    // Normalize to contract count. oiCcy already applies ctMult for inverse options,
    // so storing it here would double-scale downstream analytics like GEX.
    openInterest: safeNum(item.oi),
    // OKX option oiUsd is a face/count-style USD field, not market notional.
    // Leave it null and derive USD OI from contract metadata + underlying price.
    openInterestUsd: null,
    timestamp: Date.now(),
  };
}

export function mergeOkxRestMarkPrice(
  previous: LiveQuote,
  item: OkxMarkPrice,
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  return {
    ...previous,
    markPrice: safeNum(item.markPx),
    timestamp: Number(item.ts) || Date.now(),
  };
}
