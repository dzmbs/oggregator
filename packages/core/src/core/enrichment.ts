import type { VenueId } from '../types/common.js';
import type {
  NormalizedOptionContract,
  VenueOptionChain,
  ComparisonRow,
  EstimatedFees,
} from './types.js';

// ── Enriched response types ───────────────────────────────────────

export interface VenueQuote {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  bidSize: number | null;
  askSize: number | null;
  markIv: number | null;
  bidIv: number | null;
  askIv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  spreadPct: number | null;
  totalCost: number | null;
  estimatedFees: EstimatedFees | null;
  openInterest: number | null;
}

export interface EnrichedSide {
  venues: Partial<Record<VenueId, VenueQuote>>;
  bestIv: number | null;
  bestVenue: VenueId | null;
}

export interface EnrichedStrike {
  strike: number;
  call: EnrichedSide;
  put: EnrichedSide;
}

export interface IvSurfaceRow {
  expiry: string;
  dte: number;
  delta10p: number | null;
  delta25p: number | null;
  atm: number | null;
  delta25c: number | null;
  delta10c: number | null;
}

export interface GexStrike {
  strike: number;
  gexUsdMillions: number;
}

export type TermStructure = 'contango' | 'flat' | 'backwardation';

export interface ChainStats {
  spotIndexUsd: number | null;
  forwardPriceUsd: number | null;
  forwardBasisPct: number | null;
  atmStrike: number | null;
  atmIv: number | null;
  putCallOiRatio: number | null;
  totalOiUsd: number | null;
  skew25d: number | null;
}

export interface EnrichedChainResponse {
  underlying: string;
  expiry: string;
  dte: number;
  stats: ChainStats;
  strikes: EnrichedStrike[];
  gex: GexStrike[];
}

// ── Internal helpers ──────────────────────────────────────────────

/**
 * Extracts a VenueQuote from a single NormalizedOptionContract.
 * Retail market orders are taker fills, so totalCost includes the taker fee.
 * Half the spread is added because mid is the reference — buying at ask costs
 * an extra (ask - mid) = spread/2 on top of mid.
 */
function contractToVenueQuote(contract: NormalizedOptionContract): VenueQuote {
  const bid = contract.quote.bid.usd;
  const ask = contract.quote.ask.usd;
  const markMid = contract.quote.mark.usd;

  // Prefer computed mid from live bid/ask; fall back to exchange mark price.
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : markMid;

  // One-sided markets (bid=0 or ask=0) and Derive's inverted quotes (bid > ask)
  // both produce ±200% or negative spread via the formula — return null so the
  // UI renders '–' rather than a misleading red percentage.
  const validSpread = bid !== null && ask !== null && bid > 0 && ask > 0 && ask >= bid && mid !== null && mid > 0;
  const spreadPct = validSpread ? ((ask - bid) / mid) * 100 : null;

  // Cost to enter: mid + half-spread (you pay ask) + taker fee.
  const fees = contract.quote.estimatedFees;
  const halfSpread = bid !== null && ask !== null ? (ask - bid) / 2 : 0;
  const totalCost =
    mid !== null ? mid + halfSpread + (fees?.taker ?? 0) : null;

  return {
    bid,
    ask,
    mid,
    bidSize: contract.quote.bidSize,
    askSize: contract.quote.askSize,
    markIv: contract.greeks.markIv,
    bidIv: contract.greeks.bidIv,
    askIv: contract.greeks.askIv,
    delta: contract.greeks.delta,
    gamma: contract.greeks.gamma,
    theta: contract.greeks.theta,
    vega: contract.greeks.vega,
    spreadPct,
    totalCost,
    estimatedFees: fees,
    openInterest: contract.quote.openInterest,
  };
}

/**
 * Builds an EnrichedSide from the per-venue contracts at one strike/right.
 * bestIv is the lowest non-null markIv across venues with an active market —
 * lower IV = cheaper premium, so it identifies the best entry price for a buyer.
 * Venues with zero bid and ask are excluded: they list instruments but have no
 * real quotes (e.g. Derive SOL), and letting them win bestVenue would propagate
 * their placeholder prices as the authoritative mid.
 */
