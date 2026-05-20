import type { VenueId } from '../types/common.js';
import type {
  NormalizedOptionContract,
  VenueOptionChain,
  ComparisonRow,
  EstimatedFees,
} from './types.js';

// 2 vol points — avoids noise-driven flips on nearly-flat surfaces
const TERM_STRUCTURE_THRESHOLD = 0.02;

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
  volume24h: number | null;
  openInterestUsd: number | null;
  volume24hUsd: number | null;
  // Per-quote staleness + the per-venue underlying that was applied during USD
  // normalization. Consumers that aggregate USD prices across venues need both
  // to (a) drop stale venues from the median and (b) renormalize inverse-venue
  // USD mids against a canonical underlying instead of each venue's own.
  asOfMs?: number | null;
  underlyingPriceUsd?: number | null;
  inverse?: boolean;
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

// Fine-grained delta grid for the 3D surface view. Aligns with FINE_DELTA_GRID
// (0.05 → 0.95 step 0.05): keys ≤ 0.5 hold OTM put IVs, keys ≥ 0.5 hold OTM
// call IVs, 0.5 itself is the put/call blended ATM.
export const FINE_DELTA_GRID: readonly number[] = [
  0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5,
  0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95,
];

// Dense delta grid (0.05 → 0.95 step 0.01, 91 points) used to render smoothed
// and constant-maturity surfaces. Raw observed rows still use FINE_DELTA_GRID
// because rounding more strikes into more buckets just creates more empty
// cells; the SVI fit and CMM interpolator are continuous and resample cheaply.
export const ULTRA_FINE_DELTA_GRID: readonly number[] = (() => {
  const out: number[] = [];
  for (let i = 5; i <= 95; i++) out.push(i / 100);
  return out;
})();

export interface IvSurfaceFineRow {
  expiry: string;
  dte: number;
  // ivs[i] aligns with FINE_DELTA_GRID[i]; null where no observable strike.
  ivs: (number | null)[];
}

// Per-strike smile point — the strike-indexed view of the surface used by
// consumers that need continuous IV data (e.g. spread analyzers, smile
// visualizations) rather than the 5-delta summary above.
export interface SmilePoint {
  strike: number;
  moneyness: number;
  callIv: number | null;
  putIv: number | null;
  blendedIv: number | null;
}

export interface SmileCurve {
  spot: number;
  points: SmilePoint[];
  atmIv: number | null;
  skew: number | null;
}

export interface GexStrike {
  strike: number;
  gexUsdMillions: number;
}

export type TermStructure = 'contango' | 'flat' | 'backwardation';

// ── IV history (constant-maturity) ────────────────────────────────

export type IvTenor = '7d' | '30d' | '60d' | '90d';

export interface IvHistoryPoint {
  ts: number;
  atmIv: number | null;
  rr25d: number | null;
  bfly25d: number | null;
}

export interface IvHistoryExtrema {
  atmIv: number | null;
  rr25d: number | null;
  bfly25d: number | null;
}

export interface IvHistoryTenorResult {
  current: IvHistoryPoint;
  atmRank: number | null;
  atmPercentile: number | null;
  rrRank: number | null;
  rrPercentile: number | null;
  flyRank: number | null;
  flyPercentile: number | null;
  min: IvHistoryExtrema;
  max: IvHistoryExtrema;
  series: IvHistoryPoint[];
}

export interface IvHistoryResponse {
  underlying: string;
  windowDays: 30 | 90;
  tenors: Record<IvTenor, IvHistoryTenorResult>;
}

export interface ChainStats {
  // Per-expiry forward price (averaged across reporting venues). Sourced from
  // each contract's `underlyingPriceUsd` (Deribit `underlying_price`, OKX
  // `fwdPx`). On long tenors this carries basis vs spot — do NOT display as "spot".
  forwardPriceUsd: number | null;
  indexPriceUsd: number | null;
  basisPct: number | null;
  atmStrike: number | null;
  atmIv: number | null;
  putCallOiRatio: number | null;
  totalOiUsd: number | null;
  skew25d: number | null;
  bfly25d: number | null;
}

