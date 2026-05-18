import { describe, expect, it } from 'vitest';

import { price76, vega76 } from '../feeds/thalex/bs-solver.js';
import {
  aggregateGreeksByExpiry,
  aggregateGreeksByStrike,
  attachMarks,
  breakEvenIvCurve,
  computeTotals,
} from './aggregator.js';
import type { MarkContext, MarkProvider, PositionLeg } from './types.js';

const F = 70_000;
const T_YEARS = 0.25;
const SIGMA = 0.6;

function makeLeg(partial: Partial<PositionLeg> & { strike: number; size: number }): PositionLeg {
  return {
    legId: `leg-${partial.strike}-${partial.size}`,
    underlying: 'BTC',
    expiry: '2026-06-27',
    optionRight: 'call',
    entryPriceUsd: 1_000,
    entryIv: SIGMA,
    entryTs: 1_700_000_000_000,
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

describe('aggregateGreeksByStrike', () => {
  it('sums vega per strike with sign of size', () => {
    const legs = [
      makeLeg({ strike: 70_000, size: 1 }),
      makeLeg({ strike: 80_000, size: -2 }),
      makeLeg({ strike: 75_000, size: 1, optionRight: 'put' }),
    ];
    const withMarks = attachMarks(legs, constantMarks);
    const rows = aggregateGreeksByStrike(withMarks);

    expect(rows).toHaveLength(3);
    expect(rows[0]?.strike).toBe(70_000);
    expect(rows[1]?.strike).toBe(75_000);
    expect(rows[2]?.strike).toBe(80_000);

    const row80 = rows.find((r) => r.strike === 80_000);
    expect(row80?.vega).toBeLessThan(0);

    const row70 = rows.find((r) => r.strike === 70_000);
    expect(row70?.vega).toBeGreaterThan(0);
    expect(row70?.delta).toBeCloseTo(0.5, 6);
  });

  it('does not collapse call and put at the same strike+expiry', () => {
    const legs = [
      makeLeg({ strike: 70_000, size: 1 }),
      makeLeg({ strike: 70_000, size: 2, legId: 'leg-a', optionRight: 'put' }),
    ];
    const withMarks = attachMarks(legs, constantMarks);
    const rows = aggregateGreeksByStrike(withMarks);
    expect(rows).toHaveLength(2);
    const call = rows.find((r) => r.optionRight === 'call');
    const put = rows.find((r) => r.optionRight === 'put');
    expect(call?.contracts).toBe(1);
    expect(put?.contracts).toBe(2);
  });

  it('merges same-right legs at one strike with gross contracts', () => {
    const legs = [
      makeLeg({ strike: 70_000, size: 1, legId: 'long' }),
      makeLeg({ strike: 70_000, size: -1, legId: 'short' }),
    ];
    const withMarks = attachMarks(legs, constantMarks);
    const rows = aggregateGreeksByStrike(withMarks);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.contracts).toBe(2);
  });
});

describe('aggregateGreeksByExpiry', () => {
  it('groups legs by expiry', () => {
    const legs = [
      makeLeg({ strike: 70_000, size: 1 }),
      makeLeg({ strike: 80_000, size: -2, expiry: '2026-09-26', legId: 'sep-1' }),
    ];
    const withMarks = attachMarks(legs, constantMarks);
    const rows = aggregateGreeksByExpiry(withMarks, Date.UTC(2026, 4, 12));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.expiry)).toEqual(['2026-06-27', '2026-09-26']);
  });

  it('contracts is gross open size, not signed net (spreads do not collapse to zero)', () => {
    const legs = [
      makeLeg({ strike: 70_000, size: 1, legId: 'long-70k' }),
      makeLeg({ strike: 80_000, size: -1, legId: 'short-80k' }),
    ];
    const withMarks = attachMarks(legs, constantMarks);
    const rows = aggregateGreeksByExpiry(withMarks, Date.UTC(2026, 4, 12));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.contracts).toBe(2);
  });
});

