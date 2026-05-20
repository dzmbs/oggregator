// EM-anchored OI heatmap utilities.
//
// Spec: docs/superpowers/specs/2026-04-27-oi-heatmap-em-anchored-design.md
//
// Pure functions only — no React, no DOM. Everything that decides "what counts
// as a significant strike" or "what is the implied move per expiry" lives here
// so it can be unit-tested in isolation.

import type { EnrichedChainResponse, EnrichedStrike, VenueQuote } from '@shared/enriched';

import type { HeatRow, OiMode, HeatSide } from './oi-heatmap-utils';

export const EM_HYBRID = {
  spreadToleranceRel: 0.05,
  deviationCapRel: 0.50,
  straddleMultiplier: 1.25,
} as const;

export const STRIKE_FILTER = {
  topK: 5,
  outlierSigma: 1.5,
  emBandMultiplier: 2,
} as const;

export type EmSource = 'straddle' | 'iv-fallback';

export interface ExpectedMove {
  expiry: string;
  dte: number;
  value: number;
  source: EmSource;
}

export type SignificanceMode = 'a3-topk' | 'a4-outliers';

// ── Expected move ────────────────────────────────────────────────────

export function computeExpectedMove(
  chain: EnrichedChainResponse,
  spot: number,
): ExpectedMove | null {
  if (!Number.isFinite(spot) || spot <= 0) return null;
  const strikes = [...chain.strikes].sort((a, b) => a.strike - b.strike);
  if (strikes.length === 0) return null;

  const emIv = computeEmIv(strikes, spot, chain.dte);
  const emStraddle = computeEmStraddle(strikes, spot);

  const expiry = chain.expiry;
  const dte = chain.dte;

  if (emIv == null && emStraddle == null) return null;
  if (emIv == null) {
    // Straddle-only is risky; without an anchor we cannot validate it.
    // Use it but flag as iv-fallback so the UI knows it's unverified.
    return emStraddle != null
      ? { expiry, dte, value: emStraddle, source: 'iv-fallback' }
      : null;
  }
  if (emStraddle == null) {
    return { expiry, dte, value: emIv, source: 'iv-fallback' };
  }

  const deviation = Math.abs(emStraddle - emIv) / emIv;
  if (deviation > EM_HYBRID.deviationCapRel) {
    return { expiry, dte, value: emIv, source: 'iv-fallback' };
  }
  return { expiry, dte, value: emStraddle, source: 'straddle' };
}

function computeEmIv(strikes: EnrichedStrike[], spot: number, dte: number): number | null {
  const iv = interpolateAtmIv(strikes, spot);
  if (iv == null || dte <= 0) return null;
  return spot * iv * Math.sqrt(dte / 365);
}

function interpolateAtmIv(strikes: EnrichedStrike[], spot: number): number | null {
  const strikeIvs: { strike: number; iv: number }[] = [];
  for (const s of strikes) {
    const iv = blendedStrikeIv(s);
    if (iv != null) strikeIvs.push({ strike: s.strike, iv });
  }
  if (strikeIvs.length === 0) return null;
  if (strikeIvs.length === 1) return strikeIvs[0]!.iv;

  // Find the bracket: lo <= spot <= hi. Strikes are sorted ascending.
  let lo: { strike: number; iv: number } | null = null;
  let hi: { strike: number; iv: number } | null = null;
  for (const point of strikeIvs) {
    if (point.strike <= spot) lo = point;
    if (point.strike >= spot && hi == null) hi = point;
  }
  if (lo && hi && lo !== hi) {
    const t = (spot - lo.strike) / (hi.strike - lo.strike);
    return lo.iv + t * (hi.iv - lo.iv);
  }
  if (lo) return lo.iv;
  if (hi) return hi.iv;
  return null;
}

function blendedStrikeIv(s: EnrichedStrike): number | null {
  const callIv = bestSideIv(s.call);
  const putIv = bestSideIv(s.put);
  if (callIv != null && putIv != null) return (callIv + putIv) / 2;
  return callIv ?? putIv;
}

function bestSideIv(side: EnrichedStrike['call']): number | null {
  if (side.bestIv != null) return side.bestIv;
  for (const q of Object.values(side.venues)) {
    if (q?.markIv != null) return q.markIv;
  }
  return null;
}

function computeEmStraddle(strikes: EnrichedStrike[], spot: number): number | null {
  const atm = pickAtm(strikes, spot);
  if (!atm) return null;

  const callMid = compositeMid(atm.call.venues);
  const putMid = compositeMid(atm.put.venues);
  if (callMid == null || putMid == null) return null;

  return (callMid.mid + putMid.mid) * EM_HYBRID.straddleMultiplier;
}

