import { describe, it, expect } from 'vitest';
import { averageIv, averageDelta, deltaTickLabel, extractSmile } from './smile-utils';
import type { EnrichedChainResponse } from '@shared/enriched';

type Strike = EnrichedChainResponse['strikes'][number];

function makeVenue(markIv: number | null, delta: number | null) {
  return {
    bid: null, ask: null, mid: null, bidSize: null, askSize: null,
    markIv, bidIv: null, askIv: null, delta, gamma: null, theta: null, vega: null,
    spreadPct: null, totalCost: null, estimatedFees: null,
    openInterest: null, volume24h: null, openInterestUsd: null, volume24hUsd: null,
  };
}

function makeStrike(
  strike: number,
  callIv: number | null,
  putIv: number | null,
  callDelta: number | null = null,
  putDelta: number | null = null,
): Strike {
  return {
    strike,
    call: {
      venues: { deribit: makeVenue(callIv, callDelta) },
      bestIv: callIv,
      bestVenue: callIv != null ? 'deribit' : null,
    },
    put: {
      venues: { deribit: makeVenue(putIv, putDelta) },
      bestIv: putIv,
      bestVenue: putIv != null ? 'deribit' : null,
    },
  };
}

describe('averageIv', () => {
  it('averages IV across active venues', () => {
    const venues = {
      deribit: { markIv: 0.50 },
      okx: { markIv: 0.60 },
    };
    expect(averageIv(venues, ['deribit', 'okx'])).toBe(0.55);
  });

  it('filters to active venues only', () => {
    const venues = {
      deribit: { markIv: 0.50 },
      okx: { markIv: 0.90 },
    };
    expect(averageIv(venues, ['deribit'])).toBe(0.50);
  });

  it('returns null when no venues have data', () => {
    expect(averageIv({}, ['deribit'])).toBeNull();
    expect(averageIv({ deribit: { markIv: null } }, ['deribit'])).toBeNull();
  });

  it('skips venues with null markIv', () => {
    const venues = {
      deribit: { markIv: 0.50 },
      okx: { markIv: null },
    };
    expect(averageIv(venues, ['deribit', 'okx'])).toBe(0.50);
  });
});

describe('averageDelta', () => {
  it('averages delta across active venues', () => {
    const venues = {
      deribit: { delta: 0.50 },
      okx: { delta: 0.40 },
    };
    expect(averageDelta(venues, ['deribit', 'okx'])).toBe(0.45);
  });

  it('returns null for empty venues', () => {
    expect(averageDelta({}, ['deribit'])).toBeNull();
  });
});

describe('deltaTickLabel', () => {
  it('labels ATM at 0.50', () => {
    expect(deltaTickLabel(0.50)).toBe('ATM');
    expect(deltaTickLabel(0.499)).toBe('ATM');
    expect(deltaTickLabel(0.501)).toBe('ATM');
  });

  it('labels put side (x < 0.5)', () => {
    expect(deltaTickLabel(0.25)).toBe('25\u0394p');
    expect(deltaTickLabel(0.10)).toBe('10\u0394p');
    expect(deltaTickLabel(0.05)).toBe('5\u0394p');
  });

  it('labels call side (x > 0.5)', () => {
    expect(deltaTickLabel(0.75)).toBe('25\u0394c');
    expect(deltaTickLabel(0.90)).toBe('10\u0394c');
    expect(deltaTickLabel(0.95)).toBe('5\u0394c');
  });
});

