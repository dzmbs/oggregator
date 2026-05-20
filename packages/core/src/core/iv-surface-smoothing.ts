import type { VenueId } from '../types/common.js';
import { fitSvi, sviIv } from '../services/svi-fit.js';
import {
  FINE_DELTA_GRID,
  ULTRA_FINE_DELTA_GRID,
  type EnrichedSide,
  type EnrichedStrike,
  type IvSurfaceFineRow,
} from './enrichment.js';

const MIN_IV = 0.05;
const MAX_IV = 5;

const SVI_MIN_POINTS = 5;
const FP_MAX_ITER = 16;
const FP_TOL = 1e-4;

export const DEFAULT_CMM_TENORS: readonly number[] = [7, 14, 30, 60, 90, 180, 365];

// Dense CMM tenor candidates (every 3 days from 3..720). The CMM builder
// drops tenors outside the listed-DTE range automatically, so feeding a long
// list yields one row per 3 days within whatever the venue actually lists.
export const DENSE_CMM_TENORS: readonly number[] = (() => {
  const out: number[] = [];
  for (let d = 3; d <= 720; d += 3) out.push(d);
  return out;
})();

export interface CmmIvSurfaceRow {
  tenorDays: number;
  ivs: (number | null)[];
}

function isValidIv(iv: number | null | undefined): iv is number {
  return iv != null && Number.isFinite(iv) && iv >= MIN_IV && iv <= MAX_IV;
}