function pickAtm(strikes: EnrichedStrike[], spot: number): EnrichedStrike | null {
  let best: EnrichedStrike | null = null;
  let bestDist = Infinity;
  for (const s of strikes) {
    const d = Math.abs(s.strike - spot);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

interface CompositeMid {
  bestBid: number;
  bestAsk: number;
  mid: number;
}

function compositeMid(venues: Partial<Record<string, VenueQuote>>): CompositeMid | null {
  let bestBid = -Infinity;
  let bestAsk = Infinity;
  for (const q of Object.values(venues)) {
    if (!q) continue;
    if (q.bid != null && q.bid > 0 && q.bid > bestBid) bestBid = q.bid;
    if (q.ask != null && q.ask > 0 && q.ask < bestAsk) bestAsk = q.ask;
  }
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) return null;
  if (bestBid <= 0 || bestAsk <= 0) return null;
  if (bestBid > bestAsk) return null;

  const mid = (bestBid + bestAsk) / 2;
  if (mid <= 0) return null;
  const spreadRel = (bestAsk - bestBid) / mid;
  if (spreadRel > EM_HYBRID.spreadToleranceRel) return null;
  return { bestBid, bestAsk, mid };
}

// ── Significance filter ──────────────────────────────────────────────

export interface SignificantStrikesInput {
  chains: EnrichedChainResponse[];
  spotPrice: number | null;
  mode: OiMode;
  hiddenExpiries: ReadonlySet<string>;
  side: HeatSide;
  emByExpiry: ReadonlyMap<string, ExpectedMove>;
  significance: SignificanceMode;
}

// Returns the union set of strikes considered significant under the chosen
// significance mode. Caller composes this with `aggregateHeatRows` output.
export function selectSignificantStrikes(input: SignificantStrikesInput): Set<number> {
  const { chains, spotPrice, mode, hiddenExpiries, side, emByExpiry, significance } = input;
  if (spotPrice == null) return new Set();

  const result = new Set<number>();
  const readOi = readOiFor(mode);

  for (const chain of chains) {
    if (hiddenExpiries.has(chain.expiry)) continue;
    const em = emByExpiry.get(chain.expiry);
    if (!em) continue;

    const lo = spotPrice - STRIKE_FILTER.emBandMultiplier * em.value;
    const hi = spotPrice + STRIKE_FILTER.emBandMultiplier * em.value;

    const candidates: { strike: number; oi: number }[] = [];
    for (const strike of chain.strikes) {
      if (strike.strike < lo || strike.strike > hi) continue;
      const oi = sideOi(strike, readOi, side);
      if (oi <= 0) continue;
      candidates.push({ strike: strike.strike, oi });
    }
    if (candidates.length === 0) continue;

    if (significance === 'a3-topk') {
      candidates.sort((a, b) => b.oi - a.oi);
      for (const c of candidates.slice(0, STRIKE_FILTER.topK)) result.add(c.strike);
    } else {
      const cutoff = outlierCutoff(candidates.map((c) => c.oi));
      for (const c of candidates) if (c.oi > cutoff) result.add(c.strike);
    }
  }
  return result;
}

function readOiFor(mode: OiMode): (q: VenueQuote | undefined) => number {
  return mode === 'notional'
    ? (q) => q?.openInterestUsd ?? 0
    : (q) => q?.openInterest ?? 0;
}

function sideOi(
  strike: EnrichedStrike,
  readOi: (q: VenueQuote | undefined) => number,
  side: HeatSide,
): number {
  let call = 0;
  let put = 0;
  for (const q of Object.values(strike.call.venues)) call += readOi(q);
  for (const q of Object.values(strike.put.venues)) put += readOi(q);
  if (side === 'calls') return call;
  if (side === 'puts') return put;
  return call + put;
}

function outlierCutoff(values: number[]): number {
  if (values.length === 0) return Infinity;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  return mean + STRIKE_FILTER.outlierSigma * std;
}

// Convenience wrapper: filters a HeatRow[] to only the significant strikes.
export function filterRowsBySignificance(
  rows: readonly HeatRow[],
  significantStrikes: ReadonlySet<number>,
): HeatRow[] {
  if (significantStrikes.size === 0) return [];
  return rows.filter((r) => significantStrikes.has(r.strike));
}

// ── Strike classification (used by tooltip) ──────────────────────────

export type EmZone = 'inside-1sigma' | 'inside-2sigma' | 'outside';

export function classifyStrikeVsEm(
  strike: number,
  spot: number,
  em: ExpectedMove,
): EmZone {
  const d = Math.abs(strike - spot);
  if (d <= em.value) return 'inside-1sigma';
  if (d <= STRIKE_FILTER.emBandMultiplier * em.value) return 'inside-2sigma';
  return 'outside';
}
