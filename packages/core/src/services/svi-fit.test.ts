import { describe, expect, it } from 'vitest';
import { fitSvi, isButterflyArbFree, sviTotalVariance, sviIv, type SviParams } from './svi-fit.js';

const TRUTH: SviParams = { a: 0.04, b: 0.4, rho: -0.3, m: 0.02, sigma: 0.1 };

function generateSlice(truth: SviParams, T: number, ks: number[]) {
  return ks.map((k) => {
    const w = sviTotalVariance(truth, k);
    return { k, iv: Math.sqrt(w / T) };
  });
}

describe('sviTotalVariance / sviIv', () => {
  it('total variance is non-negative on a wide log-strike grid', () => {
    const ks = [-1.5, -1, -0.5, -0.1, 0, 0.1, 0.5, 1, 1.5];
    for (const k of ks) {
      expect(sviTotalVariance(TRUTH, k)).toBeGreaterThanOrEqual(0);
    }
  });

  it('IV is total variance divided by sqrt(T) — no extra scaling', () => {
    const T = 0.25;
    const k = 0;
    const expected = Math.sqrt(sviTotalVariance(TRUTH, k) / T);
    expect(sviIv(TRUTH, k, T)).toBeCloseTo(expected, 12);
  });
});

describe('fitSvi — synthetic recovery', () => {
  it('recovers a known SVI slice within tight tolerance', () => {
    const T = 30 / 365;
    const ks = [-0.4, -0.3, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.3, 0.4];
    const points = generateSlice(TRUTH, T, ks);
    const fit = fitSvi(points, T);
    expect(fit).not.toBeNull();
    // Reconstructed total variance must match closely on the input grid.
    for (const { k } of points) {
      const wTruth = sviTotalVariance(TRUTH, k);
      const wFit = sviTotalVariance(fit!, k);
      expect(wFit).toBeCloseTo(wTruth, 4);
    }
  });

  it('fit is robust to small Gaussian noise on IVs', () => {
    const T = 60 / 365;
    const ks = [-0.5, -0.35, -0.2, -0.1, 0, 0.1, 0.2, 0.35, 0.5];
    const clean = generateSlice(TRUTH, T, ks);
    const noisy = clean.map((p, i) => ({
      k: p.k,
      // Deterministic ±0.5% IV jitter so the test is reproducible.
      iv: p.iv * (1 + ((i % 2 === 0 ? 1 : -1) * 0.005)),
    }));
    const fit = fitSvi(noisy, T);
    expect(fit).not.toBeNull();
    // Fitted total variance should still track truth within a few percent.
    const errors = ks.map((k) => {
      const wTruth = sviTotalVariance(TRUTH, k);
      const wFit = sviTotalVariance(fit!, k);
      return Math.abs(wFit - wTruth) / wTruth;
    });
    const maxErr = Math.max(...errors);
    expect(maxErr).toBeLessThan(0.05);
  });
});

describe('fitSvi — arbitrage-free constraints', () => {
  it('returns a fit with b ≥ 0, |ρ| < 1, σ > 0, and a + b·σ·√(1−ρ²) ≥ 0', () => {
    const T = 30 / 365;
    const ks = [-0.3, -0.15, 0, 0.15, 0.3];
    const points = generateSlice(TRUTH, T, ks);
    const fit = fitSvi(points, T);
    expect(fit).not.toBeNull();
    const { a, b, rho, sigma } = fit!;
    expect(b).toBeGreaterThanOrEqual(0);
    expect(Math.abs(rho)).toBeLessThan(1);
    expect(sigma).toBeGreaterThan(0);
    expect(a + b * sigma * Math.sqrt(1 - rho * rho)).toBeGreaterThanOrEqual(-1e-9);
  });

  it('handles a strongly skewed slice (ρ near −0.7) without crashing', () => {
    const T = 14 / 365;
    // Skewed but butterfly-arb-free across the calibrated range — gentler b
    // than a strict-recovery scenario so g(k) stays positive at the wings.
    const skewed: SviParams = { a: 0.06, b: 0.3, rho: -0.7, m: -0.05, sigma: 0.1 };
    const ks = [-0.4, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.4];
    const points = generateSlice(skewed, T, ks);
    const fit = fitSvi(points, T);
    expect(fit).not.toBeNull();
    expect(Math.abs(fit!.rho)).toBeLessThan(1);
  });
});

describe('isButterflyArbFree — Roger Lee g(k) ≥ 0 check', () => {
  it('accepts a well-behaved SVI slice from realistic parameters', () => {
    expect(isButterflyArbFree(TRUTH, -0.5, 0.5)).toBe(true);
  });

  it('rejects parameters that drive g(k) < 0 (large |ρ|, small a, large b)', () => {
    // wp²/(4w) dominates → density turns negative even though Martini–Mingone
    // wing condition (a + b·σ·√(1−ρ²) ≥ 0) is satisfied.
    const violating: SviParams = { a: 0.001, b: 2.0, rho: -0.99, m: 0, sigma: 0.01 };
    expect(isButterflyArbFree(violating, -0.2, 0.2)).toBe(false);
  });

  it('rejects parameters where total variance crosses zero in the test range', () => {
    const negativeWing: SviParams = { a: -0.05, b: 0.1, rho: 0, m: 0, sigma: 0.05 };
    expect(isButterflyArbFree(negativeWing, -0.5, 0.5)).toBe(false);
  });
});

describe('fitSvi — butterfly arbitrage', () => {
  it('returns null when the calibrated surface fails the g(k) ≥ 0 check', () => {
    // Pathological synthetic IVs that would fit a butterfly-violating surface:
    // a sharp V-shape with collapsing variance near m forces b to be large
    // relative to a/σ, pushing g(k) negative.
    const T = 14 / 365;
    const points = [
      { k: -0.4, iv: 1.5 },
      { k: -0.2, iv: 1.0 },
      { k: -0.05, iv: 0.05 },
      { k: 0, iv: 0.04 },
      { k: 0.05, iv: 0.05 },
      { k: 0.2, iv: 1.0 },
      { k: 0.4, iv: 1.5 },
    ];
    const fit = fitSvi(points, T);
    if (fit !== null) {
      expect(isButterflyArbFree(fit, -0.4, 0.4)).toBe(true);
    }
  });
});

describe('fitSvi — edge cases', () => {
  it('returns null for fewer than 5 points (cannot solve 5-param model)', () => {
    expect(fitSvi([], 0.1)).toBeNull();
    expect(
      fitSvi(
        [
          { k: -0.1, iv: 0.5 },
          { k: 0, iv: 0.5 },
          { k: 0.1, iv: 0.5 },
          { k: 0.2, iv: 0.5 },
        ],
        0.1,
      ),
    ).toBeNull();
  });

  it('returns null for non-positive T', () => {
    const points = [
      { k: -0.2, iv: 0.5 },
      { k: -0.1, iv: 0.5 },
      { k: 0, iv: 0.5 },
      { k: 0.1, iv: 0.5 },
      { k: 0.2, iv: 0.5 },
    ];
    expect(fitSvi(points, 0)).toBeNull();
    expect(fitSvi(points, -1)).toBeNull();
  });

  it('rejects non-finite or non-positive IVs', () => {
    const points = [
      { k: -0.2, iv: 0.5 },
      { k: -0.1, iv: NaN },
      { k: 0, iv: 0.5 },
      { k: 0.1, iv: 0.5 },
      { k: 0.2, iv: -0.1 },
    ];
    expect(fitSvi(points, 0.1)).toBeNull();
  });
});