function averageSideIv(side: EnrichedSide): number | null {
  let sum = 0;
  let count = 0;
  for (const quote of Object.values(side.venues)) {
    if (!quote) continue;
    if (!isValidIv(quote.markIv)) continue;
    sum += quote.markIv;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

// Acklam 2003 inverse normal CDF — accurate to ~1.15e-9 across the unit
// interval. Used to invert BS call delta to log-moneyness when sampling SVI.
function invNormCdf(p: number): number {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      ((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!
    ) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) *
      q
    ) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    ((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!
  ) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}

/**
 * Linear-interpolate a row's null buckets from non-null neighbors.
 * Edge nulls are flat-extrapolated from the nearest known value.
 * Returns the row unchanged if fewer than two points are observed.
 */
export function fillRowLinear(
  ivs: readonly (number | null)[],
): (number | null)[] {
  const n = ivs.length;
  const out: (number | null)[] = ivs.slice();
  const known: number[] = [];
  for (let i = 0; i < n; i++) if (out[i] != null) known.push(i);
  if (known.length < 2) return out;

  const first = known[0]!;
  const last = known[known.length - 1]!;
  const firstVal = out[first]!;
  const lastVal = out[last]!;

  for (let i = 0; i < first; i++) out[i] = firstVal;
  for (let i = last + 1; i < n; i++) out[i] = lastVal;

  for (let j = 0; j < known.length - 1; j++) {
    const lo = known[j]!;
    const hi = known[j + 1]!;
    if (hi - lo <= 1) continue;
    const a = out[lo]!;
    const b = out[hi]!;
    for (let i = lo + 1; i < hi; i++) {
      const t = (i - lo) / (hi - lo);
      out[i] = a + (b - a) * t;
    }
  }
  return out;
}

/**
 * Fits SVI to a single expiry's per-strike blended IVs, then samples the
 * calibrated surface at FINE_DELTA_GRID via fixed-point delta→k inversion.
 * Returns null when the fit fails (too few points, optimizer fails, or the
 * butterfly-arb guard rejects the solution).
 */
export function fitRowFromStrikesSvi(
  strikes: readonly EnrichedStrike[],
  refPrice: number,
  T: number,
  deltaGrid: readonly number[] = FINE_DELTA_GRID,
  venueId?: VenueId,
): (number | null)[] | null {
  if (!Number.isFinite(refPrice) || refPrice <= 0) return null;
  if (!Number.isFinite(T) || T <= 0) return null;

  const ivOf = (side: EnrichedSide): number | null =>
    venueId ? side.venues[venueId]?.markIv ?? null : averageSideIv(side);

  const points: { k: number; iv: number }[] = [];
  for (const s of strikes) {
    if (s.strike <= 0) continue;
    const callIv = ivOf(s.call);
    const putIv = ivOf(s.put);
    const ivs: number[] = [];
    if (isValidIv(callIv)) ivs.push(callIv);
    if (isValidIv(putIv)) ivs.push(putIv);
    if (ivs.length === 0) continue;
    const iv = ivs.reduce((a, b) => a + b, 0) / ivs.length;
    points.push({ k: Math.log(s.strike / refPrice), iv });
  }

  if (points.length < SVI_MIN_POINTS) return null;
  const params = fitSvi(points, T);
  if (!params) return null;

  const sqrtT = Math.sqrt(T);
  const atmSigma = sviIv(params, 0, T);
  if (!Number.isFinite(atmSigma) || atmSigma <= 0) return null;

  const out: (number | null)[] = [];
  for (const key of deltaGrid) {
    const d1 = invNormCdf(1 - key);
    if (!Number.isFinite(d1)) {
      out.push(null);
      continue;
    }

    let sigma = atmSigma;
    let converged = false;
    for (let i = 0; i < FP_MAX_ITER; i++) {
      const k = -sigma * sqrtT * d1 + 0.5 * sigma * sigma * T;
      const sigmaNext = sviIv(params, k, T);
      if (!Number.isFinite(sigmaNext) || sigmaNext <= 0) break;
      if (Math.abs(sigmaNext - sigma) < FP_TOL) {
        sigma = sigmaNext;
        converged = true;
        break;
      }
      sigma = sigmaNext;
    }

    if (!converged || !isValidIv(sigma)) {
      out.push(null);
      continue;
    }
    out.push(sigma);
  }
  return out;
}

/**
 * Resamples a coarse-grid row onto a target delta grid via linear interp
 * across delta. Used to lift the linear-fallback row from FINE_DELTA_GRID
 * (19 buckets) to ULTRA_FINE_DELTA_GRID (91 buckets) so smoothed rows have
 * a consistent length regardless of which path produced them.
 */
export function liftRowToGrid(
  raw: readonly (number | null)[],
  fromGrid: readonly number[],
  toGrid: readonly number[],
): (number | null)[] {
  const filled = fillRowLinear(raw);
  if (fromGrid === toGrid) return filled;
  const out: (number | null)[] = [];
  for (const target of toGrid) {
    let lo = 0;
    while (lo < fromGrid.length - 1 && fromGrid[lo + 1]! <= target) lo++;
    const hi = Math.min(lo + 1, fromGrid.length - 1);
    const dLo = fromGrid[lo]!;
    const dHi = fromGrid[hi]!;
    const a = filled[lo] ?? null;
    const b = filled[hi] ?? null;
    if (a == null && b == null) {
      out.push(null);
      continue;
    }
    if (a == null) {
      out.push(b);
      continue;
    }
    if (b == null) {
      out.push(a);
      continue;
    }
    if (dLo === dHi) {
      out.push(a);
      continue;
    }
    const t = (target - dLo) / (dHi - dLo);
    out.push(a + (b - a) * t);
  }
  return out;
}

/**
 * Smooths a fine-surface row. Prefers an SVI fit when at least 5 strikes
 * carry valid IVs; falls back to in-row linear interpolation; returns the
 * raw row unchanged when even that has fewer than 2 observed buckets.
 *
 * Output is sampled at `deltaGrid` (default FINE_DELTA_GRID). Pass
 * ULTRA_FINE_DELTA_GRID for a 91-point dense surface.
 */
export function smoothFineSurfaceRow(
  rawRow: IvSurfaceFineRow,
  strikes: readonly EnrichedStrike[],
  refPrice: number | null,
  T: number,
  deltaGrid: readonly number[] = FINE_DELTA_GRID,
  venueId?: VenueId,
): IvSurfaceFineRow {
  if (refPrice != null && refPrice > 0 && T > 0) {
    const sviIvs = fitRowFromStrikesSvi(strikes, refPrice, T, deltaGrid, venueId);
    if (sviIvs && sviIvs.every((v): v is number => v != null)) {
      return { expiry: rawRow.expiry, dte: rawRow.dte, ivs: sviIvs };
    }
  }
  return {
    expiry: rawRow.expiry,
    dte: rawRow.dte,
    ivs: liftRowToGrid(rawRow.ivs, FINE_DELTA_GRID, deltaGrid),
  };
}

/**
 * Builds a constant-maturity surface by interpolating each delta bucket in
 * total variance (w = σ²·T linear in T) between the two listed expiries
 * that bracket the target tenor. CMM tenors outside the listed DTE range
 * are dropped — flat extrapolation would lie about long-tenor structure.
 */
export function computeCmmIvSurface(
  rows: readonly IvSurfaceFineRow[],
  tenors: readonly number[] = DEFAULT_CMM_TENORS,
): CmmIvSurfaceRow[] {
  const sorted = rows
    .filter((r) => r.dte > 0)
    .slice()
    .sort((a, b) => a.dte - b.dte);
  if (sorted.length === 0) return [];

  const minDte = sorted[0]!.dte;
  const maxDte = sorted[sorted.length - 1]!.dte;
  const out: CmmIvSurfaceRow[] = [];

  for (const target of tenors) {
    if (target < minDte || target > maxDte) continue;

    let lo = sorted[0]!;
    let hi = sorted[sorted.length - 1]!;
    if (target === minDte) {
      lo = sorted[0]!;
      hi = sorted[0]!;
    } else if (target === maxDte) {
      lo = sorted[sorted.length - 1]!;
      hi = sorted[sorted.length - 1]!;
    } else {
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i]!;
        const b = sorted[i + 1]!;
        if (a.dte <= target && b.dte >= target) {
          lo = a;
          hi = b;
          break;
        }
      }
    }

    const ivs: (number | null)[] = [];
    const gridLen = Math.min(lo.ivs.length, hi.ivs.length);
    for (let i = 0; i < gridLen; i++) {
      const a = lo.ivs[i] ?? null;
      const b = hi.ivs[i] ?? null;

      if (lo.dte === hi.dte) {
        ivs.push(a ?? b ?? null);
        continue;
      }
      if (a == null && b == null) {
        ivs.push(null);
        continue;
      }
      if (a == null) {
        ivs.push(b);
        continue;
      }
      if (b == null) {
        ivs.push(a);
        continue;
      }
      const wLo = a * a * lo.dte;
      const wHi = b * b * hi.dte;
      const w = wLo + ((wHi - wLo) * (target - lo.dte)) / (hi.dte - lo.dte);
      const sigma = Math.sqrt(Math.max(0, w / target));
      ivs.push(isValidIv(sigma) ? sigma : null);
    }
    out.push({ tenorDays: target, ivs });
  }

  return out;
}
