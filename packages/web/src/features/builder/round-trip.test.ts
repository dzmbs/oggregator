import { describe, expect, it } from 'vitest';
import type { VenueExecution, OrderSide } from './types';
import {
  classifyPerLeg,
  classifyStrategy,
  computeQuoteCost,
  computeStrategyRoundTrip,
  deriveAutoRouting,
  autoPickVenue,
  buildLegQuotes,
  type LegInput,
} from './round-trip';

function exec(overrides: Partial<VenueExecution> & Pick<VenueExecution, 'venue'>): VenueExecution {
  return {
    available: true,
    bidPrice: 100,
    askPrice: 102,
    markPrice: 101,
    bidSize: 10,
    askSize: 10,
    iv: 0.5,
    delta: 0.5,
    contractSize: 1,
    tickSize: 0.01,
    minQty: 0.01,
    makerFee: 0.0003,
    takerFee: 0.0005,
    settleCurrency: 'USD',
    inverse: false,
    underlyingPrice: 100_000,
    ...overrides,
  };
}

function legInput(
  legId: string,
  direction: OrderSide,
  quantity: number,
  venues: Array<{ venue: string; exec: VenueExecution }>,
): LegInput {
  return { legId, direction, quantity, venues };
}

describe('classifyPerLeg', () => {
  it('classifies thresholds at boundaries', () => {
    expect(classifyPerLeg(0)).toBe('ok');
    expect(classifyPerLeg(2)).toBe('ok');
    expect(classifyPerLeg(2.01)).toBe('elevated');
    expect(classifyPerLeg(5)).toBe('elevated');
    expect(classifyPerLeg(5.01)).toBe('high');
    expect(classifyPerLeg(7)).toBe('high');
    expect(classifyPerLeg(7.01)).toBe('excessive');
    expect(classifyPerLeg(50)).toBe('excessive');
  });
});

describe('classifyStrategy', () => {
  it('scales linearly by total quantity (per-contract classification)', () => {
    expect(classifyStrategy(4, 2, 2)).toBe('ok');
    expect(classifyStrategy(4.01, 2, 2)).toBe('elevated');
    expect(classifyStrategy(10, 2, 2)).toBe('elevated');
    expect(classifyStrategy(10.01, 2, 2)).toBe('high');
    expect(classifyStrategy(14, 2, 2)).toBe('high');
    expect(classifyStrategy(14.01, 2, 2)).toBe('excessive');
  });

  it('scales correctly for 4-leg condor', () => {
    expect(classifyStrategy(8, 4, 4)).toBe('ok');
    expect(classifyStrategy(20, 4, 4)).toBe('elevated');
    expect(classifyStrategy(28, 4, 4)).toBe('high');
    expect(classifyStrategy(28.01, 4, 4)).toBe('excessive');
  });

  it('returns ok for empty input', () => {
    expect(classifyStrategy(0, 0, 0)).toBe('ok');
  });
});

