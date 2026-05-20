import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import type { OptionRight } from '../../types/common.js';
import {
  COINCALL_OPTION_SYMBOL_RE,
  type CoincallBsInfoData,
  type CoincallInstrument,
  type CoincallOrderBookData,
  type CoincallOptionConfigEntry,
  type CoincallTOptionEntry,
} from './types.js';

function mergeNumber(next: number | undefined | null, previous: number | null): number | null {
  return next ?? previous;
}

function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function blackScholesPrice(
  right: OptionRight,
  spot: number,
  strike: number,
  timeToExpiryYears: number,
  volatility: number,
): number {
  const intrinsic = right === 'call' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  if (timeToExpiryYears <= 0 || volatility <= 0) return intrinsic;

  const sqrtT = Math.sqrt(timeToExpiryYears);
  const sigmaSqrtT = volatility * sqrtT;
  const d1 =
    (Math.log(spot / strike) + 0.5 * volatility * volatility * timeToExpiryYears) / sigmaSqrtT;
  const d2 = d1 - sigmaSqrtT;
  const nd1 = normalCdf(d1);
  const nd2 = normalCdf(d2);

  if (right === 'call') return spot * nd1 - strike * nd2;
  return strike * normalCdf(-d2) - spot * normalCdf(-d1);
}

function getExpirationTimestamp(inst: CachedInstrument): number | null {
  if (typeof inst.expirationTimestamp === 'number' && Number.isFinite(inst.expirationTimestamp)) {
    return inst.expirationTimestamp;
  }

  const fallback = Date.parse(`${inst.expiry}T23:59:59.999Z`);
  return Number.isFinite(fallback) ? fallback : null;
}

function inferSideIvFromPrice(
  premium: number | null,
  inst: CachedInstrument,
  underlyingPrice: number | null,
  nowMs: number,
): number | null {
  if (premium == null || premium <= 0) return null;
  if (underlyingPrice == null || underlyingPrice <= 0) return null;
  if (!Number.isFinite(inst.strike) || inst.strike <= 0) return null;

  const expirationTimestamp = getExpirationTimestamp(inst);
  if (expirationTimestamp == null) return null;

  const timeToExpiryYears = (expirationTimestamp - nowMs) / (365 * 24 * 60 * 60 * 1000);
  if (timeToExpiryYears <= 0) return null;

  const intrinsic =
    inst.right === 'call'
      ? Math.max(0, underlyingPrice - inst.strike)
      : Math.max(0, inst.strike - underlyingPrice);
  const maxPremium = inst.right === 'call' ? underlyingPrice : inst.strike;

  if (premium > maxPremium + 1e-6) return null;

  const target = Math.max(premium, intrinsic + 1e-6);
  let low = 1e-6;
  let high = 5;
  let highPrice = blackScholesPrice(inst.right, underlyingPrice, inst.strike, timeToExpiryYears, high);

  while (highPrice < target && high < 32) {
    high *= 2;
    highPrice = blackScholesPrice(inst.right, underlyingPrice, inst.strike, timeToExpiryYears, high);
  }

  if (highPrice < target) return null;

  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    const price = blackScholesPrice(inst.right, underlyingPrice, inst.strike, timeToExpiryYears, mid);
    if (Math.abs(price - target) <= 1e-6) return mid;
    if (price > target) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return (low + high) / 2;
}

function fillMissingCoincallSideIvs(inst: CachedInstrument, quote: LiveQuote): LiveQuote {
  const infer = (current: number | null, premium: number | null): number | null => {
    if (current != null) return current;

    const inferred = inferSideIvFromPrice(premium, inst, quote.underlyingPrice, quote.timestamp);
    if (inferred != null) return inferred;

    return premium != null && premium > 0 ? quote.greeks.markIv : null;
  };

  return {
    ...quote,
    greeks: {
      ...quote.greeks,
      bidIv: infer(quote.greeks.bidIv, quote.bidPrice),
      askIv: infer(quote.greeks.askIv, quote.askPrice),
    },
  };
}

/**
 * bsInfo delivers markPrice / iv / greeks / oi / underlyingPrice.
 * No bid/ask fields — those come from tOption (see mergeCoincallTOption).
 */
export function mergeCoincallBsInfo(
  data: CoincallBsInfoData,
  inst: CachedInstrument,
  previous: LiveQuote | undefined,
  empty: LiveQuote,
): LiveQuote {
  const base = previous ?? empty;
  return fillMissingCoincallSideIvs(inst, {
    bidPrice: base.bidPrice,
    askPrice: base.askPrice,
    bidSize: base.bidSize,
    askSize: base.askSize,
    markPrice: mergeNumber(data.mp, base.markPrice),
    lastPrice: mergeNumber(data.lp, base.lastPrice),
    underlyingPrice: mergeNumber(data.up, base.underlyingPrice),
    indexPrice: mergeNumber(data.ip, base.indexPrice),
    volume24h: mergeNumber(data.v24, base.volume24h),
    openInterest: mergeNumber(data.oi, base.openInterest),
    openInterestUsd: base.openInterestUsd,
    volume24hUsd: mergeNumber(data.uv24, base.volume24hUsd),
    greeks: {
      delta: mergeNumber(data.delta, base.greeks.delta),
      gamma: mergeNumber(data.gamma, base.greeks.gamma),
      theta: mergeNumber(data.theta, base.greeks.theta),
      vega: mergeNumber(data.vega, base.greeks.vega),
      rho: base.greeks.rho,
      markIv: mergeNumber(data.iv, base.greeks.markIv),
      bidIv: base.greeks.bidIv,
      askIv: base.greeks.askIv,
    },
    timestamp: data.ts,
  });
}