function buildEnrichedSide(
  contracts: Partial<Record<VenueId, NormalizedOptionContract>>,
): EnrichedSide {
  const venues: Partial<Record<VenueId, VenueQuote>> = {};
  let bestIv: number | null = null;
  let bestVenue: VenueId | null = null;

  for (const [venueKey, contract] of Object.entries(contracts) as [
    VenueId,
    NormalizedOptionContract,
  ][]) {
    const quote = contractToVenueQuote(contract);
    venues[venueKey] = quote;

    // Require a real market: non-zero quotes AND either open interest or a genuine
    // spread (bid ≠ ask). Derive SOL lists instruments with bid=ask=250 and OI=0 —
    // phantom placeholder quotes that must not win bestVenue.
    const hasQuotes = (quote.bid !== null && quote.bid > 0) || (quote.ask !== null && quote.ask > 0);
    const hasLiquidity = (quote.openInterest ?? 0) > 0
      || (quote.bid !== null && quote.ask !== null && quote.bid !== quote.ask);
    const hasMarket = hasQuotes && hasLiquidity;
    const iv = quote.markIv;
    if (iv !== null && hasMarket && (bestIv === null || iv < bestIv)) {
      bestIv = iv;
      bestVenue = venueKey;
    }
  }

  return { venues, bestIv, bestVenue };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Converts a raw ComparisonRow (venue contracts keyed by venue) into an
 * EnrichedStrike with computed per-venue quotes and cross-venue best-IV.
 */
export function enrichComparisonRow(row: ComparisonRow): EnrichedStrike {
  return {
    strike: row.strike,
    call: buildEnrichedSide(row.call),
    put: buildEnrichedSide(row.put),
  };
}

/**
 * Walks all venue chains to extract the first non-null spot/forward prices.
 * Venue chains are iterated in registration order so the first entry wins;
 * callers should pass chains in priority order (e.g. Deribit first).
 */
function extractPrices(
  venueChains: VenueOptionChain[],
): { spotIndexUsd: number | null; forwardPriceUsd: number | null } {
  let spotIndexUsd: number | null = null;
  let forwardPriceUsd: number | null = null;

  outer: for (const vc of venueChains) {
    for (const contract of Object.values(vc.contracts)) {
      if (spotIndexUsd === null) {
        spotIndexUsd = contract.quote.indexPriceUsd;
      }
      if (forwardPriceUsd === null) {
        forwardPriceUsd = contract.quote.underlyingPriceUsd;
      }
      if (spotIndexUsd !== null && forwardPriceUsd !== null) break outer;
    }
  }

  return { spotIndexUsd, forwardPriceUsd };
}

/**
 * Finds the strike with an absolute delta closest to the target.
 * Delta signs: calls are positive, puts are negative — callers pass the
 * signed target so directionality is preserved (e.g. -0.25 for 25Δ put).
 */
function closestDeltaStrike(
  strikes: EnrichedStrike[],
  targetDelta: number,
  side: 'call' | 'put',
): EnrichedStrike | null {
  let best: EnrichedStrike | null = null;
  let bestDist = Infinity;

  for (const s of strikes) {
    const sideData = side === 'call' ? s.call : s.put;
    let delta: number | null = null;
    for (const vq of Object.values(sideData.venues)) {
      if (vq !== undefined && vq.delta !== null) {
        delta = vq.delta;
        break;
      }
    }
    if (delta === null) continue;

    const dist = Math.abs(delta - targetDelta);
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }

  return best;
}

/**
 * Computes aggregate open-interest totals. Splits by put/call so the
 * put/call OI ratio can be derived from the same pass.
 */
function sumOiByRight(strikes: EnrichedStrike[]): {
  putOi: number;
  callOi: number;
} {
  let putOi = 0;
  let callOi = 0;

  for (const s of strikes) {
    for (const vq of Object.values(s.call.venues)) {
      callOi += vq?.openInterest ?? 0;
    }
    for (const vq of Object.values(s.put.venues)) {
      putOi += vq?.openInterest ?? 0;
    }
  }

  return { putOi, callOi };
}

/**
 * Derives chain-level summary statistics from enriched strikes and raw venue
 * chains. ATM is anchored to the forward price so basis/carry is captured.
 */
export function computeChainStats(
  strikes: EnrichedStrike[],
  venueChains: VenueOptionChain[],
): ChainStats {
  const { spotIndexUsd, forwardPriceUsd } = extractPrices(venueChains);

  const forwardBasisPct =
    forwardPriceUsd !== null && spotIndexUsd !== null
      ? ((forwardPriceUsd - spotIndexUsd) / spotIndexUsd) * 100
      : null;

  // ATM anchored to forward; fall back to spot when forward is unavailable.
  const refPrice = forwardPriceUsd ?? spotIndexUsd;
  let atmStrike: number | null = null;
  let atmIv: number | null = null;

  if (refPrice !== null && strikes.length > 0) {
    let minDist = Infinity;
    for (const s of strikes) {
      const dist = Math.abs(s.strike - refPrice);
      if (dist < minDist) {
        minDist = dist;
        atmStrike = s.strike;
        // Call IV is convention for ATM vol; put IV should be equal by put-call parity.
        atmIv = s.call.bestIv;
      }
    }
  }

  const { putOi, callOi } = sumOiByRight(strikes);
  const putCallOiRatio = callOi > 0 ? putOi / callOi : null;

  const priceForOi = forwardPriceUsd ?? spotIndexUsd ?? 0;
  const totalOiUsd = (putOi + callOi) * priceForOi;

  // 25Δ skew: put25 IV − call25 IV. Positive = put skew (downside fear).
  const put25Strike = closestDeltaStrike(strikes, -0.25, 'put');
  const call25Strike = closestDeltaStrike(strikes, 0.25, 'call');
  let skew25d: number | null = null;
  if (put25Strike !== null && call25Strike !== null) {
    const putIv = put25Strike.put.bestIv;
    const callIv = call25Strike.call.bestIv;
    skew25d = putIv !== null && callIv !== null ? putIv - callIv : null;
  }

  return {
    spotIndexUsd,
    forwardPriceUsd,
    forwardBasisPct,
    atmStrike,
    atmIv,
    putCallOiRatio,
    totalOiUsd,
    skew25d,
  };
}

/**
 * Computes gamma exposure (GEX) per strike in USD millions.
 *
 * GEX = Σ(OI × gamma × contractSize × spot²) / 1_000_000
 *
 * Puts contribute negative GEX because market makers are short puts and long
 * calls against retail flow — their delta hedge direction reverses at strikes
 * with high put OI, creating a local support/resistance dynamic.
 *
 * Uses original ComparisonRows to access contractSize per venue,
 * which isn't available on the enriched VenueQuote.
 */
function computeGexFromRows(
  rows: ComparisonRow[],
  strikes: EnrichedStrike[],
  spotPrice: number,
): GexStrike[] {
  const spot2 = spotPrice * spotPrice;
  const result: GexStrike[] = [];

  const rowByStrike = new Map<number, ComparisonRow>(
    rows.map((r) => [r.strike, r]),
  );

  for (const s of strikes) {
    const row = rowByStrike.get(s.strike);
    let callGex = 0;
    let putGex = 0;

    for (const [venueKey, vq] of Object.entries(s.call.venues) as [
      VenueId,
      VenueQuote | undefined,
    ][]) {
      if (vq === undefined || vq.openInterest === null || vq.gamma === null)
        continue;
      const original = row?.call[venueKey];
      const size = original?.contractSize ?? 1;
      callGex += (vq.openInterest * vq.gamma * size * spot2) / 1_000_000;
    }

    for (const [venueKey, vq] of Object.entries(s.put.venues) as [
      VenueId,
      VenueQuote | undefined,
    ][]) {
      if (vq === undefined || vq.openInterest === null || vq.gamma === null)
        continue;
      const original = row?.put[venueKey];
      const size = original?.contractSize ?? 1;
      putGex += (vq.openInterest * vq.gamma * size * spot2) / 1_000_000;
    }

    result.push({ strike: s.strike, gexUsdMillions: callGex - putGex });
  }

  return result;
}

/**
 * Days to expiry — options at most venues expire at 08:00 UTC.
 * Math.ceil so that the expiry day itself counts as 1 DTE, not 0.
 */
export function computeDte(expiry: string): number {
  return Math.ceil(
    (new Date(expiry + 'T08:00:00Z').getTime() - Date.now()) / 86_400_000,
  );
}

/**
 * Builds the IV surface row for a single expiry.
 *
 * Finds the strike nearest to each standard delta level and reads bestIv from
 * that strike. Using bestIv (lowest IV across venues) rather than a single
 * venue's mark keeps the surface representative of the most competitive quote.
 */
export function computeIvSurface(
  expiry: string,
  dte: number,
  strikes: EnrichedStrike[],
): IvSurfaceRow {
  // ATM is defined as call delta ≈ 0.50 (not exactly 0.50 due to skew, but
  // closest available strike).
  const atm = closestDeltaStrike(strikes, 0.5, 'call');
  const d25c = closestDeltaStrike(strikes, 0.25, 'call');
  const d10c = closestDeltaStrike(strikes, 0.1, 'call');
  const d25p = closestDeltaStrike(strikes, -0.25, 'put');
  const d10p = closestDeltaStrike(strikes, -0.1, 'put');

  return {
    expiry,
    dte,
    delta10p: d10p?.put.bestIv ?? null,
    delta25p: d25p?.put.bestIv ?? null,
    atm: atm?.call.bestIv ?? null,
    delta25c: d25c?.call.bestIv ?? null,
    delta10c: d10c?.call.bestIv ?? null,
  };
}

/**
 * Classifies the vol term structure from nearest to furthest expiry.
 *
 * 2% threshold avoids noise-driven flips on nearly-flat surfaces; contango
 * (far vol > near vol) is the normal state in equity/crypto options.
 */
export function computeTermStructure(surfaces: IvSurfaceRow[]): TermStructure {
  if (surfaces.length < 2) return 'flat';

  // surfaces should arrive sorted by DTE ascending; use first and last.
  const sorted = [...surfaces].sort((a, b) => a.dte - b.dte);
  const nearAtm = sorted[0]?.atm;
  const farAtm = sorted[sorted.length - 1]?.atm;

  if (nearAtm === null || nearAtm === undefined) return 'flat';
  if (farAtm === null || farAtm === undefined) return 'flat';

  if (farAtm > nearAtm + 2) return 'contango';
  if (nearAtm > farAtm + 2) return 'backwardation';
  return 'flat';
}

/**
 * Orchestrates enrichment for one (underlying, expiry) chain.
 *
 * Enrichment is a pure transformation: raw ComparisonRows → structured
 * analytics. No network calls, no mutation of inputs.
 */
export function buildEnrichedChain(
  underlying: string,
  expiry: string,
  rows: ComparisonRow[],
  venueChains: VenueOptionChain[],
): EnrichedChainResponse {
  const strikes = rows.map(enrichComparisonRow);
  const stats = computeChainStats(strikes, venueChains);
  const dte = computeDte(expiry);

  // Prefer forward price for GEX anchor (it's what market makers hedge against).
  const spotPrice = stats.spotIndexUsd ?? stats.forwardPriceUsd ?? 0;
  const gex = computeGexFromRows(rows, strikes, spotPrice);

  return {
    underlying,
    expiry,
    dte,
    stats,
    strikes,
    gex,
  };
}