export interface EnrichedChainResponse {
  underlying: string;
  expiry: string;
  // Exact expiry in ms UTC, min across reporting venues. null when no venue
  // surfaces a timestamp — callers fall back to the 08:00 UTC convention.
  expiryTs: number | null;
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
  const validSpread =
    bid !== null && ask !== null && bid > 0 && ask > 0 && ask >= bid && mid !== null && mid > 0;
  const spreadPct = validSpread ? ((ask - bid) / mid) * 100 : null;

  // Cost to enter: mid + half-spread (you pay ask) + taker fee.
  const fees = contract.quote.estimatedFees;
  const halfSpread = bid !== null && ask !== null ? (ask - bid) / 2 : 0;
  const totalCost = mid !== null ? mid + halfSpread + (fees?.taker ?? 0) : null;

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
    volume24h: contract.quote.volume24h,
    // Prefer normalized USD OI from the feed layer. Do not reconstruct it here
    // from raw OI, because venues do not agree on OI units.
    openInterestUsd: contract.quote.openInterestUsd,
    volume24hUsd:
      contract.quote.volume24hUsd ??
      (contract.quote.volume24h != null && contract.quote.underlyingPriceUsd != null
        ? contract.quote.volume24h * contract.quote.underlyingPriceUsd
        : null),
    asOfMs: contract.quote.timestamp,
    underlyingPriceUsd: contract.quote.underlyingPriceUsd,
    inverse: contract.inverse,
  };
}

/**
 * Builds an EnrichedSide from the per-venue contracts at one strike/right.
 * bestIv is the lowest non-null markIv across venues with an active market —
 * lower IV = cheaper premium, so it identifies the best entry for a buyer.
 * Venues without real liquidity (zero quotes or placeholder prices with no OI)
 * are excluded from bestVenue selection to prevent phantom data from propagating.
 */
