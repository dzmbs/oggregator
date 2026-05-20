import { describe, it, expect } from 'vitest';

import type { EnrichedStrike, EnrichedSide, VenueQuote } from '@shared/enriched';
import { extractSmile } from './smile';

const BLANK_SIDE = (markIv: number | null): EnrichedSide => {
  const quote: VenueQuote = {
    bid: null,
    ask: null,
    mid: null,
    bidSize: null,
    askSize: null,
    markIv,
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
  };
  return { venues: { deribit: quote }, bestIv: markIv, bestVenue: 'deribit' };
};

const strikes: EnrichedStrike[] = [
  { strike: 90, call: BLANK_SIDE(0.8), put: BLANK_SIDE(0.75) },
  { strike: 100, call: BLANK_SIDE(0.65), put: BLANK_SIDE(0.65) },
  { strike: 110, call: BLANK_SIDE(0.7), put: BLANK_SIDE(0.85) },
];

describe('extractSmile', () => {
  it('builds per-strike points using OTM IV convention', () => {
    const s = extractSmile(strikes, 100);
    expect(s.points).toHaveLength(3);
    // K=90 < spot → OTM puts → use putIv 0.75
    expect(s.points[0]!.blendedIv).toBe(0.75);
    // K=100 = spot → first branch (K < spot is false), uses callIv 0.65
    expect(s.points[1]!.blendedIv).toBe(0.65);
    // K=110 > spot → OTM calls → use callIv 0.7
    expect(s.points[2]!.blendedIv).toBe(0.7);
  });

  it('interpolates ATM IV linearly from neighbors', () => {
    const s = extractSmile(strikes, 100);
    expect(s.atmIv).toBe(0.65);
  });

  it('computes skew from wing IVs at spot*0.9 and spot*1.1', () => {
    const s = extractSmile(strikes, 100);
    // spot*0.9 = 90 → 0.75, spot*1.1 = 110 → 0.7, atm = 0.65
    expect(s.skew!).toBeCloseTo((0.75 - 0.7) / 0.65, 10);
  });

  it('moneyness = strike / spot', () => {
    const s = extractSmile(strikes, 100);
    expect(s.points[0]!.moneyness).toBe(0.9);
    expect(s.points[1]!.moneyness).toBe(1.0);
    expect(s.points[2]!.moneyness).toBe(1.1);
  });

  it('handles empty strike list', () => {
    const s = extractSmile([], 100);
    expect(s.points).toHaveLength(0);
    expect(s.atmIv).toBeNull();
    expect(s.skew).toBeNull();
  });

  // Strike grid centered on spot=100 with the ATM blend window at ±2.5% (97.5..102.5).
  // Asymmetric put/call IVs verify the linear seam-blend rather than a hard switch.
  // Outside the window we still snap to the OTM side (puts below, calls above).
  it('linearly blends put/call IVs inside the ±2.5% ATM window', () => {
    const seamStrikes: EnrichedStrike[] = [
      { strike: 95, call: BLANK_SIDE(0.7), put: BLANK_SIDE(0.55) }, // outside, below → put
      { strike: 99, call: BLANK_SIDE(0.68), put: BLANK_SIDE(0.62) }, // inside, w=0.3
      { strike: 100, call: BLANK_SIDE(0.66), put: BLANK_SIDE(0.6) }, // inside, w=0.5
      { strike: 101, call: BLANK_SIDE(0.65), put: BLANK_SIDE(0.59) }, // inside, w=0.7
      { strike: 105, call: BLANK_SIDE(0.62), put: BLANK_SIDE(0.5) }, // outside, above → call
    ];
    const s = extractSmile(seamStrikes, 100);

    // Outside the window: pure OTM side.
    expect(s.points[0]!.blendedIv).toBeCloseTo(0.55, 10);
    expect(s.points[4]!.blendedIv).toBeCloseTo(0.62, 10);

    // Inside: w = (K − 97.5) / 5.
    expect(s.points[1]!.blendedIv).toBeCloseTo(0.7 * 0.62 + 0.3 * 0.68, 10);
    expect(s.points[2]!.blendedIv).toBeCloseTo(0.5 * 0.6 + 0.5 * 0.66, 10);
    expect(s.points[3]!.blendedIv).toBeCloseTo(0.3 * 0.59 + 0.7 * 0.65, 10);
  });

  it('falls back to the available side inside the window when the other is null', () => {
    const seamStrikes: EnrichedStrike[] = [
      { strike: 99, call: BLANK_SIDE(null), put: BLANK_SIDE(0.62) },
      { strike: 101, call: BLANK_SIDE(0.65), put: BLANK_SIDE(null) },
    ];
    const s = extractSmile(seamStrikes, 100);
    expect(s.points[0]!.blendedIv).toBe(0.62);
    expect(s.points[1]!.blendedIv).toBe(0.65);
  });
});
