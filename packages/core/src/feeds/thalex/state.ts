import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import type { OptionRight } from '../../types/common.js';
import {
  THALEX_OPTION_SYMBOL_RE,
  type ThalexInstrument,
  type ThalexTicker,
} from './types.js';
import { solveIv, thetaPerDay, yearsToExpiry } from './bs-solver.js';

function mergeNumber(next: number | undefined | null, previous: number | null): number | null {
  return next ?? previous;
}

/**
 * Thalex ticker merge.
 *
 * Field map (see references/options-docs/thalex/ticker-pushes.json):
 *   best_bid_price / best_bid_amount → bidPrice / bidSize
 *   best_ask_price / best_ask_amount → askPrice / askSize
 *   mark_price / last_price          → markPrice / lastPrice
 *   index                            → underlyingPrice
 *   forward                          → (used as BS forward)
 *   volume_24h / open_interest       → volume24h / openInterest
 *   iv   → greeks.markIv             (native fraction; no ivToFraction)
 *   delta → greeks.delta
 *   mark_timestamp (seconds, float)  → timestamp (ms)
 *
 * Thalex never sends bidIv / askIv / theta — we invert Black-76 (r=0) from
 * the bid and ask premiums using ticker.forward and the instrument's
 * expirationTimestamp, with markIv as the Newton-Raphson seed. When any
 * input is missing we fall back to the previous quote's value.
 */
export function mergeThalexTicker(
  ticker: ThalexTicker,
  previous: LiveQuote | undefined,
  empty: LiveQuote,
  instrument?: CachedInstrument,
  nowMs: number = Date.now(),
): LiveQuote {
  const base = previous ?? empty;
  const markIv = mergeNumber(ticker.iv, base.greeks.markIv);
  const bidPrice = mergeNumber(ticker.best_bid_price, base.bidPrice);
  const askPrice = mergeNumber(ticker.best_ask_price, base.askPrice);

  let bidIv = base.greeks.bidIv;
  let askIv = base.greeks.askIv;
  let theta = base.greeks.theta;

  if (instrument != null) {
    const forward = ticker.forward ?? ticker.index ?? base.underlyingPrice;
    const tYears = yearsToExpiry(instrument.expirationTimestamp, nowMs);
    const common = {
      forward,
      strike: instrument.strike,
      tYears,
      right: instrument.right,
      seed: markIv,
    };
    bidIv = solveIv({ ...common, price: bidPrice }) ?? bidIv;
    askIv = solveIv({ ...common, price: askPrice }) ?? askIv;
    theta = thetaPerDay(forward, instrument.strike, markIv, tYears) ?? theta;
  }

  return {
    bidPrice,
    askPrice,
    bidSize: mergeNumber(ticker.best_bid_amount, base.bidSize),
    askSize: mergeNumber(ticker.best_ask_amount, base.askSize),
    markPrice: mergeNumber(ticker.mark_price, base.markPrice),
    lastPrice: mergeNumber(ticker.last_price, base.lastPrice),
    underlyingPrice: mergeNumber(ticker.index, base.underlyingPrice),
    indexPrice: mergeNumber(ticker.index, base.indexPrice),
    volume24h: mergeNumber(ticker.volume_24h, base.volume24h),
    openInterest: mergeNumber(ticker.open_interest, base.openInterest),
    openInterestUsd: base.openInterestUsd,
    // `value_24h` is premium-notional USD (sum of premium paid in USD), while
    // every other venue in the aggregator reports underlying-notional USD
    // (volume × spot). Leaving this null lets enrichment.ts compute
    // `volume_24h × underlyingPrice`, matching OKX/Binance/Coincall/Deribit
    // so the analytics "volume by venue" chart compares like-for-like.
    volume24hUsd: base.volume24hUsd,
    greeks: {
      delta: mergeNumber(ticker.delta, base.greeks.delta),
      gamma: base.greeks.gamma,
      theta,
      vega: base.greeks.vega,
      rho: base.greeks.rho,
      markIv,
      bidIv,
      askIv,
    },
    timestamp: Math.round(ticker.mark_timestamp * 1000),
  };
}

export interface ThalexInstrumentDeps {
  buildCanonicalSymbol: (
    base: string,
    settle: string,
    expiry: string,
    strike: number,
    right: OptionRight,
  ) => string;
  parseExpiry: (raw: string) => string;
}

/**
 * Translate a Thalex instrument row into the adapter's CachedInstrument.
 *
 * Filters out anything that's not an option. Uses the DDMMMYY token from
 * the native symbol as the expiry source of truth (same as Deribit), with
 * expiration_timestamp (seconds → ms) carried forward for downstream
 * time-to-expiry math.
 *
 * Returns null for non-options or malformed symbols.
 */
export function buildThalexInstrument(
  item: ThalexInstrument,
  deps: ThalexInstrumentDeps,
): CachedInstrument | null {
  if (item.type !== 'option') return null;

  const match = THALEX_OPTION_SYMBOL_RE.exec(item.instrument_name);
  if (!match) return null;

  const base = match[1]!;
  const expiryToken = match[2]!;
  const strike = Number(match[3]!);
  const right: OptionRight = match[4] === 'C' ? 'call' : 'put';
  if (!Number.isFinite(strike) || strike <= 0) return null;

  // Thalex is linear USD-settled (stablecoin). No inverse math ever.
  const settle = 'USD';
  const expiry = item.expiry_date ?? deps.parseExpiry(expiryToken);

  const canonical = deps.buildCanonicalSymbol(base, settle, expiry, strike, right);

  const expirationTimestampMs =
    typeof item.expiration_timestamp === 'number'
      ? Math.round(item.expiration_timestamp * 1000)
      : null;

  return {
    symbol: canonical,
    exchangeSymbol: item.instrument_name,
    base,
    quote: 'USD',
    settle,
    expiry,
    expirationTimestamp: expirationTimestampMs,
    strike,
    right,
    inverse: false,
    contractSize: 1,
    // Thalex BTC/ETH options: 1 contract = 1 unit of base (BTC or ETH), same
    // shape as Deribit. Premium settles in stablecoin (linear), but the
    // contract itself is sized in base currency — so openInterest / volume24h
    // are base-currency counts and must be multiplied by underlyingPrice to
    // get USD. Setting 'USD' here routed OI through the wrong branch of
    // normalizeOpenInterestUsd and produced e.g. "$13" instead of "$13K".
    contractValueCurrency: base,
    tickSize: item.tick_size ?? null,
    minQty: item.min_order_amount ?? item.volume_tick_size ?? null,
    // Thalex fees are tiered per account — FEE_CAP is the safety net.
    makerFee: null,
    takerFee: null,
  };
}
