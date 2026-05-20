import { describe, expect, it } from 'vitest';

import type { PositionLeg } from '@oggregator/protocol';

import { buildPortfolioPnlCurve } from './pnl-curve.js';
import type { MarkContext } from './types.js';

const NOW = Date.UTC(2026, 4, 12);
const SIGMA = 0.6;

function makeLeg(partial: Partial<PositionLeg> & { strike: number; size: number }): PositionLeg {
  return {
    legId: `leg-${partial.strike}-${partial.size}`,
    underlying: 'BTC',
    expiry: '2026-08-12',
    optionRight: 'call',
    entryPriceUsd: 1_000,
    entryIv: SIGMA,
    entryTs: NOW,
    venueHint: null,
    source: 'manual',
    realizedPnlUsd: 0,
    ...partial,
  };
}

function makeMark(): MarkContext {
  return {
    underlyingPriceUsd: 70_000,
    forwardPriceUsd: 70_000,
    markPriceUsd: 4_000,
    iv: SIGMA,
    delta: 0.5,
    gamma: 0.0001,
    vega: 100,
    theta: -50,
    yearsToExpiry: 0.25,
  };
}

describe('buildPortfolioPnlCurve', () => {
  it('computes expiry break-even prices for a single-underlying book', () => {
    const curve = buildPortfolioPnlCurve(
      [{ leg: makeLeg({ strike: 70_000, size: 1 }), mark: makeMark() }],
      NOW,
      7,
    );

    expect(curve.status).toBe('ok');
    expect(curve.points.length).toBeGreaterThan(20);
    expect(curve.breakEvenPricesUsd).toHaveLength(1);
    expect(Math.abs((curve.breakEvenPricesUsd[0] ?? 0) - 71_000)).toBeLessThan(150);
  });

  it('returns mixed_underlyings when the book spans multiple assets', () => {
    const curve = buildPortfolioPnlCurve(
      [
        { leg: makeLeg({ strike: 70_000, size: 1, underlying: 'BTC' }), mark: makeMark() },
        { leg: makeLeg({ strike: 3_000, size: 1, underlying: 'ETH', legId: 'eth-leg' }), mark: makeMark() },
      ],
      NOW,
      0,
    );

    expect(curve.status).toBe('mixed_underlyings');
    expect(curve.points).toEqual([]);
  });
});
