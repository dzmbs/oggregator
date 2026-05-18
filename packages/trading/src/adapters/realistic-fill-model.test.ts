import { describe, expect, it } from 'vitest';
import type { VenueId } from '@oggregator/core';
import type { QuoteBook } from '../gateways/quote-provider.js';
import { RealisticFillModel } from './realistic-fill-model.js';

function bookOf(overrides: Partial<QuoteBook>): QuoteBook {
  return {
    venue: 'deribit' as VenueId,
    bidUsd: 99,
    askUsd: 101,
    markUsd: 100,
    markIv: null,
    underlyingPriceUsd: 78_000,
    feesTakerUsd: 0,
    bidSize: null,
    askSize: null,
    ...overrides,
  };
}

describe('RealisticFillModel', () => {
  it('returns L1 with zero slippage when qty fits top size', () => {
    const model = new RealisticFillModel();
    const r = model.quote({
      side: 'buy',
      requestedQuantity: 2,
      book: bookOf({ askSize: 5 }),
    });
    expect(r.priceUsd).toBe(101);
    expect(r.slippageUsd).toBe(0);
    expect(r.filledQuantity).toBe(2);
    expect(r.partial).toBe(false);
  });

  it('walks L2 ladder for VWAP when qty exceeds top size', () => {
    const model = new RealisticFillModel();
    const r = model.quote({
      side: 'buy',
      requestedQuantity: 5,
      book: bookOf({
        askSize: 2,
        askLevels: [
          { priceUsd: 101, size: 2 },
          { priceUsd: 103, size: 3 },
        ],
      }),
    });
    // 2@101 + 3@103 = 511, vwap 102.2
    expect(r.priceUsd).toBeCloseTo(102.2, 4);
    expect(r.slippageUsd).toBeCloseTo(1.2, 4);
    expect(r.partial).toBe(false);
  });

  it('returns partial when ladder runs out', () => {
    const model = new RealisticFillModel();
    const r = model.quote({
      side: 'buy',
      requestedQuantity: 10,
      book: bookOf({
        askSize: 1,
        askLevels: [
          { priceUsd: 101, size: 1 },
          { priceUsd: 105, size: 1 },
        ],
      }),
    });
    expect(r.filledQuantity).toBe(2);
    expect(r.partial).toBe(true);
  });

  it('falls back to spread penalty when no L2 ladder available', () => {
    const model = new RealisticFillModel({ spreadPenaltyK: 1, maxSlippagePct: 0.5 });
    const r = model.quote({
      side: 'buy',
      requestedQuantity: 3,
      book: bookOf({ bidUsd: 99, askUsd: 101, askSize: 1 }),
    });
    // halfSpread = 1; overshoot = (3-1)/1 = 2; penalty = 1 * 1 * (1+2) = 3
    expect(r.priceUsd).toBeCloseTo(104, 6);
    expect(r.slippageUsd).toBeCloseTo(3, 6);
    expect(r.partial).toBe(false);
  });

  it('caps slippage at maxSlippagePct of reference', () => {
    const model = new RealisticFillModel({ spreadPenaltyK: 10, maxSlippagePct: 0.05 });
    const r = model.quote({
      side: 'buy',
      requestedQuantity: 100,
      book: bookOf({ bidUsd: 99, askUsd: 101, askSize: 1 }),
    });
    // 5% of 101 = 5.05
    expect(r.slippageUsd).toBeCloseTo(5.05, 4);
    expect(r.priceUsd).toBeCloseTo(106.05, 4);
  });

  it('returns zero fill when no reference price exists', () => {
    const model = new RealisticFillModel();
    const r = model.quote({
      side: 'buy',
      requestedQuantity: 1,
      book: bookOf({ askUsd: null }),
    });
    expect(r.filledQuantity).toBe(0);
    expect(r.partial).toBe(true);
  });

  it('sell side mirrors buy: penalty pushes price below bid', () => {
    const model = new RealisticFillModel({ spreadPenaltyK: 1, maxSlippagePct: 0.5 });
    const r = model.quote({
      side: 'sell',
      requestedQuantity: 3,
      book: bookOf({ bidUsd: 99, askUsd: 101, bidSize: 1 }),
    });
    expect(r.priceUsd).toBeCloseTo(96, 6);
    expect(r.slippageUsd).toBeCloseTo(3, 6);
  });

  it('uses assumedTopSize when venue feed has no L1 size', () => {
    const model = new RealisticFillModel({ assumedTopSizeWhenMissing: 2 });
    const r = model.quote({
      side: 'buy',
      requestedQuantity: 2,
      book: bookOf({ askSize: null }),
    });
    expect(r.slippageUsd).toBe(0);
    expect(r.priceUsd).toBe(101);
  });
});
