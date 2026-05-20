import { describe, expect, it } from 'vitest';
import {
  combineGex,
  computeGex,
  type EnrichedStrike,
  type GexStrike,
  type VenueQuote,
} from './enrichment.js';
import type { ComparisonRow, NormalizedOptionContract } from './types.js';
import type { VenueId } from '../types/common.js';

function venueQuote(partial: Partial<VenueQuote> = {}): VenueQuote {
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

function contract(
  venue: VenueId,
  overrides: {
    strike: number;
    right: 'call' | 'put';
    contractSize: number;
    venueSpotUsd: number;
    gamma?: number | null;
    openInterest?: number | null;
  },
): NormalizedOptionContract {
  return {
    venue,
    symbol: `${overrides.right}-${overrides.strike}`,
    exchangeSymbol: `${overrides.right}-${overrides.strike}`,
    base: 'BTC',
    settle: 'BTC',
    expiry: '2026-03-28',
    expiryTs: null,
    strike: overrides.strike,
    right: overrides.right,
    inverse: true,
    contractSize: overrides.contractSize,
    tickSize: null,
    minQty: null,
    makerFee: null,
    takerFee: null,
    greeks: {
      delta: null,
      gamma: overrides.gamma ?? null,
      theta: null,
      vega: null,
      rho: null,
      markIv: null,
      bidIv: null,
      askIv: null,
    },
    quote: {
      bid: { raw: null, rawCurrency: 'BTC', usd: null },
      ask: { raw: null, rawCurrency: 'BTC', usd: null },
      mark: { raw: null, rawCurrency: 'BTC', usd: null },
      last: null,
      bidSize: null,
      askSize: null,
      underlyingPriceUsd: overrides.venueSpotUsd,
      indexPriceUsd: overrides.venueSpotUsd,
      volume24h: null,
      openInterest: overrides.openInterest ?? null,
      openInterestUsd: null,
      volume24hUsd: null,
      estimatedFees: null,
      timestamp: 1,
      source: 'ws',
    },
  };
}

describe('computeGex — adversarial cases', () => {
  it('applies each venue\'s own contractSize when sizes differ at the same strike', () => {
    const STRIKE = 70_000;
    const SPOT = 70_000;
    // Two venues, same OI/gamma/spot, but different contractSize:
    //   deribit: size 1.0 (Deribit-style 1 BTC contract)
    //   coincall: size 0.01 (mini contract)
    // Expected: per-venue (OI × Γ × size × S²)/1e6 summed independently.
    //   deribit  = 10 × 0.001 × 1.0 × 70_000² / 1e6 = 49.0
    //   coincall = 10 × 0.001 × 0.01 × 70_000² / 1e6 = 0.49
    //   total call GEX = 49.49; no puts; expected ≈ 49.49
    const rows: ComparisonRow[] = [
      {
        strike: STRIKE,
        call: {
          deribit: contract('deribit', {
            strike: STRIKE,
            right: 'call',
            contractSize: 1.0,
            venueSpotUsd: SPOT,
            gamma: 0.001,
            openInterest: 10,
          }),
          coincall: contract('coincall', {
            strike: STRIKE,
            right: 'call',
            contractSize: 0.01,
            venueSpotUsd: SPOT,
            gamma: 0.001,
            openInterest: 10,
          }),
        },
        put: {},
      },
    ];

    const strikes: EnrichedStrike[] = [
      {
        strike: STRIKE,
        call: {
          bestIv: null,
          bestVenue: null,
          venues: {
            deribit: venueQuote({ openInterest: 10, gamma: 0.001 }),
            coincall: venueQuote({ openInterest: 10, gamma: 0.001 }),
          },
        },
        put: { bestIv: null, bestVenue: null, venues: {} },
      },
    ];

    const result = computeGex(rows, strikes, SPOT);
    expect(result).toHaveLength(1);
    expect(result[0]!.gexUsdMillions).toBeCloseTo(49.49, 6);
  });

  it('skips a venue with null gamma and keeps the contribution of the other venue at the same strike', () => {
    const STRIKE = 70_000;
    const SPOT = 70_000;
    // deribit has full data, okx has null gamma → only deribit should contribute.
    //   deribit = 5 × 0.002 × 1.0 × 70_000² / 1e6 = 49.0
    const rows: ComparisonRow[] = [
      {
        strike: STRIKE,
        call: {
          deribit: contract('deribit', {
            strike: STRIKE,
            right: 'call',
            contractSize: 1.0,
            venueSpotUsd: SPOT,
            gamma: 0.002,
            openInterest: 5,
          }),
          okx: contract('okx', {
            strike: STRIKE,
            right: 'call',
            contractSize: 0.01,
            venueSpotUsd: SPOT,
            gamma: null,
            openInterest: 1000,
          }),
        },
        put: {},
      },
    ];

    const strikes: EnrichedStrike[] = [
      {
        strike: STRIKE,
        call: {
          bestIv: null,
          bestVenue: null,
          venues: {
            deribit: venueQuote({ openInterest: 5, gamma: 0.002 }),
            okx: venueQuote({ openInterest: 1000, gamma: null }),
          },
        },
        put: { bestIv: null, bestVenue: null, venues: {} },
      },
    ];

    const result = computeGex(rows, strikes, SPOT);
    expect(result).toHaveLength(1);
    expect(result[0]!.gexUsdMillions).toBeCloseTo(49.0, 6);
  });

  it('skips a venue with null openInterest even when gamma is present', () => {
    const STRIKE = 70_000;
    const SPOT = 70_000;
    // bybit has gamma but no OI → no contribution. deribit contributes fully.
    const rows: ComparisonRow[] = [
      {
        strike: STRIKE,
        call: {
          deribit: contract('deribit', {
            strike: STRIKE,
            right: 'call',
            contractSize: 1.0,
            venueSpotUsd: SPOT,
            gamma: 0.001,
            openInterest: 10,
          }),
          bybit: contract('bybit', {
            strike: STRIKE,
            right: 'call',
            contractSize: 1.0,
            venueSpotUsd: SPOT,
            gamma: 0.001,
            openInterest: null,
          }),
        },
        put: {},
      },
    ];

    const strikes: EnrichedStrike[] = [
      {
        strike: STRIKE,
        call: {
          bestIv: null,
          bestVenue: null,
          venues: {
            deribit: venueQuote({ openInterest: 10, gamma: 0.001 }),
            bybit: venueQuote({ openInterest: null, gamma: 0.001 }),
          },
        },
        put: { bestIv: null, bestVenue: null, venues: {} },
      },
    ];

    const result = computeGex(rows, strikes, SPOT);
    expect(result[0]!.gexUsdMillions).toBeCloseTo(49.0, 6);
  });

  it('returns 0 GEX for a strike where every venue has either null OI or null gamma', () => {
    const STRIKE = 70_000;
    const SPOT = 70_000;
    const rows: ComparisonRow[] = [
      {
        strike: STRIKE,
        call: {
          deribit: contract('deribit', {
            strike: STRIKE,
            right: 'call',
            contractSize: 1.0,
            venueSpotUsd: SPOT,
            gamma: null,
            openInterest: 10,
          }),
          okx: contract('okx', {
            strike: STRIKE,
            right: 'call',
            contractSize: 1.0,
            venueSpotUsd: SPOT,
            gamma: 0.001,
            openInterest: null,
          }),
        },
        put: {},
      },
    ];

    const strikes: EnrichedStrike[] = [
      {
        strike: STRIKE,
        call: {
          bestIv: null,
          bestVenue: null,
          venues: {
            deribit: venueQuote({ openInterest: 10, gamma: null }),
            okx: venueQuote({ openInterest: null, gamma: 0.001 }),
          },
        },
        put: { bestIv: null, bestVenue: null, venues: {} },
      },
    ];

    const result = computeGex(rows, strikes, SPOT);
    expect(result).toHaveLength(1);
    expect(result[0]!.gexUsdMillions).toBe(0);
  });

  it('uses each venue\'s own spot (not the fallback) when venues report different index prices', () => {
    const STRIKE = 70_000;
    const FALLBACK_SPOT = 60_000; // intentionally wrong — should be ignored
    // deribit reports spot = 70_000, okx reports spot = 71_000.
    //   deribit call:  10 × 0.001 × 1.0 × 70_000² / 1e6 = 49.0
    //   okx call:      20 × 0.001 × 0.01 × 71_000² / 1e6 ≈ 1.0082
    //   total ≈ 50.0082
    const rows: ComparisonRow[] = [
      {
        strike: STRIKE,
        call: {
          deribit: contract('deribit', {
            strike: STRIKE,
            right: 'call',
            contractSize: 1.0,
            venueSpotUsd: 70_000,
            gamma: 0.001,
            openInterest: 10,
          }),
          okx: contract('okx', {
            strike: STRIKE,
            right: 'call',
            contractSize: 0.01,
            venueSpotUsd: 71_000,
            gamma: 0.001,
            openInterest: 20,
          }),
        },
        put: {},
      },
    ];

    const strikes: EnrichedStrike[] = [
      {
        strike: STRIKE,
        call: {
          bestIv: null,
          bestVenue: null,
          venues: {
            deribit: venueQuote({ openInterest: 10, gamma: 0.001 }),
            okx: venueQuote({ openInterest: 20, gamma: 0.001 }),
          },
        },
        put: { bestIv: null, bestVenue: null, venues: {} },
      },
    ];

    const result = computeGex(rows, strikes, FALLBACK_SPOT);
    expect(result[0]!.gexUsdMillions).toBeCloseTo(50.0082, 4);
  });

  it('falls back to spot only when a venue is missing both index and underlying price', () => {
    const STRIKE = 70_000;
    const FALLBACK_SPOT = 70_000;
    const baseRow = contract('deribit', {
      strike: STRIKE,
      right: 'call',
      contractSize: 1.0,
      venueSpotUsd: 0,
      gamma: 0.001,
      openInterest: 10,
    });
    // Null out the index/underlying so the function must fall back.
    baseRow.quote.indexPriceUsd = null;
    baseRow.quote.underlyingPriceUsd = null;

    const rows: ComparisonRow[] = [{ strike: STRIKE, call: { deribit: baseRow }, put: {} }];

    const strikes: EnrichedStrike[] = [
      {
        strike: STRIKE,
        call: {
          bestIv: null,
          bestVenue: null,
          venues: { deribit: venueQuote({ openInterest: 10, gamma: 0.001 }) },
        },
        put: { bestIv: null, bestVenue: null, venues: {} },
      },
    ];

    const result = computeGex(rows, strikes, FALLBACK_SPOT);
    // 10 × 0.001 × 1.0 × 70_000² / 1e6 = 49.0 using the fallback.
    expect(result[0]!.gexUsdMillions).toBeCloseTo(49.0, 6);
  });

  it('subtracts put gamma from call gamma with the standard sign convention', () => {
    const STRIKE = 70_000;
    const SPOT = 70_000;
    const callRow = contract('deribit', {
      strike: STRIKE,
      right: 'call',
      contractSize: 1.0,
      venueSpotUsd: SPOT,
      gamma: 0.001,
      openInterest: 10,
    });
    const putRow = contract('deribit', {
      strike: STRIKE,
      right: 'put',
      contractSize: 1.0,
      venueSpotUsd: SPOT,
      gamma: 0.001,
      openInterest: 30,
    });

    const rows: ComparisonRow[] = [
      { strike: STRIKE, call: { deribit: callRow }, put: { deribit: putRow } },
    ];

    const strikes: EnrichedStrike[] = [
      {
        strike: STRIKE,
        call: {
          bestIv: null,
          bestVenue: null,
          venues: { deribit: venueQuote({ openInterest: 10, gamma: 0.001 }) },
        },
        put: {
          bestIv: null,
          bestVenue: null,
          venues: { deribit: venueQuote({ openInterest: 30, gamma: 0.001 }) },
        },
      },
    ];

    const result = computeGex(rows, strikes, SPOT);
    // call = 49, put = 147 → net = -98
    expect(result[0]!.gexUsdMillions).toBeCloseTo(-98.0, 6);
  });
});

describe('combineGex', () => {
  it('returns an empty list when given no expiries', () => {
    expect(combineGex([])).toEqual([]);
  });

  it('returns an empty list when every expiry is empty', () => {
    expect(combineGex([[], [], []])).toEqual([]);
  });

  it('sums values at matching strikes across expiries', () => {
    const a: GexStrike[] = [
      { strike: 70_000, gexUsdMillions: 100 },
      { strike: 75_000, gexUsdMillions: -50 },
    ];
    const b: GexStrike[] = [
      { strike: 70_000, gexUsdMillions: 25 },
      { strike: 75_000, gexUsdMillions: -10 },
    ];

    expect(combineGex([a, b])).toEqual([
      { strike: 70_000, gexUsdMillions: 125 },
      { strike: 75_000, gexUsdMillions: -60 },
    ]);
  });

  it('unions non-overlapping strikes and sorts the result ascending', () => {
    const a: GexStrike[] = [{ strike: 80_000, gexUsdMillions: 10 }];
    const b: GexStrike[] = [{ strike: 70_000, gexUsdMillions: -5 }];
    const c: GexStrike[] = [{ strike: 75_000, gexUsdMillions: 2 }];

    expect(combineGex([a, b, c])).toEqual([
      { strike: 70_000, gexUsdMillions: -5 },
      { strike: 75_000, gexUsdMillions: 2 },
      { strike: 80_000, gexUsdMillions: 10 },
    ]);
  });

  it('preserves sign when positive and negative contributions overlap', () => {
    const a: GexStrike[] = [{ strike: 70_000, gexUsdMillions: 100 }];
    const b: GexStrike[] = [{ strike: 70_000, gexUsdMillions: -120 }];

    expect(combineGex([a, b])).toEqual([{ strike: 70_000, gexUsdMillions: -20 }]);
  });

  it('passes a single expiry through unchanged (after sort)', () => {
    const input: GexStrike[] = [
      { strike: 75_000, gexUsdMillions: 50 },
      { strike: 70_000, gexUsdMillions: 100 },
    ];

    expect(combineGex([input])).toEqual([
      { strike: 70_000, gexUsdMillions: 100 },
      { strike: 75_000, gexUsdMillions: 50 },
    ]);
  });
});
