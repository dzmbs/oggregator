import { describe, it, expect } from 'vitest';
import { pickPriceFormat, priceFormatFromSeries } from './chart-precision.js';

describe('pickPriceFormat', () => {
  it('returns 2-decimal default for empty / non-finite / zero inputs', () => {
    expect(pickPriceFormat(0)).toEqual({ precision: 2, minMove: 0.01 });
    expect(pickPriceFormat(Number.NaN)).toEqual({ precision: 2, minMove: 0.01 });
    expect(pickPriceFormat(Number.POSITIVE_INFINITY)).toEqual({ precision: 2, minMove: 0.01 });
  });

  it('uses 2 decimals for >= $1000 (BTC notional, USDT options near $1k)', () => {
    expect(pickPriceFormat(5829.07)).toEqual({ precision: 2, minMove: 0.01 });
    expect(pickPriceFormat(1000)).toEqual({ precision: 2, minMove: 0.01 });
  });

  it('uses 4 decimals for $1–$999 (Deribit inverse BTC ~0.07 BTC, mid-priced USDT)', () => {
    expect(pickPriceFormat(75)).toEqual({ precision: 4, minMove: 0.0001 });
    expect(pickPriceFormat(1)).toEqual({ precision: 4, minMove: 0.0001 });
  });

  it('uses 5 decimals for $0.01–$0.99 (LIT/KAS $0.85-strike calls in cents)', () => {
    // 0.069 BTC (Deribit inverse) — without this tier the y-axis would show
    // all bars as "0.07" rounding away every move >= 0.0001 BTC.
    expect(pickPriceFormat(0.069)).toEqual({ precision: 5, minMove: 0.00001 });
    expect(pickPriceFormat(0.369)).toEqual({ precision: 5, minMove: 0.00001 });
    expect(pickPriceFormat(0.01)).toEqual({ precision: 5, minMove: 0.00001 });
  });

  it('uses 6 decimals for $0.0001–$0.0099 (sub-cent USDT option premiums)', () => {
    expect(pickPriceFormat(0.005)).toEqual({ precision: 6, minMove: 0.000001 });
    expect(pickPriceFormat(0.0001)).toEqual({ precision: 6, minMove: 0.000001 });
  });

  it('uses 8 decimals for ultra-tiny premiums', () => {
    expect(pickPriceFormat(0.00005)).toEqual({ precision: 8, minMove: 0.00000001 });
  });
});

describe('priceFormatFromSeries', () => {
  it('picks tier from the larger of candle highs and mark values', () => {
    expect(priceFormatFromSeries([0.04, 0.05, 0.07], [0.06])).toEqual({
      precision: 5,
      minMove: 0.00001,
    });
  });

  it('lets mark line drive precision when candles are empty (mark-only fallback)', () => {
    expect(priceFormatFromSeries([], [0.0005, 0.0006])).toEqual({
      precision: 6,
      minMove: 0.000001,
    });
  });

  it('ignores NaN / negative-zero outliers safely', () => {
    expect(priceFormatFromSeries([Number.NaN, 0.07], [])).toEqual({
      precision: 5,
      minMove: 0.00001,
    });
  });

  it('falls back to default when both series are empty', () => {
    expect(priceFormatFromSeries([], [])).toEqual({ precision: 2, minMove: 0.01 });
  });
});
