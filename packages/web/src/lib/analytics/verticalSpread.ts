import type { EnrichedStrike, VenueQuote, VenueId } from '@shared/enriched';
import { blackScholesCall, blackScholesPut, normCdf, realWorldPop, type OptionRight } from './blackScholes';
import { inferMissingIv } from './ivInference';

export type SpreadKind = 'call-credit' | 'put-credit';
export type TradingSignal = 'SELL' | 'AVOID' | 'HOLD';

// Physical-measure inputs. When supplied, success probability is computed
// against realized vol and the user's directional drift instead of the
// risk-neutral measure — the EV gate then reflects the trade's *actual*
// expected outcome, not a fair-value estimate.
export interface RealWorldParams {
  drift: number;
  sigmaRV: number;
}

export interface SpreadInput {
  kind: SpreadKind;
  shortStrike: number;
  longStrike: number;
  strikes: readonly EnrichedStrike[];
  spot: number;
  T: number;
  r: number;
  // When empty, considers every venue present in the chain.
  venues?: readonly VenueId[];
  // Optional O(1) strike lookup. When omitted, falls back to linear scan on
  // `strikes`. Callers that run on every WS tick (≈5Hz) should precompute this
  // once per snapshot and pass it in; otherwise the pricer does O(n) on the
  // strike list twice per invocation.
  strikeByKey?: ReadonlyMap<number, EnrichedStrike>;
  // Optional smile interpolator. When provided, success probability is the
  // risk-neutral N(±d₂) at the breakeven strike. When omitted, falls back to a
  // coarse spot/breakeven heuristic.
  ivAtStrike?: (strike: number) => number | null;
  // When provided, success probability and EV are computed from physical
  // drift and realized vol instead of the risk-neutral surface IV.
  realWorld?: RealWorldParams;
}

export interface VenueLegCandidate {
  venue: VenueId;
  /** IV used for pricing this leg (after inference fallback). */
  iv: number | null;
  /** Executable premium at this venue — bid price for sell, ask price for buy. */
  executablePrice: number | null;
  /** Post-fee net: sell gets bid - taker fee, buy gets ask + taker fee. */
  netAfterFees: number | null;
  takerFee: number | null;
  size: number | null;
  sourcedIv: 'bidIv' | 'askIv' | 'markIv' | 'inferred' | null;
}

export interface LegRoute {
  best: VenueLegCandidate | null;
  candidates: VenueLegCandidate[];
}

export interface SpreadSignal {
  signal: TradingSignal;
  reasoning: string;
  netCredit: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number;
  riskReward: number;
  successProbability: number;
  // 'real-world'   = N(±d₂) at user's physical drift μ and realized σ_RV.
  // 'risk-neutral' = Black-Scholes N(±d₂) at breakeven IV.
  // 'heuristic'    = bucketed spot/breakeven ratio (fallback when no IV is available).
  probabilityMethod: 'real-world' | 'risk-neutral' | 'heuristic';
  // Expected value at expiry: pop × credit − (1 − pop) × maxLoss.
  expectedValue: number;
  // Return on capital: ev / maxLoss. The gate threshold for SELL is roc ≥ 0.10.
  roc: number;
}

export interface RoutedSpreadAnalysis {
  kind: SpreadKind;
  shortStrike: number;
  longStrike: number;
  right: OptionRight;
  spreadWidth: number;
  short: LegRoute;
  long: LegRoute;
  /** Signal computed from the best-venue combination after fees. */
  combinedSignal: SpreadSignal | null;
  /** Signal from surface-level IV (average across selected venues), for reference. */
  surfaceSignal: SpreadSignal | null;
}

// ── Helpers ────────────────────────────────────────────────────────

function findStrike(
  strikes: readonly EnrichedStrike[],
  targetStrike: number,
  byKey?: ReadonlyMap<number, EnrichedStrike>,
): EnrichedStrike | null {
  if (byKey) return byKey.get(targetStrike) ?? null;
  return strikes.find((s) => s.strike === targetStrike) ?? null;
}

function rightForKind(kind: SpreadKind): OptionRight {
  return kind === 'call-credit' ? 'call' : 'put';
}

function sideForKind(strike: EnrichedStrike, kind: SpreadKind) {
  return kind === 'call-credit' ? strike.call : strike.put;
}

