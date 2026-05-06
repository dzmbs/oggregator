import { describe, it, expect } from 'vitest';

import type { EnrichedStrike, VenueId, VenueQuote } from '@shared/enriched';
import { blackScholesCall, blackScholesPut } from './blackScholes';
import { routeVerticalSpread } from './verticalSpread';

function quote(partial: Partial<VenueQuote>): VenueQuote {
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

describe('routeVerticalSpread — call credit spread', () => {
  const spot = 100;
  const T = 0.25;
  const r = 0.05;

  // ITM-ish call short (K=95), OTM call long (K=105). Short collects premium,
  // long caps risk. High prob of staying sub-short in 90 days at neutral vol.
  const shortStrike = 95;
  const longStrike = 105;

  // Venue A prices the short leg favorably (higher bid IV ⇒ more credit when selling)
  // Venue B prices the long leg favorably (lower ask IV ⇒ cheaper hedge).
  // Best execution should route short→A, long→B.
  const shortIvA = 0.60; // A's bid IV on the short leg
  const shortIvB = 0.55; // B's bid IV on the short leg
  const longIvA = 0.62;  // A's ask IV on the long leg
  const longIvB = 0.58;  // B's ask IV on the long leg

  const venueA: VenueId = 'deribit';
  const venueB: VenueId = 'okx';

  const strikes: EnrichedStrike[] = [
    {
      strike: shortStrike,
      call: {
        bestIv: Math.min(shortIvA, shortIvB),
        bestVenue: venueB,
        venues: {
          [venueA]: quote({
            bid: blackScholesCall(spot, shortStrike, T, r, shortIvA),
            ask: blackScholesCall(spot, shortStrike, T, r, shortIvA + 0.005),
            bidIv: shortIvA,
            askIv: shortIvA + 0.005,
            markIv: shortIvA + 0.0025,
            estimatedFees: { maker: 0, taker: 0.1 },
          }),
          [venueB]: quote({
            bid: blackScholesCall(spot, shortStrike, T, r, shortIvB),
            ask: blackScholesCall(spot, shortStrike, T, r, shortIvB + 0.005),
            bidIv: shortIvB,
            askIv: shortIvB + 0.005,
            markIv: shortIvB + 0.0025,
            estimatedFees: { maker: 0, taker: 0.1 },
          }),
        },
      },
      put: { bestIv: null, bestVenue: null, venues: {} },
    },
    {
      strike: longStrike,
      call: {
        bestIv: Math.min(longIvA, longIvB),
        bestVenue: venueB,
        venues: {
          [venueA]: quote({
            bid: blackScholesCall(spot, longStrike, T, r, longIvA - 0.005),
            ask: blackScholesCall(spot, longStrike, T, r, longIvA),
            bidIv: longIvA - 0.005,
            askIv: longIvA,
            markIv: longIvA - 0.0025,
            estimatedFees: { maker: 0, taker: 0.1 },
          }),
          [venueB]: quote({
            bid: blackScholesCall(spot, longStrike, T, r, longIvB - 0.005),
            ask: blackScholesCall(spot, longStrike, T, r, longIvB),
            bidIv: longIvB - 0.005,
            askIv: longIvB,
            markIv: longIvB - 0.0025,
            estimatedFees: { maker: 0, taker: 0.1 },
          }),
        },
      },
      put: { bestIv: null, bestVenue: null, venues: {} },
    },
  ];

  it('routes short leg to highest-bid venue and long leg to lowest-ask venue', () => {
    const r1 = routeVerticalSpread({
      kind: 'call-credit',
      shortStrike,
      longStrike,
      strikes,
      spot,
      T,
      r,
    });
    expect(r1.short.best?.venue).toBe(venueA); // higher bid IV = more credit when selling
    expect(r1.long.best?.venue).toBe(venueB); // lower ask IV = cheaper hedge
    expect(r1.short.candidates).toHaveLength(2);
    expect(r1.long.candidates).toHaveLength(2);
  });

  it('produces a positive net credit and valid signal', () => {
    const result = routeVerticalSpread({
      kind: 'call-credit',
      shortStrike,
      longStrike,
      strikes,
      spot,
      T,
      r,
    });
    expect(result.combinedSignal).not.toBeNull();
    expect(result.combinedSignal!.netCredit).toBeGreaterThan(0);
    // Spread width bounds the loss.
    expect(result.combinedSignal!.maxLoss).toBeLessThanOrEqual(10);
    expect(['SELL', 'AVOID']).toContain(result.combinedSignal!.signal);
  });

  it('combined signal credit ≥ surface signal credit (router edge)', () => {
    const result = routeVerticalSpread({
      kind: 'call-credit',
      shortStrike,
      longStrike,
      strikes,
      spot,
      T,
      r,
    });
    expect(result.combinedSignal).not.toBeNull();
    expect(result.surfaceSignal).not.toBeNull();
    expect(result.combinedSignal!.netCredit).toBeGreaterThanOrEqual(
      result.surfaceSignal!.netCredit - 1e-6,
    );
  });

  it('honors the venues filter', () => {
    const result = routeVerticalSpread({
      kind: 'call-credit',
      shortStrike,
      longStrike,
      strikes,
      spot,
      T,
      r,
      venues: [venueB],
    });
    expect(result.short.candidates.map((c) => c.venue)).toEqual([venueB]);
    expect(result.long.candidates.map((c) => c.venue)).toEqual([venueB]);
  });

  it('surfaceSignal blends only across the venues filter (not all venues)', () => {
    // With both venues, the blended short bid IV is (0.60+0.55)/2 = 0.575,
    // giving a higher surface short premium than venueB alone (0.55).
    const both = routeVerticalSpread({
      kind: 'call-credit',
      shortStrike,
      longStrike,
      strikes,
      spot,
      T,
      r,
    });
    const onlyB = routeVerticalSpread({
      kind: 'call-credit',
      shortStrike,
      longStrike,
      strikes,
      spot,
      T,
      r,
      venues: [venueB],
    });
    expect(both.surfaceSignal).not.toBeNull();
    expect(onlyB.surfaceSignal).not.toBeNull();
    // Surface signals should differ — the filtered run sees only OKX prices.
    expect(onlyB.surfaceSignal!.netCredit).not.toBeCloseTo(both.surfaceSignal!.netCredit, 3);
  });
});

describe('routeVerticalSpread — put credit spread', () => {
  const spot = 100;
  const T = 0.25;
  const r = 0.05;
  const shortStrike = 95; // short put below spot
  const longStrike = 85; // long put further OTM

  const strikes: EnrichedStrike[] = [
    {
      strike: longStrike,
      put: {
        bestIv: 0.6,
        bestVenue: 'deribit',
        venues: {
          deribit: quote({
            bid: blackScholesPut(spot, longStrike, T, r, 0.58),
            ask: blackScholesPut(spot, longStrike, T, r, 0.6),
            bidIv: 0.58,
            askIv: 0.6,
            markIv: 0.59,
            estimatedFees: { maker: 0, taker: 0.05 },
          }),
        },
      },
      call: { bestIv: null, bestVenue: null, venues: {} },
    },
    {
      strike: shortStrike,
      put: {
        bestIv: 0.58,
        bestVenue: 'deribit',
        venues: {
          deribit: quote({
            bid: blackScholesPut(spot, shortStrike, T, r, 0.58),
            ask: blackScholesPut(spot, shortStrike, T, r, 0.6),
            bidIv: 0.58,
            askIv: 0.6,
            markIv: 0.59,
            estimatedFees: { maker: 0, taker: 0.05 },
          }),
        },
      },
      call: { bestIv: null, bestVenue: null, venues: {} },
    },
  ];

  it('puts breakeven = shortStrike - netCredit (not + as in calls)', () => {
    const result = routeVerticalSpread({
      kind: 'put-credit',
      shortStrike,
      longStrike,
      strikes,
      spot,
      T,
      r,
    });
    expect(result.combinedSignal).not.toBeNull();
    const expectedBreakeven = shortStrike - result.combinedSignal!.netCredit;
    expect(result.combinedSignal!.breakeven).toBeCloseTo(expectedBreakeven, 10);
  });
});

describe('routeVerticalSpread — IV inference fallback', () => {
  const spot = 100;
  const T = 0.25;
  const r = 0.05;

  // Thalex-style quote: bid/ask prices but NO bidIv/askIv. Router should
  // still include it, using inferred IV from inverting BS on the price.
  const strikes: EnrichedStrike[] = [
    {
      strike: 95,
      call: {
        bestIv: 0.55,
        bestVenue: 'thalex',
        venues: {
          thalex: quote({
            bid: blackScholesCall(spot, 95, T, r, 0.55),
            ask: blackScholesCall(spot, 95, T, r, 0.57),
            markIv: 0.56,
            estimatedFees: { maker: 0, taker: 0.2 },
          }),
        },
      },
      put: { bestIv: null, bestVenue: null, venues: {} },
    },
    {
      strike: 105,
      call: {
        bestIv: 0.6,
        bestVenue: 'thalex',
        venues: {
          thalex: quote({
            bid: blackScholesCall(spot, 105, T, r, 0.58),
            ask: blackScholesCall(spot, 105, T, r, 0.6),
            markIv: 0.59,
            estimatedFees: { maker: 0, taker: 0.2 },
          }),
        },
      },
      put: { bestIv: null, bestVenue: null, venues: {} },
    },
  ];

  it('includes Thalex-like venues by inferring IV from price', () => {
    const result = routeVerticalSpread({
      kind: 'call-credit',
      shortStrike: 95,
      longStrike: 105,
      strikes,
      spot,
      T,
      r,
    });
    expect(result.short.best?.venue).toBe('thalex');
    expect(result.long.best?.venue).toBe('thalex');
    // Source-of-IV should be marked as inferred when bid/ask IV wasn't published.
    expect(result.short.best?.sourcedIv).toBe('inferred');
    expect(result.long.best?.sourcedIv).toBe('inferred');
    // Recovered σ should round-trip close to the σ we priced with.
    expect(result.short.best!.iv!).toBeCloseTo(0.55, 3);
    expect(result.long.best!.iv!).toBeCloseTo(0.6, 3);
  });
});

describe('routeVerticalSpread — strikeByKey parity', () => {
  const spot = 100;
  const T = 0.25;
  const r = 0.05;

  const strikes: EnrichedStrike[] = [
    {
      strike: 95,
      call: {
        bestIv: 0.55,
        bestVenue: 'deribit',
        venues: {
          deribit: quote({
            bid: blackScholesCall(spot, 95, T, r, 0.55),
            ask: blackScholesCall(spot, 95, T, r, 0.56),
            bidIv: 0.55,
            askIv: 0.56,
            markIv: 0.555,
            estimatedFees: { maker: 0, taker: 0.1 },
          }),
        },
      },
      put: { bestIv: null, bestVenue: null, venues: {} },
    },
    {
      strike: 105,
      call: {
        bestIv: 0.6,
        bestVenue: 'deribit',
        venues: {
          deribit: quote({
            bid: blackScholesCall(spot, 105, T, r, 0.58),
            ask: blackScholesCall(spot, 105, T, r, 0.6),
            bidIv: 0.58,
            askIv: 0.6,
            markIv: 0.59,
            estimatedFees: { maker: 0, taker: 0.1 },
          }),
        },
      },
      put: { bestIv: null, bestVenue: null, venues: {} },
    },
  ];

  it('produces identical results with and without precomputed strike map', () => {
    const baseline = routeVerticalSpread({
      kind: 'call-credit',
      shortStrike: 95,
      longStrike: 105,
      strikes,
      spot,
      T,
      r,
    });
    const byKey = new Map(strikes.map((s) => [s.strike, s]));
    const indexed = routeVerticalSpread({
      kind: 'call-credit',
      shortStrike: 95,
      longStrike: 105,
      strikes,
      strikeByKey: byKey,
      spot,
      T,
      r,
    });

    expect(indexed.combinedSignal?.netCredit).toBe(baseline.combinedSignal?.netCredit);
    expect(indexed.combinedSignal?.signal).toBe(baseline.combinedSignal?.signal);
    expect(indexed.short.best?.venue).toBe(baseline.short.best?.venue);
    expect(indexed.long.best?.venue).toBe(baseline.long.best?.venue);
  });

  it('returns empty candidates when a requested strike is absent from the map', () => {
    const byKey = new Map(strikes.map((s) => [s.strike, s]));
    const result = routeVerticalSpread({
      kind: 'call-credit',
      shortStrike: 123, // not in the map
      longStrike: 105,
      strikes,
      strikeByKey: byKey,
      spot,
      T,
      r,
    });
    expect(result.short.candidates).toHaveLength(0);
    expect(result.short.best).toBeNull();
  });
});

describe('routeVerticalSpread — EV / ROC fields', () => {
  const spot = 100;
  const T = 0.25;
  const r = 0.05;
  const shortStrike = 95;
  const longStrike = 105;
  const iv = 0.55;

  const strikes: EnrichedStrike[] = [
    {
      strike: shortStrike,
      call: {
        bestIv: iv,
        bestVenue: 'deribit',
        venues: {
          deribit: quote({
            bid: blackScholesCall(spot, shortStrike, T, r, iv),
            ask: blackScholesCall(spot, shortStrike, T, r, iv + 0.01),
            bidIv: iv,
            askIv: iv + 0.01,
            markIv: iv,
            estimatedFees: { maker: 0, taker: 0.05 },
          }),
        },
      },
      put: { bestIv: null, bestVenue: null, venues: {} },
    },
    {
      strike: longStrike,
      call: {
        bestIv: iv,
        bestVenue: 'deribit',
        venues: {
          deribit: quote({
            bid: blackScholesCall(spot, longStrike, T, r, iv - 0.01),
            ask: blackScholesCall(spot, longStrike, T, r, iv),
            bidIv: iv - 0.01,
            askIv: iv,
            markIv: iv,
            estimatedFees: { maker: 0, taker: 0.05 },
          }),
        },
      },
      put: { bestIv: null, bestVenue: null, venues: {} },
    },
  ];

  it('populates expectedValue and roc on the combined signal', () => {
    const result = routeVerticalSpread({ kind: 'call-credit', shortStrike, longStrike, strikes, spot, T, r });
    const sig = result.combinedSignal!;
    // EV = pop * credit - (1 - pop) * maxLoss
    const expected = sig.successProbability * sig.netCredit - (1 - sig.successProbability) * sig.maxLoss;
    expect(sig.expectedValue).toBeCloseTo(expected, 8);
    expect(sig.roc).toBeCloseTo(sig.expectedValue / sig.maxLoss, 8);
  });

  it('uses real-world POP when realWorld is supplied (drift/sigmaRV)', () => {
    const baseline = routeVerticalSpread({ kind: 'call-credit', shortStrike, longStrike, strikes, spot, T, r });
    const withRv = routeVerticalSpread({
      kind: 'call-credit',
      shortStrike,
      longStrike,
      strikes,
      spot,
      T,
      r,
      // RV well below IV → real-world POP should be HIGHER than risk-neutral.
      realWorld: { drift: 0, sigmaRV: 0.30 },
    });
    expect(withRv.combinedSignal!.probabilityMethod).toBe('real-world');
    expect(baseline.combinedSignal!.probabilityMethod).not.toBe('real-world');
    expect(withRv.combinedSignal!.successProbability).toBeGreaterThan(
      baseline.combinedSignal!.successProbability,
    );
  });

  it('gate AVOIDs a low-ROC trade even with positive credit and high pop', () => {
    // Put-credit spread: short 85 / long 75 with spot=100. Breakeven sits well
    // below spot, so a low realized vol drives POP near 1.
    // Credit=$0.05 on width=$10 → maxLoss=$9.95.
    // EV = 0.99·0.05 − 0.01·9.95 ≈ +$0.0505, ROC ≈ 0.51% — well under the 10% gate.
    const tinyCreditStrikes: EnrichedStrike[] = [
      {
        strike: 75,
        call: { bestIv: null, bestVenue: null, venues: {} },
        put: {
          bestIv: null,
          bestVenue: null,
          venues: {
            deribit: quote({
              bid: 0.20,
              ask: 0.25,
              bidIv: 0.40,
              askIv: 0.41,
              markIv: 0.40,
              estimatedFees: { maker: 0, taker: 0 },
            }),
          },
        },
      },
      {
        strike: 85,
        call: { bestIv: null, bestVenue: null, venues: {} },
        put: {
          bestIv: null,
          bestVenue: null,
          venues: {
            deribit: quote({
              bid: 0.30,
              ask: 0.35,
              bidIv: 0.40,
              askIv: 0.41,
              markIv: 0.40,
              estimatedFees: { maker: 0, taker: 0 },
            }),
          },
        },
      },
    ];
    const result = routeVerticalSpread({
      kind: 'put-credit',
      shortStrike: 85,
      longStrike: 75,
      strikes: tinyCreditStrikes,
      spot,
      T,
      r,
      // Drive POP deterministically via the real-world measure: low σ_RV +
      // breakeven well below spot ⇒ probability of profit near 1.
      realWorld: { drift: 0, sigmaRV: 0.10 },
    });
    const sig = result.combinedSignal!;
    expect(sig.probabilityMethod).toBe('real-world');
    expect(sig.successProbability).toBeGreaterThan(0.95);
    expect(sig.netCredit).toBeGreaterThan(0);
    expect(sig.netCredit).toBeLessThan(0.5);
    expect(sig.expectedValue).toBeGreaterThan(0);
    expect(sig.roc).toBeLessThan(0.1);
    expect(sig.signal).toBe('AVOID');
  });
});

describe('routeVerticalSpread — HOLD and signal gate', () => {
  const spot = 100;
  const T = 0.25;
  const r = 0.05;

  // Short leg with ZERO bid (no liquidity) → no executable premium → no signal.
  const strikes: EnrichedStrike[] = [
    {
      strike: 95,
      call: {
        bestIv: null,
        bestVenue: null,
        venues: {
          deribit: quote({
            bid: 0,
            ask: 5,
            markIv: 0.6,
            estimatedFees: { maker: 0, taker: 0.1 },
          }),
        },
      },
      put: { bestIv: null, bestVenue: null, venues: {} },
    },
    {
      strike: 105,
      call: {
        bestIv: null,
        bestVenue: null,
        venues: {
          deribit: quote({
            bid: 0,
            ask: 2,
            markIv: 0.55,
            estimatedFees: { maker: 0, taker: 0.1 },
          }),
        },
      },
      put: { bestIv: null, bestVenue: null, venues: {} },
    },
  ];

  it('returns a signal using modeled fallback when bid is zero', () => {
    const result = routeVerticalSpread({
      kind: 'call-credit',
      shortStrike: 95,
      longStrike: 105,
      strikes,
      spot,
      T,
      r,
    });
    // Even with zero bid, fallback to mark-priced IV gives a signal.
    expect(result.combinedSignal).not.toBeNull();
  });
});
