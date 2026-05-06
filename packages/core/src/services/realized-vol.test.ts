import { describe, expect, it } from 'vitest';
import { realizedVol } from './realized-vol.js';

describe('realizedVol — close-to-close zero-mean annualized', () => {
  it('returns 0 for a constant price series (no movement → no vol)', () => {
    expect(realizedVol([100, 100, 100, 100, 100], 365)).toBe(0);
  });

  it('matches hand-computed RV for a symmetric ±5% oscillation', () => {
    // closes alternate 100 → 105 → 100 → 105 → 100, daily candles.
    // Each log-return r_i has |r_i| = ln(1.05) ≈ 0.0487902.
    // RV = sqrt(mean(r²)) × √365 = 0.0487902 × √365 ≈ 0.93214 (≈ 93% annualized).
    const closes = [100, 105, 100, 105, 100];
    expect(realizedVol(closes, 365)).toBeCloseTo(0.93214, 4);
  });

  it('matches hand-computed RV for hourly candles', () => {
    // Single 1% jump on hourly candles → ln(1.01) × √(365×24) ≈ 0.00995 × 93.59 ≈ 0.9314.
    const closes = [100, 101];
    expect(realizedVol(closes, 365 * 24)).toBeCloseTo(0.9314, 3);
  });

  it('returns null for fewer than two closes (no return computable)', () => {
    expect(realizedVol([], 365)).toBeNull();
    expect(realizedVol([100], 365)).toBeNull();
  });

  it('returns null for non-positive periodsPerYear', () => {
    expect(realizedVol([100, 101], 0)).toBeNull();
    expect(realizedVol([100, 101], -365)).toBeNull();
  });

  it('returns null when any close is non-positive or non-finite', () => {
    expect(realizedVol([100, 0, 100], 365)).toBeNull();
    expect(realizedVol([100, NaN, 100], 365)).toBeNull();
    expect(realizedVol([100, Infinity, 100], 365)).toBeNull();
    expect(realizedVol([-100, 100], 365)).toBeNull();
  });
});
