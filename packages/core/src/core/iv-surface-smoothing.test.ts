import { describe, expect, it } from 'vitest';

import {
  FINE_DELTA_GRID,
  type EnrichedStrike,
  type IvSurfaceFineRow,
  type VenueQuote,
} from './enrichment.js';
import {
  computeCmmIvSurface,
  fillRowLinear,
  fitRowFromStrikesSvi,
  smoothFineSurfaceRow,
} from './iv-surface-smoothing.js';

function createQuote(partial: Partial<VenueQuote> = {}): VenueQuote {
  return {
    bid: null,
    ask: null,
    mid: null,
    bidSize: null,
    askSize: null,
    markIv: null,
    bidIv: null,
    askIv: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    spreadPct: null,
    totalCost: null,
    estimatedFees: null,
    openInterest: null,
    volume24h: null,
    openInterestUsd: null,
    volume24hUsd: null,
    ...partial,
  };
}

function syntheticSmile(
  refPrice: number,
  T: number,
  strikes: number[],
  atmIv: number,
  skew: number,
  curvature: number,
): EnrichedStrike[] {
  return strikes.map((K) => {
    const k = Math.log(K / refPrice);
    const iv = atmIv + skew * k + curvature * k * k;
    return {
      strike: K,
      call: {
        bestIv: iv,
        bestVenue: 'deribit',
        venues: { deribit: createQuote({ markIv: iv }) },
      },
      put: {
        bestIv: iv,
        bestVenue: 'deribit',
        venues: { deribit: createQuote({ markIv: iv }) },
      },
    } satisfies EnrichedStrike;
  });
}

describe('fillRowLinear', () => {
  it('linearly interpolates internal nulls', () => {
    const ivs: (number | null)[] = [0.5, null, null, 0.8, null, 1.0];
    const out = fillRowLinear(ivs);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[1]).toBeCloseTo(0.6, 6);
    expect(out[2]).toBeCloseTo(0.7, 6);
    expect(out[3]).toBeCloseTo(0.8, 6);
    expect(out[4]).toBeCloseTo(0.9, 6);
    expect(out[5]).toBeCloseTo(1.0, 6);
  });

  it('flat-extrapolates leading and trailing nulls', () => {
    const ivs: (number | null)[] = [null, null, 0.4, 0.6, null];
    const out = fillRowLinear(ivs);
    expect(out[0]).toBeCloseTo(0.4, 6);
    expect(out[1]).toBeCloseTo(0.4, 6);
    expect(out[2]).toBeCloseTo(0.4, 6);
    expect(out[3]).toBeCloseTo(0.6, 6);
    expect(out[4]).toBeCloseTo(0.6, 6);
  });

  it('returns the row unchanged when fewer than 2 points are observed', () => {
    expect(fillRowLinear([null, null, 0.5, null])).toEqual([null, null, 0.5, null]);
    expect(fillRowLinear([null, null, null])).toEqual([null, null, null]);
  });
});

describe('fitRowFromStrikesSvi', () => {
  it('fills the full delta grid when SVI fit succeeds', () => {
    const refPrice = 100_000;
    const T = 30 / 365;
    const strikes = [70_000, 80_000, 90_000, 100_000, 110_000, 120_000, 130_000];
    const enriched = syntheticSmile(refPrice, T, strikes, 0.6, -0.1, 0.5);

    const ivs = fitRowFromStrikesSvi(enriched, refPrice, T);
    expect(ivs).not.toBeNull();
    expect(ivs).toHaveLength(FINE_DELTA_GRID.length);
    for (const v of ivs ?? []) {
      expect(v).not.toBeNull();
      expect(v!).toBeGreaterThan(0.05);
      expect(v!).toBeLessThan(5);
    }
  });

  it('returns null when fewer than 5 valid points are available', () => {
    const refPrice = 100_000;
    const T = 30 / 365;
    const strikes = syntheticSmile(refPrice, T, [90_000, 100_000, 110_000], 0.6, -0.1, 0.5);
    expect(fitRowFromStrikesSvi(strikes, refPrice, T)).toBeNull();
  });

  it('rejects bad reference price or tenor', () => {
    const refPrice = 100_000;
    const T = 30 / 365;
    const strikes = syntheticSmile(refPrice, T, [90_000, 100_000, 110_000, 120_000, 130_000], 0.6, -0.1, 0.5);
    expect(fitRowFromStrikesSvi(strikes, 0, T)).toBeNull();
    expect(fitRowFromStrikesSvi(strikes, refPrice, 0)).toBeNull();
  });
});