function venueSet(
  shortSide: EnrichedStrike | null,
  longSide: EnrichedStrike | null,
  kind: SpreadKind,
  filter: readonly VenueId[] | undefined,
): VenueId[] {
  const set = new Set<VenueId>();
  if (shortSide) {
    for (const v of Object.keys(sideForKind(shortSide, kind).venues) as VenueId[]) set.add(v);
  }
  if (longSide) {
    for (const v of Object.keys(sideForKind(longSide, kind).venues) as VenueId[]) set.add(v);
  }
  if (filter && filter.length > 0) {
    const allow = new Set(filter);
    return [...set].filter((v) => allow.has(v));
  }
  return [...set];
}

function priceAtIv(right: OptionRight, spot: number, strike: number, T: number, r: number, iv: number) {
  return right === 'call'
    ? blackScholesCall(spot, strike, T, r, iv)
    : blackScholesPut(spot, strike, T, r, iv);
}

// Builds the per-venue candidate table for one leg.
// leg = 'sell' → prefer bidIv, use executable = bid price, fees reduce credit.
// leg = 'buy'  → prefer askIv, use executable = ask price, fees add to cost.
function buildLegCandidates(
  strike: EnrichedStrike | null,
  strikeValue: number,
  leg: 'sell' | 'buy',
  kind: SpreadKind,
  spot: number,
  T: number,
  r: number,
  venues: readonly VenueId[],
): VenueLegCandidate[] {
  if (!strike) return [];
  const right = rightForKind(kind);
  const side = sideForKind(strike, kind);
  const candidates: VenueLegCandidate[] = [];

  for (const venueId of venues) {
    const raw = side.venues[venueId];
    if (!raw) continue;
    const patched = inferMissingIv(raw, { spot, strike: strikeValue, T, r, right });

    let iv: number | null;
    let sourcedIv: VenueLegCandidate['sourcedIv'];
    if (leg === 'sell') {
      if (raw.bidIv != null) {
        iv = raw.bidIv;
        sourcedIv = 'bidIv';
      } else if (patched.bidIv != null) {
        iv = patched.bidIv;
        sourcedIv = 'inferred';
      } else {
        iv = raw.markIv ?? patched.markIv;
        sourcedIv = 'markIv';
      }
    } else {
      if (raw.askIv != null) {
        iv = raw.askIv;
        sourcedIv = 'askIv';
      } else if (patched.askIv != null) {
        iv = patched.askIv;
        sourcedIv = 'inferred';
      } else {
        iv = raw.markIv ?? patched.markIv;
        sourcedIv = 'markIv';
      }
    }

    const executablePrice = leg === 'sell' ? raw.bid : raw.ask;
    const size = leg === 'sell' ? raw.bidSize : raw.askSize;
    const takerFee = raw.estimatedFees?.taker ?? null;

    // Fallback when bid/ask price is missing: fall back to model-priced IV.
    // This keeps Thalex-like venues present in the router rather than dropped.
    const modeledPrice = iv != null ? priceAtIv(right, spot, strikeValue, T, r, iv) : null;
    const priceForNet = executablePrice != null && executablePrice > 0 ? executablePrice : modeledPrice;

    const netAfterFees =
      priceForNet != null
        ? leg === 'sell'
          ? priceForNet - (takerFee ?? 0)
          : priceForNet + (takerFee ?? 0)
        : null;

    candidates.push({
      venue: venueId,
      iv,
      executablePrice,
      netAfterFees,
      takerFee,
      size,
      sourcedIv,
    });
  }

  return candidates;
}

function pickBestSell(cands: VenueLegCandidate[]): VenueLegCandidate | null {
  let best: VenueLegCandidate | null = null;
  for (const c of cands) {
    if (c.netAfterFees == null) continue;
    if (best == null || c.netAfterFees > (best.netAfterFees ?? -Infinity)) best = c;
  }
  return best;
}

function pickBestBuy(cands: VenueLegCandidate[]): VenueLegCandidate | null {
  let best: VenueLegCandidate | null = null;
  for (const c of cands) {
    if (c.netAfterFees == null) continue;
    if (best == null || c.netAfterFees < (best.netAfterFees ?? Infinity)) best = c;
  }
  return best;
}

// ── Signal math ────────────────────────────────────────────────────

interface ProbabilityResult {
  prob: number;
  method: 'real-world' | 'risk-neutral' | 'heuristic';
}

