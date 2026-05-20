import { describe, expect, it } from 'vitest';
import {
  computeChainStats,
  computeDte,
  computeGex,
  computeIvSurface,
  computeIvSurfaceFine,
  computeSmile,
  computeTermStructure,
  FINE_DELTA_GRID,
  type EnrichedStrike,
  type VenueQuote,
} from './enrichment.js';
import type { ComparisonRow, VenueOptionChain } from './types.js';

function createVenueQuote(partial: Partial<VenueQuote> = {}): VenueQuote {
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

function createStrike(strike: number): EnrichedStrike {
  return {
    strike,
    call: { bestIv: null, bestVenue: null, venues: {} },
    put: { bestIv: null, bestVenue: null, venues: {} },
  };
}

describe('enrichment', () => {
  it('classifies term structure using fraction-space IV thresholds', () => {
    expect(
      computeTermStructure([
        {
          expiry: '2026-04-03',
          dte: 7,
          atm: 0.49,
          delta10p: null,
          delta25p: null,
          delta25c: null,
          delta10c: null,
        },
        {
          expiry: '2026-06-26',
          dte: 91,
          atm: 0.53,
          delta10p: null,
          delta25p: null,
          delta25c: null,
          delta10c: null,
        },
      ]),
    ).toBe('contango');

    expect(
      computeTermStructure([
        {
          expiry: '2026-04-03',
          dte: 7,
          atm: 0.55,
          delta10p: null,
          delta25p: null,
          delta25c: null,
          delta10c: null,
        },
        {
          expiry: '2026-06-26',
          dte: 91,
          atm: 0.51,
          delta10p: null,
          delta25p: null,
          delta25c: null,
          delta10c: null,
        },
      ]),
    ).toBe('backwardation');
  });

  it('keeps spot and index prices in the correct buckets', () => {
    const venueChains: VenueOptionChain[] = [
      {
        venue: 'binance',
        underlying: 'BTC',
        expiry: '2026-03-28',
        asOf: 1,
        contracts: {
          'BTC/USDT:BTC-260328-60000-C': {
            venue: 'binance',
            symbol: 'BTC/USDT:BTC-260328-60000-C',
            exchangeSymbol: 'BTC-260328-60000-C',
            base: 'BTC',
            settle: 'USDT',
            expiry: '2026-03-28',
            expiryTs: null,
            strike: 60_000,
            right: 'call',
            inverse: false,
            contractSize: 1,
            tickSize: 0.1,
            minQty: 0.1,
            makerFee: 0.0002,
            takerFee: 0.0005,
            greeks: {
              delta: null,
              gamma: null,
              theta: null,
              vega: null,
              rho: null,
              markIv: 0.5,
              bidIv: null,
              askIv: null,
            },
            quote: {
              bid: { raw: 100, rawCurrency: 'USDT', usd: 100 },
              ask: { raw: 110, rawCurrency: 'USDT', usd: 110 },
              mark: { raw: 105, rawCurrency: 'USDT', usd: 105 },
              last: null,
              bidSize: 1,
              askSize: 1,
              underlyingPriceUsd: 66_000,
              indexPriceUsd: 65_500,
              volume24h: 10,
              openInterest: 20,
              openInterestUsd: 1_310_000,
              volume24hUsd: 655_000,
              estimatedFees: null,
              timestamp: 1,
              source: 'ws',
            },
          },
        },
      },
    ];

    const stats = computeChainStats([createStrike(60_000)], venueChains);

    expect(stats.forwardPriceUsd).toBe(66_000);
    expect(stats.indexPriceUsd).toBe(65_500);
  });

  it('computes GEX using each venue quote and contract size', () => {
    const rows: ComparisonRow[] = [
      {
        strike: 70_000,
        call: {
          deribit: {
            venue: 'deribit',
            symbol: 'BTC/USD:BTC-260328-70000-C',
            exchangeSymbol: 'BTC-260328-70000-C',
            base: 'BTC',
            settle: 'BTC',
            expiry: '2026-03-28',
            expiryTs: null,
            strike: 70_000,
            right: 'call',
            inverse: true,
            contractSize: 2,
            tickSize: null,
            minQty: null,
            makerFee: null,
            takerFee: null,
            greeks: {
              delta: null,
              gamma: 0.01,
              theta: null,
              vega: null,
              rho: null,
              markIv: 0.5,
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
              underlyingPriceUsd: 69_000,
              indexPriceUsd: 70_000,
              volume24h: null,
              openInterest: 10,
              openInterestUsd: null,
              volume24hUsd: null,
              estimatedFees: null,
              timestamp: 1,
              source: 'ws',
            },
          },
        },
        put: {
          deribit: {
            venue: 'deribit',
            symbol: 'BTC/USD:BTC-260328-70000-P',
            exchangeSymbol: 'BTC-260328-70000-P',
            base: 'BTC',
            settle: 'BTC',
            expiry: '2026-03-28',
            expiryTs: null,
            strike: 70_000,
            right: 'put',
            inverse: true,
            contractSize: 2,
            tickSize: null,
            minQty: null,
            makerFee: null,
            takerFee: null,
            greeks: {
              delta: null,
              gamma: 0.005,
              theta: null,
              vega: null,
              rho: null,
              markIv: 0.52,
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
              underlyingPriceUsd: 69_000,
              indexPriceUsd: 70_000,
              volume24h: null,
              openInterest: 5,
              openInterestUsd: null,
              volume24hUsd: null,
              estimatedFees: null,
              timestamp: 1,
              source: 'ws',
            },
          },
        },
      },
    ];

    const strikes: EnrichedStrike[] = [
      {
        strike: 70_000,
        call: {
          bestIv: 0.5,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ openInterest: 10, gamma: 0.01 }) },
        },
        put: {
          bestIv: 0.52,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ openInterest: 5, gamma: 0.005 }) },
        },
      },
    ];

    const gex = computeGex(rows, strikes, 65_000);
    expect(gex).toHaveLength(1);
    expect(gex[0]!.gexUsdMillions).toBeCloseTo(735, 6);
  });

  it('computes OKX inverse GEX from contract-count OI without double-applying ctMult', () => {
    const rows: ComparisonRow[] = [
      {
        strike: 58_000,
        call: {
          okx: {
            venue: 'okx',
            symbol: 'BTC/USD:BTC-260330-58000-C',
            exchangeSymbol: 'BTC-USD-260330-58000-C',
            base: 'BTC',
            settle: 'BTC',
            expiry: '2026-03-30',
            expiryTs: null,
            strike: 58_000,
            right: 'call',
            inverse: true,
            contractSize: 0.01,
            tickSize: null,
            minQty: null,
            makerFee: null,
            takerFee: null,
            greeks: {
              delta: null,
              gamma: 0.01,
              theta: null,
              vega: null,
              rho: null,
              markIv: 0.5,
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
              underlyingPriceUsd: 67_000,
              indexPriceUsd: 67_000,
              volume24h: null,
              openInterest: 275,
              openInterestUsd: null,
              volume24hUsd: null,
              estimatedFees: null,
              timestamp: 1,
              source: 'ws',
            },
          },
        },
        put: {},
      },
    ];

    const strikes: EnrichedStrike[] = [
      {
        strike: 58_000,
        call: {
          bestIv: 0.5,
          bestVenue: 'okx',
          venues: { okx: createVenueQuote({ openInterest: 275, gamma: 0.01 }) },
        },
        put: { bestIv: null, bestVenue: null, venues: {} },
      },
    ];

    const gex = computeGex(rows, strikes, 67_000);
    expect(gex[0]!.gexUsdMillions).toBeCloseTo(123.4475, 6);
  });

  it('builds IV surface points from price-based ATM and nearest strikes to target deltas', () => {
    const strikes: EnrichedStrike[] = [
      {
        strike: 60_000,
        call: {
          bestIv: 0.7,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: 0.1, markIv: 0.7 }) },
        },
        put: {
          bestIv: 0.8,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: -0.1, markIv: 0.8 }) },
        },
      },
      {
        strike: 65_000,
        call: {
          bestIv: 0.6,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: 0.25, markIv: 0.6 }) },
        },
        put: {
          bestIv: 0.65,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: -0.25, markIv: 0.65 }) },
        },
      },
      {
        strike: 70_000,
        call: {
          bestIv: 0.5,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: 0.5, markIv: 0.5 }) },
        },
        put: {
          bestIv: 0.55,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: -0.5, markIv: 0.55 }) },
        },
      },
    ];

    const surface = computeIvSurface('2026-03-28', 7, strikes, 69_800);
    expect(surface.atm).toBe(0.5);
    expect(surface.delta25c).toBe(0.6);
    expect(surface.delta10c).toBe(0.7);
    expect(surface.delta25p).toBe(0.65);
    expect(surface.delta10p).toBe(0.8);
  });

  it('builds the fine 19-bucket surface with OTM-only side filtering', () => {
    const strikes: EnrichedStrike[] = [
      {
        strike: 60_000,
        call: {
          bestIv: 0.7,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: 0.1, markIv: 0.7 }) },
        },
        put: {
          // ITM put at this strike (|δ|=0.9) — must NOT pollute the call wing.
          bestIv: 0.95,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: -0.9, markIv: 0.95 }) },
        },
      },
      {
        strike: 70_000,
        call: {
          bestIv: 0.5,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: 0.5, markIv: 0.5 }) },
        },
        put: {
          bestIv: 0.55,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: -0.5, markIv: 0.55 }) },
        },
      },
      {
        strike: 80_000,
        call: {
          // ITM call (δ=0.9) — must NOT pollute the put wing at x=0.10.
          bestIv: 0.95,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: 0.9, markIv: 0.95 }) },
        },
        put: {
          bestIv: 0.7,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: -0.1, markIv: 0.7 }) },
        },
      },
    ];

    const fine = computeIvSurfaceFine('2026-03-28', 7, strikes);
    expect(fine.expiry).toBe('2026-03-28');
    expect(fine.dte).toBe(7);
    expect(fine.ivs).toHaveLength(FINE_DELTA_GRID.length);

    const at = (target: number) =>
      fine.ivs[FINE_DELTA_GRID.findIndex((d) => Math.abs(d - target) < 1e-9)] ?? null;

    // OTM call δ=0.10 → bucket 1−0.10 = 0.90.
    expect(at(0.9)).toBeCloseTo(0.7, 6);
    // OTM put δ=−0.10 → bucket |δ| = 0.10.
    expect(at(0.1)).toBeCloseTo(0.7, 6);
    // ATM put and ATM call (δ=±0.5) both land at 0.50 — averaged.
    expect(at(0.5)).toBeCloseTo((0.5 + 0.55) / 2, 6);
    // ITM legs were dropped: 0.95 must not appear anywhere on the grid.
    expect(fine.ivs.every((v) => v == null || v <= 0.8)).toBe(true);
  });

  it('rejects out-of-range fine-surface IVs (zero, negative, NaN, > 5)', () => {
    const strikes: EnrichedStrike[] = [
      {
        strike: 60_000,
        call: {
          bestIv: null,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: 0.1, markIv: 0 }) },
        },
        put: {
          bestIv: null,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: -0.1, markIv: 99 }) },
        },
      },
    ];
    const fine = computeIvSurfaceFine('2026-03-28', 7, strikes);
    // Both quotes were invalid → grid is all-null.
    expect(fine.ivs.every((v) => v == null)).toBe(true);
  });

  it('returns null surface points when no strike is close to the target delta', () => {
    const strikes: EnrichedStrike[] = [
      {
        strike: 60_000,
        call: {
          bestIv: 0.7,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: 0.9, markIv: 0.7 }) },
        },
        put: {
          bestIv: 0.8,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ delta: -0.9, markIv: 0.8 }) },
        },
      },
    ];

    const surface = computeIvSurface('2026-03-28', 7, strikes);
    expect(surface.delta25c).toBeNull();
    expect(surface.delta25p).toBeNull();
    expect(surface.delta10c).toBeNull();
    expect(surface.delta10p).toBeNull();
  });

  it('computes DTE relative to the 08:00 UTC expiry convention', () => {
    const now = new Date('2026-03-27T09:00:00Z').getTime();
    const realNow = Date.now;
    Date.now = () => now;

    try {
      expect(computeDte('2026-03-28')).toBe(1);
      expect(computeDte('2026-03-29')).toBe(2);
    } finally {
      Date.now = realNow;
    }
  });

  it('uses the same price-based ATM strike for chain stats and IV surface ATM', () => {
    const strikes: EnrichedStrike[] = [
      {
        strike: 67_000,
        call: {
          bestIv: 0.55,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ markIv: 0.55, delta: 0.8 }) },
        },
        put: {
          bestIv: 0.6,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ markIv: 0.6, delta: -0.2 }) },
        },
      },
      {
        strike: 70_000,
        call: {
          bestIv: 0.5,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ markIv: 0.5, delta: 0.5 }) },
        },
        put: {
          bestIv: 0.65,
          bestVenue: 'deribit',
          venues: { deribit: createVenueQuote({ markIv: 0.65, delta: -0.5 }) },
        },
      },
    ];

    const venueChains: VenueOptionChain[] = [
      {
        venue: 'deribit',
        underlying: 'BTC',
        expiry: '2026-03-28',
        asOf: 1,
        contracts: {
          'BTC/USD:BTC-260328-67000-C': {
            venue: 'deribit',
            symbol: 'BTC/USD:BTC-260328-67000-C',
            exchangeSymbol: 'BTC-260328-67000-C',
            base: 'BTC',
            settle: 'BTC',
            expiry: '2026-03-28',
            expiryTs: null,
            strike: 67_000,
            right: 'call',
            inverse: true,
            contractSize: 1,
            tickSize: null,
            minQty: null,
            makerFee: null,
            takerFee: null,
            greeks: {
              delta: 0.8,
              gamma: null,
              theta: null,
              vega: null,
              rho: null,
              markIv: 0.55,
              bidIv: null,
              askIv: null,
            },
            quote: {
              bid: { raw: 0.01, rawCurrency: 'BTC', usd: 670 },
              ask: { raw: 0.011, rawCurrency: 'BTC', usd: 737 },
              mark: { raw: 0.0105, rawCurrency: 'BTC', usd: 703.5 },
              last: null,
              bidSize: 1,
              askSize: 1,
              underlyingPriceUsd: 67_000,
              indexPriceUsd: 67_200,
              volume24h: 10,
              openInterest: 10,
              openInterestUsd: 670_000,
              volume24hUsd: null,
              estimatedFees: null,
              timestamp: 1,
              source: 'ws',
            },
          },
        },
      },
    ];

    const stats = computeChainStats(strikes, venueChains);
    const surface = computeIvSurface(
      '2026-03-28',
      7,
      strikes,
      stats.indexPriceUsd ?? stats.forwardPriceUsd,
    );

    expect(stats.atmStrike).toBe(67_000);
    expect(surface.atm).toBe(0.55);
  });

  it('computes ATM IV, put/call OI ratio, total OI, and skew from enriched strikes', () => {
    const strikes: EnrichedStrike[] = [
      {
        strike: 69_000,
        call: {
          bestIv: 0.62,
          bestVenue: 'deribit',
          venues: {
            deribit: createVenueQuote({
              markIv: 0.62,
              openInterest: 2,
              openInterestUsd: 140_000,
              delta: 0.62,
            }),
          },
        },
        put: {
          bestIv: 0.7,
          bestVenue: 'deribit',
          venues: {
            deribit: createVenueQuote({
              markIv: 0.7,
              openInterest: 3,
              openInterestUsd: 210_000,
              delta: -0.38,
            }),
          },
        },
      },
      {
        strike: 70_000,
        call: {
          bestIv: 0.5,
          bestVenue: 'deribit',
          venues: {
            deribit: createVenueQuote({
              markIv: 0.5,
              openInterest: 4,
              openInterestUsd: 280_000,
              delta: 0.5,
            }),
          },
        },
        put: {
          bestIv: 0.58,
          bestVenue: 'deribit',
          venues: {
            deribit: createVenueQuote({
              markIv: 0.58,
              openInterest: 6,
              openInterestUsd: 420_000,
              delta: -0.5,
            }),
          },
        },
      },
      {
        strike: 71_000,
        call: {
          bestIv: 0.45,
          bestVenue: 'deribit',
          venues: {
            deribit: createVenueQuote({
              markIv: 0.45,
              openInterest: 4,
              openInterestUsd: 280_000,
              delta: 0.25,
            }),
          },
        },
        put: {
          bestIv: 0.6,
          bestVenue: 'deribit',
          venues: {
            deribit: createVenueQuote({
              markIv: 0.6,
              openInterest: 5,
              openInterestUsd: 350_000,
              delta: -0.25,
            }),
          },
        },
      },
    ];

    const venueChains: VenueOptionChain[] = [
      {
        venue: 'deribit',
        underlying: 'BTC',
        expiry: '2026-03-28',
        asOf: 1,
        contracts: {
          'BTC/USD:BTC-260328-70000-C': {
            venue: 'deribit',
            symbol: 'BTC/USD:BTC-260328-70000-C',
            exchangeSymbol: 'BTC-260328-70000-C',
            base: 'BTC',
            settle: 'BTC',
            expiry: '2026-03-28',
            expiryTs: null,
            strike: 70_000,
            right: 'call',
            inverse: true,
            contractSize: 1,
            tickSize: null,
            minQty: null,
            makerFee: null,
            takerFee: null,
            greeks: {
              delta: 0.5,
              gamma: null,
              theta: null,
              vega: null,
              rho: null,
              markIv: 0.5,
              bidIv: null,
              askIv: null,
            },
            quote: {
              bid: { raw: 0.01, rawCurrency: 'BTC', usd: 700 },
              ask: { raw: 0.011, rawCurrency: 'BTC', usd: 770 },
              mark: { raw: 0.0105, rawCurrency: 'BTC', usd: 735 },
              last: null,
              bidSize: 1,
              askSize: 1,
              underlyingPriceUsd: 70_000,
              indexPriceUsd: 69_800,
              volume24h: 10,
              openInterest: 10,
              openInterestUsd: 1_000_000,
              volume24hUsd: null,
              estimatedFees: null,
              timestamp: 1,
              source: 'ws',
            },
          },
        },
      },
    ];

    const stats = computeChainStats(strikes, venueChains);

    expect(stats.atmStrike).toBe(70_000);
    expect(stats.atmIv).toBe(0.5);
    expect(stats.putCallOiRatio).toBeCloseTo(1.4, 6);
    expect(stats.totalOiUsd).toBe(1_680_000);
    expect(stats.skew25d).toBeCloseTo(-0.15, 6);
  });

  it('computeSmile emits per-strike OTM-blended IV with interpolated ATM + skew', () => {
    const side = (iv: number | null) => ({
      bestIv: iv,
      bestVenue: 'deribit' as const,
      venues: { deribit: createVenueQuote({ markIv: iv }) },
    });
    const strikes: EnrichedStrike[] = [
      { strike: 90, call: side(0.8), put: side(0.75) },
      { strike: 100, call: side(0.65), put: side(0.65) },
      { strike: 110, call: side(0.7), put: side(0.85) },
    ];

    const smile = computeSmile(strikes, 100);

    expect(smile.points.map((p) => p.blendedIv)).toEqual([0.75, 0.65, 0.7]);
    expect(smile.points.map((p) => p.moneyness)).toEqual([0.9, 1.0, 1.1]);
    expect(smile.atmIv).toBe(0.65);
    expect(smile.skew!).toBeCloseTo((0.75 - 0.7) / 0.65, 10);
  });

  // Strike grid centered on spot=100 with the ATM blend window at ±2.5% (97.5..102.5).
  // Asymmetric put/call IVs verify the linear seam-blend rather than a hard switch.
  it('computeSmile linearly blends put/call IVs inside the ±2.5% ATM window', () => {
    const side = (iv: number | null) => ({
      bestIv: iv,
      bestVenue: 'deribit' as const,
      venues: { deribit: createVenueQuote({ markIv: iv }) },
    });
    const strikes: EnrichedStrike[] = [
      { strike: 95, call: side(0.7), put: side(0.55) }, // outside, below → put
      { strike: 99, call: side(0.68), put: side(0.62) }, // inside, w=0.3
      { strike: 100, call: side(0.66), put: side(0.6) }, // inside, w=0.5
      { strike: 101, call: side(0.65), put: side(0.59) }, // inside, w=0.7
      { strike: 105, call: side(0.62), put: side(0.5) }, // outside, above → call
    ];

    const smile = computeSmile(strikes, 100);

    expect(smile.points[0]!.blendedIv).toBeCloseTo(0.55, 10);
    expect(smile.points[4]!.blendedIv).toBeCloseTo(0.62, 10);
    expect(smile.points[1]!.blendedIv).toBeCloseTo(0.7 * 0.62 + 0.3 * 0.68, 10);
    expect(smile.points[2]!.blendedIv).toBeCloseTo(0.5 * 0.6 + 0.5 * 0.66, 10);
    expect(smile.points[3]!.blendedIv).toBeCloseTo(0.3 * 0.59 + 0.7 * 0.65, 10);
  });
});