/**
 * tOption delivers per-contract bid/ask/bs/as/biv/aiv plus greeks.
 * Overlays previous quote so markIv (set by bsInfo) survives.
 */
export function mergeCoincallTOption(
  entry: CoincallTOptionEntry,
  inst: CachedInstrument,
  previous: LiveQuote | undefined,
  empty: LiveQuote,
): LiveQuote {
  const base = previous ?? empty;
  return fillMissingCoincallSideIvs(inst, {
    bidPrice: mergeNumber(entry.bid, base.bidPrice),
    askPrice: mergeNumber(entry.ask, base.askPrice),
    bidSize: mergeNumber(entry.bs, base.bidSize),
    askSize: mergeNumber(entry.as, base.askSize),
    markPrice: mergeNumber(entry.mp, base.markPrice),
    lastPrice: mergeNumber(entry.lp, base.lastPrice),
    underlyingPrice: mergeNumber(entry.up, base.underlyingPrice),
    indexPrice: base.indexPrice,
    volume24h: mergeNumber(entry.v24, base.volume24h),
    openInterest: mergeNumber(entry.oi, base.openInterest),
    openInterestUsd: base.openInterestUsd,
    volume24hUsd: base.volume24hUsd,
    greeks: {
      delta: mergeNumber(entry.delta, base.greeks.delta),
      gamma: mergeNumber(entry.gamma, base.greeks.gamma),
      theta: mergeNumber(entry.theta, base.greeks.theta),
      vega: mergeNumber(entry.vega, base.greeks.vega),
      rho: base.greeks.rho,
      markIv: base.greeks.markIv,
      bidIv: entry.biv ?? (entry.bid != null ? null : base.greeks.bidIv),
      askIv: entry.aiv ?? (entry.ask != null ? null : base.greeks.askIv),
    },
    timestamp: entry.ts,
  });
}

export function mergeCoincallOrderBook(
  data: CoincallOrderBookData,
  inst: CachedInstrument,
  previous: LiveQuote | undefined,
  empty: LiveQuote,
): LiveQuote {
  const base = previous ?? empty;
  const bestBid = data.bids[0] ?? null;
  const bestAsk = data.asks[0] ?? null;

  return fillMissingCoincallSideIvs(inst, {
    bidPrice: bestBid?.pr ?? null,
    askPrice: bestAsk?.pr ?? null,
    bidSize: bestBid?.sz ?? null,
    askSize: bestAsk?.sz ?? null,
    markPrice: base.markPrice,
    lastPrice: base.lastPrice,
    underlyingPrice: base.underlyingPrice,
    indexPrice: base.indexPrice,
    volume24h: base.volume24h,
    openInterest: base.openInterest,
    openInterestUsd: base.openInterestUsd,
    volume24hUsd: base.volume24hUsd,
    greeks: {
      ...base.greeks,
      bidIv: null,
      askIv: null,
    },
    timestamp: data.ts,
  });
}

export interface CoincallInstrumentDeps {
  buildCanonicalSymbol: (
    base: string,
    settle: string,
    expiry: string,
    strike: number,
    right: OptionRight,
  ) => string;
  parseExpiry: (raw: string) => string;
}

export function buildCoincallInstrument(
  item: CoincallInstrument,
  optionConfig: Record<string, CoincallOptionConfigEntry>,
  deps: CoincallInstrumentDeps,
): CachedInstrument | null {
  if (!item.isActive) return null;

  const match = COINCALL_OPTION_SYMBOL_RE.exec(item.symbolName);
  if (!match) return null;

  const base = match[1]!;
  const expiryToken = match[2]!;
  const strike = Number(match[3]!);
  const right: OptionRight = match[4] === 'C' ? 'call' : 'put';
  if (!Number.isFinite(strike)) return null;

  // Coincall gives two sources of truth for expiry: the DDMMMYY token in the
  // native symbol and `expirationTimestamp` (ms). Prefer the symbol token
  // because that's how the venue keys every downstream subscription;
  // timestamp is a fallback when the token isn't parseable (shouldn't happen
  // given the regex guard).
  const expiry = deps.parseExpiry(expiryToken);

  // optionConfig is keyed by pair (BTCUSD), not by base (BTC).
  const cfg = optionConfig[`${base}USD`] ?? null;
  const settle = cfg?.settle ?? 'USD';
  const multiplier = cfg?.multiplier ?? 1;
  const canonical = deps.buildCanonicalSymbol(base, settle, expiry, strike, right);

  return {
    symbol: canonical,
    exchangeSymbol: item.symbolName,
    base,
    quote: 'USD',
    settle,
    expiry,
    expirationTimestamp: item.expirationTimestamp,
    strike,
    right,
    inverse: false,
    contractSize: multiplier,
    // Coincall's `multiplier` is BTC-per-contract (0.01 for BTC, 0.1 for ETH),
    // not USD. Marking this `base` routes normalizeOpenInterestUsd through the
    // `contracts × size × underlying` branch so OI lands in real USD notional.
    // Previously 'USD' produced e.g. "$64" for a $6.4M book.
    contractValueCurrency: base,
    tickSize: cfg?.tickSize ?? item.tickSize,
    minQty: cfg?.minQty ?? item.minQty,
    makerFee: cfg?.makerFee ?? null,
    takerFee: cfg?.takerFee ?? null,
  };
}