// Probability of finishing in the profit zone of a credit spread.
// For a call-credit, profit ⇔ S_T < BE.
// For a put-credit,  profit ⇔ S_T > BE.
//
// Resolution order (when each input is available):
//   1. real-world     — physical drift μ and realized σ_RV (P-measure).
//   2. risk-neutral   — Black-Scholes N(±d₂) at breakeven IV (Q-measure).
//   3. heuristic      — coarse spot/BE bucket so the UI never goes blank.
function successProbability(
  kind: SpreadKind,
  spot: number,
  breakeven: number,
  T: number,
  r: number,
  ivAtBreakeven: number | null,
  realWorld: RealWorldParams | undefined,
): ProbabilityResult {
  if (realWorld && T > 0 && spot > 0 && breakeven > 0 && realWorld.sigmaRV > 0) {
    const direction = kind === 'call-credit' ? 'below' : 'above';
    const prob = realWorldPop(direction, spot, breakeven, T, realWorld.drift, realWorld.sigmaRV);
    if (Number.isFinite(prob)) return { prob, method: 'real-world' };
  }

  if (ivAtBreakeven != null && ivAtBreakeven > 0 && T > 0 && spot > 0 && breakeven > 0) {
    const sigma = ivAtBreakeven;
    const d2 = (Math.log(spot / breakeven) + (r - 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    const prob = kind === 'call-credit' ? normCdf(-d2) : normCdf(d2);
    return { prob, method: 'risk-neutral' };
  }

  const ratio = spot / breakeven;
  if (kind === 'call-credit') {
    if (spot <= breakeven) {
      if (ratio < 0.95) return { prob: 0.75, method: 'heuristic' };
      if (ratio < 0.98) return { prob: 0.65, method: 'heuristic' };
      return { prob: 0.55, method: 'heuristic' };
    }
    return { prob: 0.35, method: 'heuristic' };
  }
  if (spot >= breakeven) {
    if (ratio > 1.05) return { prob: 0.75, method: 'heuristic' };
    if (ratio > 1.02) return { prob: 0.65, method: 'heuristic' };
    return { prob: 0.55, method: 'heuristic' };
  }
  return { prob: 0.35, method: 'heuristic' };
}

// Minimum return on capital required to fire a SELL signal. Below this even
// a positive-EV trade isn't worth the buying-power tie-up. Sourced from
// vol-seller practitioner targets (≈25–33%); we use 10% so the gate accepts
// shorter-dated tickets where carry is mechanically smaller.
const ROC_GATE = 0.10;

function gateSignal(
  kind: SpreadKind,
  shortStrike: number,
  longStrike: number,
  shortPremium: number | null,
  longPremium: number | null,
  spot: number,
  T: number,
  r: number,
  ivAtStrike: ((strike: number) => number | null) | undefined,
  realWorld: RealWorldParams | undefined,
): SpreadSignal | null {
  if (shortPremium == null || longPremium == null) return null;

  const netCredit = shortPremium - longPremium;
  const spreadWidth = Math.abs(longStrike - shortStrike);

  let maxProfit: number;
  let maxLoss: number;
  if (netCredit >= 0) {
    maxProfit = netCredit;
    maxLoss = spreadWidth - netCredit;
  } else {
    maxProfit = spreadWidth - Math.abs(netCredit);
    maxLoss = Math.abs(netCredit);
  }

  const breakeven = kind === 'call-credit' ? shortStrike + netCredit : shortStrike - netCredit;
  const riskReward = maxProfit > 0 ? Math.min(maxLoss / maxProfit, 999.99) : 999.99;
  const ivBE = ivAtStrike ? ivAtStrike(breakeven) : null;
  const { prob, method } = successProbability(kind, spot, breakeven, T, r, ivBE, realWorld);

  const expectedValue = prob * netCredit - (1 - prob) * maxLoss;
  const roc = maxLoss > 0 ? expectedValue / maxLoss : 0;

  let signal: TradingSignal;
  let reasoning: string;
  if (netCredit > 0 && expectedValue > 0 && roc >= ROC_GATE) {
    signal = 'SELL';
    reasoning = `Favorable: EV $${expectedValue.toFixed(2)}, ROC ${(roc * 100).toFixed(1)}%, Success ${Math.round(prob * 100)}%`;
  } else if (netCredit > 0) {
    signal = 'AVOID';
    reasoning = expectedValue <= 0
      ? `Negative EV: $${expectedValue.toFixed(2)} at ${Math.round(prob * 100)}% success`
      : `Low ROC: ${(roc * 100).toFixed(1)}% (gate ${(ROC_GATE * 100).toFixed(0)}%)`;
  } else {
    signal = 'HOLD';
    reasoning = `Negative credit: $${netCredit.toFixed(2)}`;
  }

  return {
    signal,
    reasoning,
    netCredit,
    maxProfit,
    maxLoss,
    breakeven,
    riskReward,
    successProbability: prob,
    probabilityMethod: method,
    expectedValue,
    roc,
  };
}

// ── Surface-level (blended across venues) signal ───────────────────

function blendedSideIv(
  venues: Partial<Record<VenueId, VenueQuote>>,
  pick: (q: VenueQuote) => number | null,
): number | null {
  let sum = 0;
  let count = 0;
  for (const q of Object.values(venues)) {
    if (!q) continue;
    const v = pick(q);
    if (v == null || !Number.isFinite(v)) continue;
    sum += v;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

// Restricts a venues map to the `allowed` set. Returns the original map when
// no filter was provided so the surface signal still blends across everything
// the chain has when the user hasn't narrowed venues.
function filterVenues(
  venues: Partial<Record<VenueId, VenueQuote>>,
  allowed: readonly VenueId[],
): Partial<Record<VenueId, VenueQuote>> {
  if (allowed.length === 0) return venues;
  const out: Partial<Record<VenueId, VenueQuote>> = {};
  for (const v of allowed) {
    const q = venues[v];
    if (q) out[v] = q;
  }
  return out;
}

function computeSurfaceSignal(
  kind: SpreadKind,
  shortStrike: number,
  longStrike: number,
  shortSide: EnrichedStrike | null,
  longSide: EnrichedStrike | null,
  spot: number,
  T: number,
  r: number,
  ivAtStrike: ((strike: number) => number | null) | undefined,
  realWorld: RealWorldParams | undefined,
  venuesFilter: readonly VenueId[],
): SpreadSignal | null {
  if (!shortSide || !longSide) return null;
  const right = rightForKind(kind);
  const shortVenues = filterVenues(sideForKind(shortSide, kind).venues, venuesFilter);
  const longVenues = filterVenues(sideForKind(longSide, kind).venues, venuesFilter);

  const shortBidIv =
    blendedSideIv(shortVenues, (q) => q.bidIv) ?? blendedSideIv(shortVenues, (q) => q.markIv);
  const longAskIv =
    blendedSideIv(longVenues, (q) => q.askIv) ?? blendedSideIv(longVenues, (q) => q.markIv);

  if (shortBidIv == null || longAskIv == null) return null;

  const shortPremium = priceAtIv(right, spot, shortStrike, T, r, shortBidIv);
  const longPremium = priceAtIv(right, spot, longStrike, T, r, longAskIv);
  return gateSignal(kind, shortStrike, longStrike, shortPremium, longPremium, spot, T, r, ivAtStrike, realWorld);
}

// ── Public API ─────────────────────────────────────────────────────

export function routeVerticalSpread(input: SpreadInput): RoutedSpreadAnalysis {
  const { kind, shortStrike, longStrike, strikes, spot, T, r, venues, strikeByKey, ivAtStrike, realWorld } = input;
  const right = rightForKind(kind);
  const shortRow = findStrike(strikes, shortStrike, strikeByKey);
  const longRow = findStrike(strikes, longStrike, strikeByKey);
  const venueList = venueSet(shortRow, longRow, kind, venues);

  const shortCandidates = buildLegCandidates(shortRow, shortStrike, 'sell', kind, spot, T, r, venueList);
  const longCandidates = buildLegCandidates(longRow, longStrike, 'buy', kind, spot, T, r, venueList);

  const shortBest = pickBestSell(shortCandidates);
  const longBest = pickBestBuy(longCandidates);

  const combinedSignal = gateSignal(
    kind,
    shortStrike,
    longStrike,
    shortBest?.netAfterFees ?? null,
    longBest?.netAfterFees ?? null,
    spot,
    T,
    r,
    ivAtStrike,
    realWorld,
  );

  const surfaceSignal = computeSurfaceSignal(
    kind,
    shortStrike,
    longStrike,
    shortRow,
    longRow,
    spot,
    T,
    r,
    ivAtStrike,
    realWorld,
    venueList,
  );

  return {
    kind,
    shortStrike,
    longStrike,
    right,
    spreadWidth: Math.abs(longStrike - shortStrike),
    short: { best: shortBest, candidates: shortCandidates },
    long: { best: longBest, candidates: longCandidates },
    combinedSignal,
    surfaceSignal,
  };
}