describe('breakEvenIvCurve', () => {
  it('break-even IV equals entry IV when entry price equals current mark', () => {
    const leg = makeLeg({ strike: 70_000, size: 1 });
    const mark = price76(F, leg.strike, SIGMA, T_YEARS, 'call');
    const leg2: PositionLeg = { ...leg, entryPriceUsd: mark };
    const withMarks = attachMarks([leg2], constantMarks);
    const rows = breakEvenIvCurve(withMarks);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.breakEvenIv).not.toBeNull();
    expect(Math.abs((rows[0]?.breakEvenIv as number) - SIGMA)).toBeLessThan(1e-4);
  });

  it('ivCushionPct positive when current IV > break-even IV', () => {
    const leg = makeLeg({ strike: 70_000, size: 1, entryPriceUsd: 100 });
    const withMarks = attachMarks([leg], constantMarks);
    const rows = breakEvenIvCurve(withMarks);
    expect(rows[0]?.breakEvenIv).not.toBeNull();
    expect((rows[0]?.breakEvenIv as number) < SIGMA).toBe(true);
    expect((rows[0]?.ivCushionPct as number) > 0).toBe(true);
  });

  it('null break-even when mark context lacks forward', () => {
    const leg = makeLeg({ strike: 70_000, size: 1 });
    const withMarks = attachMarks([leg], () => ({
      underlyingPriceUsd: null,
      forwardPriceUsd: null,
      markPriceUsd: null,
      iv: null,
      delta: null,
      gamma: null,
      vega: null,
      theta: null,
      yearsToExpiry: null,
    }));
    const rows = breakEvenIvCurve(withMarks);
    expect(rows[0]?.breakEvenIv).toBeNull();
  });

  it("flags 'below_intrinsic' when entry sits below the no-arb floor", () => {
    // Deep-ITM put: F=60k, K=70k → intrinsic = 10k. Entry 5k is below floor.
    const leg = makeLeg({
      strike: 70_000,
      size: -1,
      optionRight: 'put',
      entryPriceUsd: 5_000,
    });
    const withMarks = attachMarks([leg], () => ({
      underlyingPriceUsd: 60_000,
      forwardPriceUsd: 60_000,
      markPriceUsd: 10_500,
      iv: 0.6,
      delta: -0.95,
      gamma: 0,
      vega: 0,
      theta: 0,
      yearsToExpiry: 0.05,
    }));
    const rows = breakEvenIvCurve(withMarks);
    expect(rows[0]?.beNote).toBe('below_intrinsic');
    expect(rows[0]?.breakEvenIv).toBeNull();
    expect(rows[0]?.ivCushionPct).toBeNull();
  });

  it("flags 'above_upper' when entry exceeds the upper no-arb bound", () => {
    // Call upper bound is the forward. Entry > forward → no positive vol can
    // price the call there. Symmetric to below_intrinsic.
    const leg = makeLeg({
      strike: 70_000,
      size: 1,
      optionRight: 'call',
      entryPriceUsd: 65_000,
    });
    const withMarks = attachMarks([leg], () => ({
      underlyingPriceUsd: 60_000,
      forwardPriceUsd: 60_000,
      markPriceUsd: 100,
      iv: 0.6,
      delta: 0.1,
      gamma: 0,
      vega: 0,
      theta: 0,
      yearsToExpiry: 0.05,
    }));
    const rows = breakEvenIvCurve(withMarks);
    expect(rows[0]?.beNote).toBe('above_upper');
    expect(rows[0]?.breakEvenIv).toBeNull();
    expect(rows[0]?.ivCushionPct).toBeNull();
  });
});

describe('computeTotals', () => {
  it('sums net Greeks across legs with size sign', () => {
    const legs = [
      makeLeg({ strike: 70_000, size: 2 }),
      makeLeg({ strike: 80_000, size: -1 }),
    ];
    const withMarks = attachMarks(legs, constantMarks);
    const totals = computeTotals(withMarks);
    expect(totals.netVegaUsd).toBeGreaterThan(0);
    expect(totals.netDeltaUsd).toBeCloseTo(0.5, 6);
  });

  it('unrealizedPnlUsd is zero when mark equals entry price', () => {
    const leg = makeLeg({
      strike: 70_000,
      size: 1,
      entryPriceUsd: price76(F, 70_000, SIGMA, T_YEARS, 'call'),
    });
    const withMarks = attachMarks([leg], constantMarks);
    const totals = computeTotals(withMarks);
    expect(Math.abs(totals.unrealizedPnlUsd)).toBeLessThan(1e-6);
  });
});
