import { describe, it, expect } from 'vitest';
import { fitSvi, isButterflyArbFree, sviTotalVariance, sviIv, type SviParams } from './svi';

const TRUTH: SviParams = { a: 0.04, b: 0.4, rho: -0.3, m: 0.02, sigma: 0.1 };

function generateSlice(truth: SviParams, T: number, ks: number[]) {
  return ks.map((k) => ({ k, iv: Math.sqrt(sviTotalVariance(truth, k) / T) }));
}

describe('svi (web mirror)', () => {
  it('sviIv equals √(w/T) — no extra scaling', () => {
    const T = 0.25;
    expect(sviIv(TRUTH, 0, T)).toBeCloseTo(Math.sqrt(sviTotalVariance(TRUTH, 0) / T), 12);
  });

  it('recovers a known SVI slice within tight tolerance', () => {
    const T = 30 / 365;
    const ks = [-0.4, -0.3, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.3, 0.4];
    const fit = fitSvi(generateSlice(TRUTH, T, ks), T);
    expect(fit).not.toBeNull();
    for (const k of ks) {
      expect(sviTotalVariance(fit!, k)).toBeCloseTo(sviTotalVariance(TRUTH, k), 4);
    }
  });

  it('isButterflyArbFree accepts well-behaved params and rejects density-violating ones', () => {
    expect(isButterflyArbFree(TRUTH, -0.5, 0.5)).toBe(true);
    const violating: SviParams = { a: 0.001, b: 2.0, rho: -0.99, m: 0, sigma: 0.01 };
    expect(isButterflyArbFree(violating, -0.2, 0.2)).toBe(false);
  });

  it('returns null for fewer than 5 points or invalid T', () => {
    const T = 0.1;
    expect(fitSvi([], T)).toBeNull();
    expect(
      fitSvi(
        [
          { k: -0.1, iv: 0.5 },
          { k: 0, iv: 0.5 },
          { k: 0.1, iv: 0.5 },
          { k: 0.2, iv: 0.5 },
        ],
        T,
      ),
    ).toBeNull();
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
});