describe('computeQuoteCost', () => {
  it('computes round-trip for buy leg crossing ask, exiting at bid', () => {
    const v = exec({ venue: 'deribit', bidPrice: 100, askPrice: 102, takerFee: 0 });
    const cost = computeQuoteCost(v, 'buy', 1, 'leg1');

    expect(cost.entryPrice).toBe(102);
    expect(cost.exitPrice).toBe(100);
    expect(cost.spreadCostUsd).toBe(2);
    expect(cost.roundTripUsd).toBe(2);
    expect(cost.classification).toBe('ok');
  });

  it('round-trip is symmetric for sell direction', () => {
    const v = exec({ venue: 'deribit', bidPrice: 100, askPrice: 102, takerFee: 0 });
    const buy = computeQuoteCost(v, 'buy', 1, 'leg1');
    const sell = computeQuoteCost(v, 'sell', 1, 'leg1');
    expect(buy.roundTripUsd).toBe(sell.roundTripUsd);
  });

  it('includes entry and exit fees in round-trip', () => {
    const v = exec({ venue: 'deribit', bidPrice: 100, askPrice: 102, takerFee: 0.001 });
    const cost = computeQuoteCost(v, 'buy', 1, 'leg1');
    // spread 2 + entryFee 0.102 + exitFee 0.100 = 2.202
    expect(cost.entryFeeUsd).toBeCloseTo(0.102, 5);
    expect(cost.exitFeeUsd).toBeCloseTo(0.1, 5);
    expect(cost.roundTripUsd).toBeCloseTo(2.202, 5);
  });

  it('scales with quantity but classification stays per-contract', () => {
    const v = exec({ venue: 'deribit', bidPrice: 100, askPrice: 102, takerFee: 0 });
    const single = computeQuoteCost(v, 'buy', 1, 'leg1');
    const ten = computeQuoteCost(v, 'buy', 10, 'leg1');
    expect(ten.roundTripUsd).toBe(single.roundTripUsd! * 10);
    expect(ten.roundTripPerContract).toBe(single.roundTripPerContract);
    expect(ten.classification).toBe(single.classification);
  });

  it('flags unfillable when qty exceeds top-of-book size', () => {
    const v = exec({ venue: 'deribit', bidPrice: 100, askPrice: 102, askSize: 0.5 });
    const cost = computeQuoteCost(v, 'buy', 1, 'leg1');
    expect(cost.fillable).toBe(false);
    expect(cost.slippageWarning).toBe(true);
  });

  it('treats null size as fillability unknown (not blocking)', () => {
    const v = exec({ venue: 'deribit', askSize: null, bidSize: null });
    const cost = computeQuoteCost(v, 'buy', 1, 'leg1');
    expect(cost.fillable).toBe(true);
    expect(cost.slippageWarning).toBe(false);
  });

  it('returns null cost when entry price is missing', () => {
    const v = exec({ venue: 'deribit', askPrice: null });
    const cost = computeQuoteCost(v, 'buy', 1, 'leg1');
    expect(cost.roundTripUsd).toBeNull();
    expect(cost.classification).toBeNull();
    expect(cost.fillable).toBe(false);
  });

  it('classifies wide spread as excessive', () => {
    const v = exec({ venue: 'okx', bidPrice: 100, askPrice: 110, takerFee: 0 });
    const cost = computeQuoteCost(v, 'buy', 1, 'leg1');
    expect(cost.roundTripPerContract).toBe(10);
    expect(cost.classification).toBe('excessive');
  });
});

describe('autoPickVenue', () => {
  it('prefers fillable cheapest round-trip', () => {
    const leg = legInput('l1', 'buy', 1, [
      { venue: 'deribit', exec: exec({ venue: 'deribit', askPrice: 102, bidPrice: 100, askSize: 5 }) },
      { venue: 'okx', exec: exec({ venue: 'okx', askPrice: 101, bidPrice: 99, askSize: 0.1 }) },
    ]);
    const quotes = buildLegQuotes(leg);
    expect(autoPickVenue(quotes)).toBe('deribit');
  });

  it('falls back to best-effort when no venue is fillable', () => {
    const leg = legInput('l1', 'buy', 100, [
      { venue: 'deribit', exec: exec({ venue: 'deribit', askPrice: 110, bidPrice: 100, askSize: 1 }) },
      { venue: 'okx', exec: exec({ venue: 'okx', askPrice: 105, bidPrice: 100, askSize: 1 }) },
    ]);
    const quotes = buildLegQuotes(leg);
    expect(autoPickVenue(quotes)).toBe('okx');
  });

  it('returns null when no venue has a quote', () => {
    const leg = legInput('l1', 'buy', 1, [
      { venue: 'deribit', exec: exec({ venue: 'deribit', askPrice: null, bidPrice: null }) },
    ]);
    const quotes = buildLegQuotes(leg);
    expect(autoPickVenue(quotes)).toBeNull();
  });
});