describe('smoothFineSurfaceRow', () => {
  it('uses SVI when fittable and fills every bucket', () => {
    const refPrice = 100_000;
    const T = 30 / 365;
    const strikes = syntheticSmile(
      refPrice,
      T,
      [70_000, 80_000, 90_000, 100_000, 110_000, 120_000, 130_000],
      0.6,
      -0.1,
      0.5,
    );
    const raw: IvSurfaceFineRow = {
      expiry: '2026-04-04',
      dte: 30,
      ivs: FINE_DELTA_GRID.map(() => null),
    };
    const out = smoothFineSurfaceRow(raw, strikes, refPrice, T);
    expect(out.ivs.every((v) => v != null)).toBe(true);
  });

  it('falls back to linear fill when too few strikes for SVI', () => {
    const refPrice = 100_000;
    const T = 30 / 365;
    const strikes = syntheticSmile(refPrice, T, [], 0.6, 0, 0);
    const raw: IvSurfaceFineRow = {
      expiry: '2026-04-04',
      dte: 30,
      ivs: [null, null, 0.5, null, null, null, null, null, null, 0.55, null, null, null, null, null, null, null, null, 0.6],
    };
    const out = smoothFineSurfaceRow(raw, strikes, refPrice, T);
    expect(out.ivs.every((v) => v != null)).toBe(true);
    expect(out.ivs[0]).toBeCloseTo(0.5, 6);
    expect(out.ivs[FINE_DELTA_GRID.length - 1]).toBeCloseTo(0.6, 6);
  });
});

describe('computeCmmIvSurface', () => {
  it('returns one row per CMM tenor inside the listed DTE range', () => {
    const rows: IvSurfaceFineRow[] = [
      { expiry: '2026-05-13', dte: 7, ivs: FINE_DELTA_GRID.map(() => 0.5) },
      { expiry: '2026-06-05', dte: 30, ivs: FINE_DELTA_GRID.map(() => 0.55) },
      { expiry: '2026-08-04', dte: 90, ivs: FINE_DELTA_GRID.map(() => 0.6) },
    ];
    const cmm = computeCmmIvSurface(rows);
    const tenors = cmm.map((r) => r.tenorDays);
    expect(tenors).toEqual([7, 14, 30, 60, 90]);
  });

  it('interpolates in total variance between bracketing rows', () => {
    const rows: IvSurfaceFineRow[] = [
      { expiry: '2026-05-13', dte: 10, ivs: FINE_DELTA_GRID.map(() => 0.5) },
      { expiry: '2026-06-05', dte: 40, ivs: FINE_DELTA_GRID.map(() => 0.6) },
    ];
    const cmm = computeCmmIvSurface(rows, [25]);
    expect(cmm).toHaveLength(1);
    const v = cmm[0]!.ivs[0]!;
    const wLo = 0.5 * 0.5 * 10;
    const wHi = 0.6 * 0.6 * 40;
    const wTarget = wLo + (wHi - wLo) * ((25 - 10) / (40 - 10));
    expect(v).toBeCloseTo(Math.sqrt(wTarget / 25), 6);
  });

  it('drops CMM tenors outside the listed DTE range', () => {
    const rows: IvSurfaceFineRow[] = [
      { expiry: '2026-05-13', dte: 30, ivs: FINE_DELTA_GRID.map(() => 0.5) },
      { expiry: '2026-06-05', dte: 60, ivs: FINE_DELTA_GRID.map(() => 0.55) },
    ];
    const cmm = computeCmmIvSurface(rows);
    const tenors = cmm.map((r) => r.tenorDays);
    expect(tenors).toEqual([30, 60]);
  });

  it('returns empty when no rows have positive DTE', () => {
    expect(computeCmmIvSurface([])).toEqual([]);
    expect(
      computeCmmIvSurface([
        { expiry: '2026-05-06', dte: 0, ivs: FINE_DELTA_GRID.map(() => 0.5) },
      ]),
    ).toEqual([]);
  });
});
