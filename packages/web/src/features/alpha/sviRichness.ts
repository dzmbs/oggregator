import { fitSvi, sviIv, type SviParams } from '@lib/analytics/svi';
import type { SmileCurve } from '@lib/analytics/smile';

export interface RichnessPoint {
  strike: number;
  k: number;
  ivMarket: number;
  ivSvi: number | null;
  residual: number | null;
  zScore: number | null;
}

export interface SviRichness {
  params: SviParams | null;
  points: RichnessPoint[];
  residualStd: number | null;
}

// Fit a single-expiry SVI slice to the OTM-blended smile and compute the
// per-strike residual + z-score. The z-score is the trading-edge signal:
// positive → market IV unusually rich at this strike (good sell candidate);
// negative → market IV unusually cheap (good buy candidate).
//
// Returns an empty richness object when the smile has too few usable points
// or the SVI optimizer fails so the consumer can fall back to raw IV display.
export function computeSviRichness(smile: SmileCurve | null, T: number | null): SviRichness {
  if (!smile || T == null || T <= 0 || smile.spot <= 0) {
    return { params: null, points: [], residualStd: null };
  }

  const usable = smile.points.filter((p) => p.blendedIv != null && p.blendedIv > 0);
  if (usable.length < 5) {
    return { params: null, points: [], residualStd: null };
  }

  const fitInput = usable.map((p) => ({
    k: Math.log(p.strike / smile.spot),
    iv: p.blendedIv!,
  }));
  const params = fitSvi(fitInput, T);

  const enrichedPoints: RichnessPoint[] = usable.map((p, i) => {
    const k = fitInput[i]!.k;
    const ivMarket = p.blendedIv!;
    if (!params) return { strike: p.strike, k, ivMarket, ivSvi: null, residual: null, zScore: null };
    const ivSvi = sviIv(params, k, T);
    const residual = ivMarket - ivSvi;
    return { strike: p.strike, k, ivMarket, ivSvi, residual, zScore: null };
  });

  if (!params) {
    return { params: null, points: enrichedPoints, residualStd: null };
  }

  const residuals = enrichedPoints
    .map((p) => p.residual)
    .filter((r): r is number => r != null && Number.isFinite(r));
  const meanRes = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const variance =
    residuals.reduce((acc, r) => acc + (r - meanRes) * (r - meanRes), 0) / residuals.length;
  const std = Math.sqrt(variance);

  if (std < 1e-9) {
    return { params, points: enrichedPoints, residualStd: 0 };
  }

  const withZ: RichnessPoint[] = enrichedPoints.map((p) =>
    p.residual == null ? p : { ...p, zScore: (p.residual - meanRes) / std },
  );

  return { params, points: withZ, residualStd: std };
}