function buildEnrichedSide(
  contracts: Partial<Record<VenueId, NormalizedOptionContract>>,
): EnrichedSide {
  const venues: Partial<Record<VenueId, VenueQuote>> = {};
  let bestIv: number | null = null;
  let bestVenue: VenueId | null = null;

  for (const venueKey of Object.keys(contracts) as VenueId[]) {
    const contract = contracts[venueKey];
    if (contract == null) continue;
    const quote = contractToVenueQuote(contract);
    venues[venueKey] = quote;

    // Exclude phantom quotes: some venues list instruments with identical bid/ask
    // and zero OI — no real market exists. Require OI > 0 or a genuine spread.
    const hasQuotes =
      (quote.bid !== null && quote.bid > 0) || (quote.ask !== null && quote.ask > 0);
    const hasLiquidity =
      (quote.openInterest ?? 0) > 0 ||
      (quote.bid !== null && quote.ask !== null && quote.bid !== quote.ask);
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
 * Aggregates reference prices across venue chains.
 *
 * `forwardPriceUsd`: per-expiry forward, averaged across venues. Each venue
 * contributes its first contract's `underlyingPriceUsd` (Deribit
 * `underlying_price`, OKX `fwdPx`) — which is the forward to the chain's
 * expiry, not spot.
 *
 * `indexPriceUsd`: spot index, averaged across venues. Each venue contributes
 * its first contract's `indexPriceUsd`.
 */
function extractPrices(venueChains: VenueOptionChain[]): {
  forwardPriceUsd: number | null;
  indexPriceUsd: number | null;
} {
  const forwards: number[] = [];
  const indices: number[] = [];

  for (const vc of venueChains) {
    let venueForward: number | null = null;
    let venueIndex: number | null = null;

    for (const contract of Object.values(vc.contracts)) {
      if (venueForward === null && contract.quote.underlyingPriceUsd !== null) {
        venueForward = contract.quote.underlyingPriceUsd;
      }
      if (venueIndex === null && contract.quote.indexPriceUsd !== null) {
        venueIndex = contract.quote.indexPriceUsd;
      }
      if (venueForward !== null && venueIndex !== null) break;
    }

    if (venueForward !== null) forwards.push(venueForward);
    if (venueIndex !== null) indices.push(venueIndex);
  }

  const forwardPriceUsd =
    forwards.length > 0 ? forwards.reduce((sum, value) => sum + value, 0) / forwards.length : null;
  const indexPriceUsd =
    indices.length > 0 ? indices.reduce((sum, value) => sum + value, 0) / indices.length : null;

  return { forwardPriceUsd, indexPriceUsd };
}

/**
 * Finds the strike with an absolute delta closest to the target.
 * Delta signs: calls are positive, puts are negative — callers pass the
 * signed target so directionality is preserved (e.g. -0.25 for 25Δ put).
 */
function averageMetric(
  venues: Partial<Record<VenueId, VenueQuote>>,
  pick: (quote: VenueQuote) => number | null,
): number | null {
  let sum = 0;
  let count = 0;

  for (const quote of Object.values(venues)) {
    if (quote === undefined) continue;
    const value = pick(quote);
    if (value === null) continue;
    sum += value;
    count += 1;
  }

  return count > 0 ? sum / count : null;
}

function averageSideDelta(side: EnrichedSide): number | null {
  return averageMetric(side.venues, (quote) => quote.delta);
}

function averageSideIv(side: EnrichedSide): number | null {
  return averageMetric(side.venues, (quote) => quote.markIv);
}

const MAX_TARGET_DELTA_DISTANCE = 0.15;

function closestDeltaStrike(
  strikes: EnrichedStrike[],
  targetDelta: number,
  side: 'call' | 'put',
): EnrichedStrike | null {
  let best: EnrichedStrike | null = null;
  let bestDist = Infinity;

  for (const s of strikes) {
    const sideData = side === 'call' ? s.call : s.put;
    const delta = averageSideDelta(sideData);
    if (delta === null) continue;

    const dist = Math.abs(delta - targetDelta);
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }

  if (best == null || bestDist > MAX_TARGET_DELTA_DISTANCE) {
    return null;
  }

  return best;
}

function closestStrikeToPrice(
  strikes: EnrichedStrike[],
  referencePrice: number | null,
): EnrichedStrike | null {
  if (referencePrice === null || strikes.length === 0) return null;

  let best: EnrichedStrike | null = null;
  let bestDist = Infinity;

  for (const strike of strikes) {
    const dist = Math.abs(strike.strike - referencePrice);
    if (dist < bestDist) {
      bestDist = dist;
      best = strike;
    }
  }

  return best;
}

/**
 * Computes aggregate open-interest totals. Splits by put/call so the
 * put/call OI ratio can be derived from the same pass.
 */
function sumOiUsdByRight(strikes: EnrichedStrike[]): {
  putOiUsd: number;
  callOiUsd: number;
} {
  let putOiUsd = 0;
  let callOiUsd = 0;

  for (const s of strikes) {
    for (const vq of Object.values(s.call.venues)) {
      callOiUsd += vq?.openInterestUsd ?? 0;
    }
    for (const vq of Object.values(s.put.venues)) {
      putOiUsd += vq?.openInterestUsd ?? 0;
    }
  }

  return { putOiUsd, callOiUsd };
}

/**
 * Derives chain-level summary statistics from enriched strikes and raw venue
 * chains. ATM is anchored to the index price so basis/carry is captured.
 */
export function computeChainStats(
  strikes: EnrichedStrike[],
  venueChains: VenueOptionChain[],
): ChainStats {
  const { forwardPriceUsd, indexPriceUsd } = extractPrices(venueChains);

  // (forward − spot) / spot × 100. Positive under contango (forward > spot),
  // negative under backwardation. Standard derivatives sign convention.
  const basisPct =
    indexPriceUsd !== null && forwardPriceUsd !== null && indexPriceUsd !== 0
      ? ((forwardPriceUsd - indexPriceUsd) / indexPriceUsd) * 100
      : null;

  const refPrice = indexPriceUsd ?? forwardPriceUsd;
  let atmStrike: number | null = null;
  let atmIv: number | null = null;

  const atm = closestStrikeToPrice(strikes, refPrice);
  if (atm != null) {
    atmStrike = atm.strike;
    // Call IV is convention for ATM vol; average selected venues to match
    // the current venue filter rather than inheriting one venue's mark.
    atmIv = averageSideIv(atm.call);
  }

  const { putOiUsd, callOiUsd } = sumOiUsdByRight(strikes);
  const putCallOiRatio = callOiUsd > 0 ? putOiUsd / callOiUsd : null;

  const totalOiUsd = putOiUsd + callOiUsd;

  // 25Δ skew: call25 IV − put25 IV. Negative = put skew (downside fear).
  // 25Δ butterfly: (call25 + put25) / 2 − ATM. Positive = wing-rich smile.
  const put25Strike = closestDeltaStrike(strikes, -0.25, 'put');
  const call25Strike = closestDeltaStrike(strikes, 0.25, 'call');
  let skew25d: number | null = null;
  let bfly25d: number | null = null;
  if (put25Strike !== null && call25Strike !== null) {
    const putIv = averageSideIv(put25Strike.put);
    const callIv = averageSideIv(call25Strike.call);
    if (putIv !== null && callIv !== null) {
      skew25d = callIv - putIv;
      if (atmIv !== null) {
        bfly25d = (callIv + putIv) / 2 - atmIv;
      }
    }
  }

  return {
    forwardPriceUsd,
    indexPriceUsd,
    basisPct,
    atmStrike,
    atmIv,
    putCallOiRatio,
    totalOiUsd,
    skew25d,
    bfly25d,
  };
}

/**
 * Computes gamma exposure (GEX) per strike in USD millions.
 *
 * GEX = Σ(OI × gamma × contractSize × spot²) / 1_000_000
 *
 * Each venue contribution uses that venue's own spot/index reference when
 * available. This avoids anchoring multi-venue GEX to whichever venue happened
 * to arrive first.
 */
export function computeGex(
  rows: ComparisonRow[],
  strikes: EnrichedStrike[],
  fallbackSpotPrice: number,
): GexStrike[] {
  const result: GexStrike[] = [];

  const rowByStrike = new Map<number, ComparisonRow>(rows.map((r) => [r.strike, r]));

  for (const s of strikes) {
    const row = rowByStrike.get(s.strike);
    let callGex = 0;
    let putGex = 0;

    for (const venueKey of Object.keys(s.call.venues) as VenueId[]) {
      const vq = s.call.venues[venueKey];
      if (vq === undefined || vq.openInterest === null || vq.gamma === null) {
        continue;
      }
      const original = row?.call[venueKey];
      const size = original?.contractSize ?? 1;
      const venueSpot =
        original?.quote.indexPriceUsd ?? original?.quote.underlyingPriceUsd ?? fallbackSpotPrice;
      callGex += (vq.openInterest * vq.gamma * size * venueSpot * venueSpot) / 1_000_000;
    }

    for (const venueKey of Object.keys(s.put.venues) as VenueId[]) {
      const vq = s.put.venues[venueKey];
      if (vq === undefined || vq.openInterest === null || vq.gamma === null) {
        continue;
      }
      const original = row?.put[venueKey];
      const size = original?.contractSize ?? 1;
      const venueSpot =
        original?.quote.indexPriceUsd ?? original?.quote.underlyingPriceUsd ?? fallbackSpotPrice;
      putGex += (vq.openInterest * vq.gamma * size * venueSpot * venueSpot) / 1_000_000;
    }

    result.push({ strike: s.strike, gexUsdMillions: callGex - putGex });
  }

  return result;
}

/**
 * Sums per-expiry GEX into a single strike profile.
 *
 * Dealer hedging in reality is the sum across all listed expiries — a per-
 * expiry view shows only one slice. Use this to render an "all expiries"
 * profile. Strikes that exist in some expiries but not others are unioned;
 * strikes shared across expiries have their gexUsdMillions added (signs
 * preserved). Output is sorted ascending by strike.
 */
export function combineGex(perExpiryGex: GexStrike[][]): GexStrike[] {
  const byStrike = new Map<number, number>();
  for (const list of perExpiryGex) {
    for (const row of list) {
      byStrike.set(row.strike, (byStrike.get(row.strike) ?? 0) + row.gexUsdMillions);
    }
  }
  return [...byStrike.entries()]
    .map(([strike, gexUsdMillions]) => ({ strike, gexUsdMillions }))
    .sort((left, right) => left.strike - right.strike);
}

/**
 * Days to expiry. Prefers an exact ms timestamp when the caller has one
 * (all 7 adapters now surface one), falls back to the 08:00 UTC convention
 * on the date string. Math.ceil so the expiry day itself counts as 1 DTE.
 */
export function computeDte(expiry: string, expiryTs?: number | null): number {
  const ms = expiryTs ?? new Date(expiry + 'T08:00:00Z').getTime();
  return Math.ceil((ms - Date.now()) / 86_400_000);
}

/**
 * Picks the earliest expiryTs reported by any venue on a given chain.
 * Venues for the same YYMMDD typically agree within seconds; taking the min
 * makes the countdown conservative.
 */
export function pickExpiryTs(venueChains: VenueOptionChain[]): number | null {
  let min: number | null = null;
  for (const chain of venueChains) {
    for (const contract of Object.values(chain.contracts)) {
      const ts = contract.expiryTs;
      if (ts != null && Number.isFinite(ts) && (min == null || ts < min)) {
        min = ts;
      }
    }
  }
  return min;
}

/**
 * Builds the IV surface row for a single expiry.
 *
 * For multi-venue selections, the surface uses the average mark IV across the
 * selected venues at the strike closest to each target delta. Single-venue
 * selections naturally collapse to that venue's exact smile.
 */
export function computeIvSurface(
  expiry: string,
  dte: number,
  strikes: EnrichedStrike[],
  referencePrice: number | null = null,
): IvSurfaceRow {
  const atm =
    closestStrikeToPrice(strikes, referencePrice) ?? closestDeltaStrike(strikes, 0.5, 'call');
  const d25c = closestDeltaStrike(strikes, 0.25, 'call');
  const d10c = closestDeltaStrike(strikes, 0.1, 'call');
  const d25p = closestDeltaStrike(strikes, -0.25, 'put');
  const d10p = closestDeltaStrike(strikes, -0.1, 'put');

  return {
    expiry,
    dte,
    delta10p: d10p ? averageSideIv(d10p.put) : null,
    delta25p: d25p ? averageSideIv(d25p.put) : null,
    atm: atm ? averageSideIv(atm.call) : null,
    delta25c: d25c ? averageSideIv(d25c.call) : null,
    delta10c: d10c ? averageSideIv(d10c.call) : null,
  };
}

// Cap on accepted mark-IV values (fractional, so 5.0 = 500%). Anything outside
// this band is treated as a venue glitch and ignored — keeps the 3D colorbar
// from being blown out by a single bad quote.
const MIN_IV = 0.05;
const MAX_IV = 5;

function isValidIv(iv: number | null | undefined): iv is number {
  return iv != null && Number.isFinite(iv) && iv >= MIN_IV && iv <= MAX_IV;
}

// Map an OTM delta to its slot on FINE_DELTA_GRID. Puts use |δ|, calls use
// 1−δ, mirroring the deltaTickLabel convention. ITM deltas (|δ| > 0.5) are
// rejected so they don't pollute the opposite wing of the smile.
function deltaToFineKey(delta: number, side: 'put' | 'call'): number | null {
  if (!Number.isFinite(delta)) return null;
  if (side === 'put') {
    if (delta >= -0.02 || delta < -0.5) return null;
    return Math.round((Math.abs(delta) / 0.05)) * 0.05;
  }
  if (delta <= 0.02 || delta > 0.5) return null;
  return Math.round(((1 - delta) / 0.05)) * 0.05;
}

/**
 * Builds a 19-bucket OTM delta grid for the 3D surface.
 *
 * For each strike, the put leg lands on the put wing (keys < 0.5) and the
 * call leg lands on the call wing (keys > 0.5); puts and calls only meet at
 * the 0.5 ATM bucket. Within each bucket we average across whichever
 * observed strikes round into it, then average across venues via the same
 * averageSideIv helper used by the 5-point row.
 */
export function computeIvSurfaceFine(
  expiry: string,
  dte: number,
  strikes: EnrichedStrike[],
  venueId?: VenueId,
): IvSurfaceFineRow {
  const buckets = new Map<number, { sum: number; count: number }>();

  const add = (key: number, iv: number) => {
    const rounded = Math.round(key * 100) / 100;
    const b = buckets.get(rounded);
    if (b) { b.sum += iv; b.count += 1; }
    else buckets.set(rounded, { sum: iv, count: 1 });
  };

  const ivOf = (side: EnrichedSide): number | null =>
    venueId ? side.venues[venueId]?.markIv ?? null : averageSideIv(side);
  const deltaOf = (side: EnrichedSide): number | null =>
    venueId ? side.venues[venueId]?.delta ?? null : averageSideDelta(side);

  for (const s of strikes) {
    const putIv = ivOf(s.put);
    const putDelta = deltaOf(s.put);
    if (isValidIv(putIv) && putDelta != null) {
      const key = deltaToFineKey(putDelta, 'put');
      if (key != null) add(key, putIv);
    }

    const callIv = ivOf(s.call);
    const callDelta = deltaOf(s.call);
    if (isValidIv(callIv) && callDelta != null) {
      const key = deltaToFineKey(callDelta, 'call');
      if (key != null) add(key, callIv);
    }
  }

  const ivs = FINE_DELTA_GRID.map((d) => {
    const b = buckets.get(Math.round(d * 100) / 100);
    return b ? b.sum / b.count : null;
  });

  return { expiry, dte, ivs };
}

/**
 * Linear-interpolate a per-strike value between the two nearest points.
 * Falls back to the nearest endpoint for strikes outside the observed range.
 */
function interpAtStrike(points: SmilePoint[], targetStrike: number): number | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.strike - b.strike);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (targetStrike <= first.strike) return first.blendedIv;
  if (targetStrike >= last.strike) return last.blendedIv;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (targetStrike <= cur.strike) {
      if (prev.blendedIv == null || cur.blendedIv == null)
        return cur.blendedIv ?? prev.blendedIv;
      const span = cur.strike - prev.strike;
      if (span === 0) return cur.blendedIv;
      const t = (targetStrike - prev.strike) / span;
      return prev.blendedIv + t * (cur.blendedIv - prev.blendedIv);
    }
  }
  return null;
}

