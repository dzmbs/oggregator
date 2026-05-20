import { describe, expect, it } from 'vitest';

import { price76, vega76 } from '../feeds/thalex/bs-solver.js';
import { attachMarks } from './aggregator.js';
import { applyVolShock, computeShockGrid, computeShockPnl } from './scenarios.js';
import type { MarkContext, MarkProvider, PositionLeg } from './types.js';

const F = 70_000;
const T_YEARS = 0.25;
const SIGMA = 0.6;
const NOW_MS = Date.UTC(2026, 4, 12);

function makeLeg(partial: Partial<PositionLeg> & { strike: number; size: number }): PositionLeg {
  return {
    legId: `leg-${partial.strike}-${partial.size}`,
    underlying: 'BTC',
    expiry: '2026-08-12',
    optionRight: 'call',
    entryPriceUsd: 1_000,
    entryIv: SIGMA,
    entryTs: NOW_MS,
    venueHint: null,
    source: 'manual',
    realizedPnlUsd: 0,
    ...partial,
  };
}

const constantMarks: MarkProvider = (leg) => {
  const v = vega76(F, leg.strike, SIGMA, T_YEARS);
  const mark = price76(F, leg.strike, SIGMA, T_YEARS, leg.optionRight);
  const m: MarkContext = {
    underlyingPriceUsd: F,
    forwardPriceUsd: F,
    markPriceUsd: mark,
    iv: SIGMA,
    delta: 0.5,
    gamma: 0.0001,
    vega: v,
    theta: -50,
    yearsToExpiry: T_YEARS,
  };
  return m;
};

describe('applyVolShock', () => {
  it('parallel adds vol points / 100', () => {
    const bumped = applyVolShock(
      { kind: 'parallel', bumpVolPts: 5 },
      0.5,
      70_000,
      '2026-08-12',
      NOW_MS,
    );
    expect(bumped).toBeCloseTo(0.55, 10);
  });

  it('skew_tilt is zero at ATM strike', () => {
    const bumped = applyVolShock(
      { kind: 'skew_tilt', atmStrike: 70_000, slopePerLogK: 0.5 },
      0.5,
      70_000,
      '2026-08-12',
      NOW_MS,
    );
    expect(bumped).toBeCloseTo(0.5, 10);
  });

  it('skew_tilt positive slope raises high strikes', () => {
    const bumped = applyVolShock(
      { kind: 'skew_tilt', atmStrike: 70_000, slopePerLogK: 0.5 },
      0.5,
      90_000,
      '2026-08-12',
      NOW_MS,
    );
    expect(bumped).toBeGreaterThan(0.5);
  });

  it('atm_bump weight maximum at ATM', () => {
    const atm = applyVolShock(
      { kind: 'atm_bump', atmStrike: 70_000, widthPct: 0.05, bumpVolPts: 5 },
      0.5,
      70_000,
      '2026-08-12',
      NOW_MS,
    );
    const wing = applyVolShock(
      { kind: 'atm_bump', atmStrike: 70_000, widthPct: 0.05, bumpVolPts: 5 },
      0.5,
      90_000,
      '2026-08-12',
      NOW_MS,
    );
    expect(atm).toBeCloseTo(0.55, 6);
    expect(Math.abs(wing - 0.5)).toBeLessThan(0.001);
  });
});

describe('computeShockPnl', () => {
  it('long-vega book gains under +5 vol parallel shock', () => {
    const legs = [
      makeLeg({ strike: 70_000, size: 1 }),
      makeLeg({ strike: 75_000, size: 1 }),
    ];
    const withMarks = attachMarks(legs, constantMarks);
    const result = computeShockPnl(
      { kind: 'parallel', bumpVolPts: 5 },
      withMarks,
      NOW_MS,
    );
    expect(result.totalPnlUsd).toBeGreaterThan(0);
    expect(result.byLeg).toHaveLength(2);
  });

  it('short-vega book loses under +5 vol parallel shock', () => {
    const legs = [makeLeg({ strike: 70_000, size: -1 })];
    const withMarks = attachMarks(legs, constantMarks);
    const result = computeShockPnl(
      { kind: 'parallel', bumpVolPts: 5 },
      withMarks,
      NOW_MS,
    );
    expect(result.totalPnlUsd).toBeLessThan(0);
  });

  it('zero shock produces near-zero PnL', () => {
    const legs = [makeLeg({ strike: 70_000, size: 1 })];
    const withMarks = attachMarks(legs, constantMarks);
    const result = computeShockPnl(
      { kind: 'parallel', bumpVolPts: 0 },
      withMarks,
      NOW_MS,
    );
    expect(Math.abs(result.totalPnlUsd)).toBeLessThan(1e-6);
  });
});

describe('computeShockGrid', () => {
  it('produces 9x9 cells with monotone PnL across ATM shift for long-vega', () => {
    const legs = [makeLeg({ strike: 70_000, size: 1 })];
    const withMarks = attachMarks(legs, constantMarks);
    const grid = computeShockGrid(withMarks, NOW_MS, 70_000);
    expect(grid).toHaveLength(9);
    expect(grid[0]).toHaveLength(9);

    const centerCol = 4;
    const pnls = grid.map((row) => row[centerCol]?.totalPnlUsd ?? 0);
    for (let i = 1; i < pnls.length; i++) {
      const prev = pnls[i - 1] ?? 0;
      const curr = pnls[i] ?? 0;
      expect(curr).toBeGreaterThan(prev);
    }
  });
});