describe('computeStrategyRoundTrip', () => {
  it('aggregates per-leg round-trips and classifies the strategy', () => {
    const legs: LegInput[] = [
      legInput('l1', 'buy', 1, [
        { venue: 'deribit', exec: exec({ venue: 'deribit', askPrice: 645, bidPrice: 640, takerFee: 0 }) },
      ]),
      legInput('l2', 'sell', 1, [
        { venue: 'deribit', exec: exec({ venue: 'deribit', askPrice: 280, bidPrice: 277, takerFee: 0 }) },
      ]),
    ];
    const routing = deriveAutoRouting(legs);
    const result = computeStrategyRoundTrip(legs, routing);

    expect(result.routable).toBe(true);
    expect(result.totalRoundTripUsd).toBeCloseTo(8, 5); // 5 + 3
    expect(result.strategyClassification).toBe('elevated'); // $5/contract worst leg is at ELEVATED upper bound
    expect(result.worstLeg?.legId).toBe('l1');
  });

  it('marks strategy unroutable when a leg has no quote', () => {
    const legs: LegInput[] = [
      legInput('l1', 'buy', 1, [
        { venue: 'deribit', exec: exec({ venue: 'deribit', askPrice: null, bidPrice: null }) },
      ]),
    ];
    const routing = deriveAutoRouting(legs);
    const result = computeStrategyRoundTrip(legs, routing);
    expect(result.routable).toBe(false);
    expect(result.strategyClassification).toBe('unroutable');
  });

  it('promotes strategy badge to worst leg when total averages down', () => {
    // 4 cheap legs + 1 toxic leg: linear-scaled total might be OK,
    // but the toxic leg should bubble up to the strategy verdict.
    const cheap = exec({ venue: 'deribit', askPrice: 100, bidPrice: 99.5, takerFee: 0 }); // $0.50/contract
    const toxic = exec({ venue: 'okx', askPrice: 100, bidPrice: 90, takerFee: 0 }); // $10/contract → excessive

    const legs: LegInput[] = [
      legInput('a', 'buy', 1, [{ venue: 'deribit', exec: cheap }]),
      legInput('b', 'buy', 1, [{ venue: 'deribit', exec: cheap }]),
      legInput('c', 'buy', 1, [{ venue: 'deribit', exec: cheap }]),
      legInput('d', 'buy', 1, [{ venue: 'deribit', exec: cheap }]),
      legInput('e', 'buy', 1, [{ venue: 'okx', exec: toxic }]),
    ];
    const routing = deriveAutoRouting(legs);
    const result = computeStrategyRoundTrip(legs, routing);

    // Total per contract: (0.5*4 + 10) / 5 = 2.4 → would classify as elevated linearly,
    // but worst leg is excessive → must bubble up.
    expect(result.strategyClassification).toBe('excessive');
    expect(result.worstLeg?.legId).toBe('e');
  });

  it('honors existing routing pin when venue still has quote', () => {
    const cheap = exec({ venue: 'deribit', askPrice: 100, bidPrice: 99 });
    const expensive = exec({ venue: 'okx', askPrice: 105, bidPrice: 95 });
    const legs: LegInput[] = [
      legInput('l1', 'buy', 1, [
        { venue: 'deribit', exec: cheap },
        { venue: 'okx', exec: expensive },
      ]),
    ];
    const routing = { legs: { l1: { venue: 'okx', pickedSide: 'ask' as const } } };
    const result = computeStrategyRoundTrip(legs, routing);
    expect(result.perLeg[0]!.venue).toBe('okx');
  });
});

describe('deriveAutoRouting', () => {
  it('picks best-fillable venue for each leg', () => {
    const legs: LegInput[] = [
      legInput('l1', 'buy', 1, [
        { venue: 'deribit', exec: exec({ venue: 'deribit', askPrice: 102, bidPrice: 100, askSize: 5 }) },
        { venue: 'okx', exec: exec({ venue: 'okx', askPrice: 101, bidPrice: 100, askSize: 0.1 }) },
      ]),
      legInput('l2', 'sell', 1, [
        { venue: 'deribit', exec: exec({ venue: 'deribit', askPrice: 50, bidPrice: 48, bidSize: 5 }) },
        { venue: 'okx', exec: exec({ venue: 'okx', askPrice: 50, bidPrice: 49, bidSize: 5 }) },
      ]),
    ];
    const routing = deriveAutoRouting(legs);
    expect(routing.legs.l1!.venue).toBe('deribit'); // okx has tighter price but unfillable
    expect(routing.legs.l2!.venue).toBe('okx'); // okx has higher bid (better for sell)
    expect(routing.legs.l1!.pickedSide).toBe('ask');
    expect(routing.legs.l2!.pickedSide).toBe('bid');
  });
});
