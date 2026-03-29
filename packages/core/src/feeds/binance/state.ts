import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import type {
  BinanceMarkPrice,
  BinanceOiEvent,
  BinanceRestTicker,
} from './types.js';

// Binance options don't expose per-instrument fees via public API
export const BINANCE_DEFAULT_MAKER_FEE = 0.0002;
export const BINANCE_DEFAULT_TAKER_FEE = 0.0005;

export function buildBinanceMarkPriceQuote(
  item: BinanceMarkPrice,
  previous: LiveQuote | undefined,
  positiveOrNull: (value: string | undefined) => number | null,
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  const bidPrice = positiveOrNull(item.bo);
  const askPrice = positiveOrNull(item.ao);
  const bidIv = positiveOrNull(item.b);
  const askIv = positiveOrNull(item.a);

  return {
    bidPrice,
    askPrice,
    bidSize: bidPrice != null ? safeNum(item.bq) : null,
    askSize: askPrice != null ? safeNum(item.aq) : null,
    markPrice: safeNum(item.mp),
    lastPrice: previous?.lastPrice ?? null,
    underlyingPrice: safeNum(item.i),
    indexPrice: safeNum(item.i),
    volume24h: previous?.volume24h ?? null,
    openInterest: previous?.openInterest ?? null,
    openInterestUsd: previous?.openInterestUsd ?? null,
    volume24hUsd: previous?.volume24hUsd ?? null,
    greeks: {
      delta: safeNum(item.d),
      gamma: safeNum(item.g),
      theta: safeNum(item.t),
      vega: safeNum(item.v),
      rho: null,
      markIv: safeNum(item.vo),
      bidIv,
      askIv,
    },
    timestamp: item.E ?? Date.now(),
  };
}

export function mergeBinanceOiEvent(
  previous: LiveQuote,
  item: BinanceOiEvent,
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  return {
    ...previous,
    openInterest: safeNum(item.o),
    openInterestUsd: safeNum(item.h),
    timestamp: Date.now(),
  };
}

export function mergeBinanceRestTicker(
  previous: LiveQuote,
  ticker: BinanceRestTicker,
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  return {
    ...previous,
    volume24h: ticker.volume != null ? safeNum(ticker.volume) : previous.volume24h,
    lastPrice: ticker.lastPrice != null ? safeNum(ticker.lastPrice) : previous.lastPrice,
    timestamp: Date.now(),
  };
}

export function mergeBinanceRestOpenInterest(
  previous: LiveQuote,
  item: { sumOpenInterest?: string; sumOpenInterestUsd?: string },
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  return {
    ...previous,
    openInterest: safeNum(item.sumOpenInterest),
    openInterestUsd: safeNum(item.sumOpenInterestUsd),
    timestamp: Date.now(),
  };
}

export function buildBinanceNewInstrument(
  item: {
    symbol: string;
    base: string;
    settle: string;
    expiry: string;
    strike: number;
    right: 'call' | 'put';
    unit: number | null;
  },
  buildCanonicalSymbol: (
    base: string,
    settle: string,
    expiry: string,
    strike: number,
    right: 'call' | 'put',
  ) => string,
): CachedInstrument {
  return {
    symbol: buildCanonicalSymbol(item.base, item.settle, item.expiry, item.strike, item.right),
    exchangeSymbol: item.symbol,
    base: item.base,
    quote: item.settle,
    settle: item.settle,
    expiry: item.expiry,
    strike: item.strike,
    right: item.right,
    inverse: false,
    contractSize: item.unit ?? 1,
    contractValueCurrency: item.base,
    tickSize: null,
    minQty: null,
    makerFee: BINANCE_DEFAULT_MAKER_FEE,
    takerFee: BINANCE_DEFAULT_TAKER_FEE,
  };
}

export function buildBinanceOiStreams(instruments: CachedInstrument[]): string[] {
  const seen = new Set<string>();
  const streams: string[] = [];

  for (const instrument of instruments) {
    const match = instrument.exchangeSymbol.match(/-(\d{6})-/);
    if (match == null) continue;

    const stream = `${instrument.base.toLowerCase()}${instrument.settle.toLowerCase()}@openInterest@${match[1]}`;
    if (seen.has(stream)) continue;
    seen.add(stream);
    streams.push(stream);
  }

  return streams;
}