// Half-width of the put/call seam smoothing window, as a fraction of spot.
// Inside [spot·(1−W), spot·(1+W)] we linearly mix put-side and call-side IVs
// instead of hard-switching at K=spot — removes the discontinuity that would
// otherwise jump the blended IV by a few tenths of a percent across the seam.
const ATM_BLEND_HALF_WIDTH = 0.025;

function blendOtmIv(
  strike: number,
  spot: number,
  callIv: number | null,
  putIv: number | null,
): number | null {
  if (callIv == null && putIv == null) return null;
  if (callIv == null) return putIv;
  if (putIv == null) return callIv;

  const lo = spot * (1 - ATM_BLEND_HALF_WIDTH);
  const hi = spot * (1 + ATM_BLEND_HALF_WIDTH);
  if (strike <= lo) return putIv;
  if (strike >= hi) return callIv;
  const w = (strike - lo) / (hi - lo);
  return (1 - w) * putIv + w * callIv;
}

/**
 * Extracts the strike-indexed smile curve for a single expiry.
 *
 * Complements computeIvSurface (which summarizes the smile at 5 fixed delta
 * targets) by exposing every observed strike. Analyzers and chart surfaces
 * that need continuous smile data read from this; consumers that only need
 * a term-structure snapshot keep reading IvSurfaceRow.
 *
 * Uses OTM IV per strike as the blended value — calls above spot, puts below,
 * with a smooth linear blend across the ±2.5% window centered on spot to keep
 * the curve continuous through ATM.
 */