describe('extractSmile — strike mode', () => {
  const strikes: Strike[] = [
    makeStrike(60000, 0.55, 0.58),
    makeStrike(65000, 0.50, 0.52),
    makeStrike(70000, 0.48, 0.51),
    makeStrike(75000, 0.52, 0.56),
    makeStrike(80000, 0.60, 0.65),
  ];

  it('uses OTM convention: put IV below spot, call IV above', () => {
    const result = extractSmile(strikes, ['deribit'], 70000, 'strike');

    const at60k = result.find((p) => p.strike === 60000);
    const at80k = result.find((p) => p.strike === 80000);

    // Below spot → put IV (0.58 * 100 ≈ 58)
    expect(at60k?.iv).toBeCloseTo(58, 1);
    // Above spot → call IV (0.60 * 100 = 60)
    expect(at80k?.iv).toBeCloseTo(60, 1);
  });

  it('at-spot strike uses call IV', () => {
    const result = extractSmile(strikes, ['deribit'], 70000, 'strike');
    const atSpot = result.find((p) => p.strike === 70000);
    // strike >= spot → call IV (0.48 * 100 = 48)
    expect(atSpot?.iv).toBe(48);
  });

  it('filters to ±30% of spot', () => {
    const result = extractSmile(strikes, ['deribit'], 70000, 'strike');
    // 30% of 70k = 21k, so range is 49k-91k — all strikes fit
    expect(result).toHaveLength(5);
  });

  it('returns sorted by strike ascending', () => {
    const result = extractSmile(strikes, ['deribit'], 70000, 'strike');
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.strike).toBeGreaterThan(result[i - 1]!.strike);
    }
  });

  it('handles null spot (no filtering)', () => {
    const result = extractSmile(strikes, ['deribit'], null, 'strike');
    // null spot → all call IV used (spotPrice != null is false)
    expect(result).toHaveLength(5);
    expect(result[0]!.iv).toBeCloseTo(55, 1); // call IV for 60k
  });

  it('returns empty for no matching venues', () => {
    const result = extractSmile(strikes, ['binance'], 70000, 'strike');
    expect(result).toHaveLength(0);
  });
});

describe('extractSmile — delta mode', () => {
  const strikes: Strike[] = [
    makeStrike(60000, 0.58, 0.55, 0.80, -0.20),
    makeStrike(65000, 0.52, 0.50, 0.60, -0.40),
    makeStrike(70000, 0.48, 0.51, 0.50, -0.50),
    makeStrike(75000, 0.56, 0.52, 0.30, -0.70),
    makeStrike(80000, 0.65, 0.60, 0.10, -0.90),
  ];

  it('maps OTM put deltas to x = |delta| and OTM call deltas to x = 1 - delta', () => {
    const result = extractSmile(strikes, ['deribit'], 70000, 'delta');

    // 60k: put delta -0.20 (OTM, |δ| ≤ 0.5) → x=0.20, putIv=55. Call delta
    // 0.80 is ITM and dropped, so only the put IV lands in bucket 0.20.
    const bucket020 = result.find((p) => p.strike === 0.20);
    expect(bucket020).toBeDefined();
    expect(bucket020!.iv).toBeCloseTo(55, 1);

    // 75k: put delta -0.70 is ITM (|δ| > 0.5) and dropped. Call delta 0.30
    // (OTM) → x=0.70, callIv=56. Only the call IV lands in bucket 0.70.
    const bucket070 = result.find((p) => p.strike === 0.70);
    expect(bucket070).toBeDefined();
    expect(bucket070!.iv).toBeCloseTo(56, 1);
  });

  it('drops ITM legs so they do not pollute the opposite wing', () => {
    // 80k call delta 0.10 is OTM → keep at x=0.90 (callIv=65).
    // 80k put delta -0.90 is ITM → drop (would otherwise also land at x=0.90).
    // Bucket 0.90 should reflect the call IV only, not a put/call average.
    const result = extractSmile(strikes, ['deribit'], 70000, 'delta');
    const bucket090 = result.find((p) => p.strike === 0.90);
    expect(bucket090).toBeDefined();
    expect(bucket090!.iv).toBeCloseTo(65, 1);
  });

  it('filters out extreme deltas (< 0.03 or > 0.97)', () => {
    const extreme: Strike[] = [
      makeStrike(50000, 0.70, 0.68, 0.99, -0.01), // put delta too small, call maps to 0.01
    ];
    const result = extractSmile(extreme, ['deribit'], 70000, 'delta');
    expect(result).toHaveLength(0);
  });

  it('returns sorted by delta ascending', () => {
    const result = extractSmile(strikes, ['deribit'], 70000, 'delta');
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.strike).toBeGreaterThanOrEqual(result[i - 1]!.strike);
    }
  });

  it('returns empty for empty strikes', () => {
    const result = extractSmile([], ['deribit'], 70000, 'delta');
    expect(result).toHaveLength(0);
  });
});