export function computeSmile(strikes: EnrichedStrike[], spot: number): SmileCurve {
  const points: SmilePoint[] = strikes.map((s) => {
    const callIv = averageSideIv(s.call);
    const putIv = averageSideIv(s.put);
    const blended = blendOtmIv(s.strike, spot, callIv, putIv);
    return {
      strike: s.strike,
      moneyness: spot > 0 ? s.strike / spot : 0,
      callIv,
      putIv,
      blendedIv: blended,
    };
  });

  const atmIv = interpAtStrike(points, spot);
  const lowWing = interpAtStrike(points, spot * 0.9);
  const highWing = interpAtStrike(points, spot * 1.1);
  const skew =
    atmIv != null && atmIv > 0 && lowWing != null && highWing != null
      ? (lowWing - highWing) / atmIv
      : null;

  return { spot, points, atmIv, skew };
}

/**
 * Interpolates a surface field to a constant-maturity tenor in days.
 *
 * Uses variance-time interpolation (σ² × t linear across DTE), the VIX/DVOL
 * convention — keeps forward variance additive across adjacent tenors.
 * Outside the observed DTE range, clamps to the nearest endpoint.
 */
export function interpTenor(
  surfaces: IvSurfaceRow[],
  targetDays: number,
  field: 'atm' | 'delta25c' | 'delta25p' | 'delta10c' | 'delta10p',
): number | null {
  const pts = surfaces
    .map((s) => ({ dte: s.dte, v: s[field] }))
    .filter((p): p is { dte: number; v: number } => p.v != null && p.dte > 0)
    .sort((a, b) => a.dte - b.dte);
  if (pts.length === 0) return null;
  if (pts.length === 1 || targetDays <= pts[0]!.dte) return pts[0]!.v;
  if (targetDays >= pts[pts.length - 1]!.dte) return pts[pts.length - 1]!.v;
  for (let i = 1; i < pts.length; i++) {
    const lo = pts[i - 1]!;
    const hi = pts[i]!;
    if (targetDays <= hi.dte) {
      const vLo = lo.v * lo.v * lo.dte;
      const vHi = hi.v * hi.v * hi.dte;
      const span = hi.dte - lo.dte;
      if (span === 0) return hi.v;
      const t = (targetDays - lo.dte) / span;
      const interp = vLo + t * (vHi - vLo);
      if (!(interp > 0)) return null;
      return Math.sqrt(interp / targetDays);
    }
  }
  return null;
}

/**
 * Classifies the vol term structure from nearest to furthest expiry.
 *
 * 2 vol points avoids noise-driven flips on nearly-flat surfaces; contango
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

  if (farAtm > nearAtm + TERM_STRUCTURE_THRESHOLD) return 'contango';
  if (nearAtm > farAtm + TERM_STRUCTURE_THRESHOLD) return 'backwardation';
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
  const expiryTs = pickExpiryTs(venueChains);
  const dte = computeDte(expiry, expiryTs);

  const spotPrice = stats.indexPriceUsd ?? stats.forwardPriceUsd ?? 0;
  const gex = computeGex(rows, strikes, spotPrice);

  return {
    underlying,
    expiry,
    expiryTs,
    dte,
    stats,
    strikes,
    gex,
  };
}
