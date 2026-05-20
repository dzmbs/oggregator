import { describe, expect, it } from 'vitest';
import { deriveCoincallHealth } from './health.js';

describe('Coincall health', () => {
  it('reports connected when serverTime and config are present', () => {
    expect(
      deriveCoincallHealth(1776702613959, {
        optionConfig: {
          BTCUSD: {
            symbol: 'BTCUSD',
            base: 'BTC',
            settle: 'USD',
            takerFee: 0.0004,
            makerFee: 0.0003,
            multiplier: 0.01,
            tickSize: 0.1,
            priceDecimal: 2,
            qtyDecimal: 2,
          },
        },
      }),
    ).toEqual({ status: 'connected', message: 'rest health ok' });
  });

  it('degrades when serverTime is null', () => {
    expect(
      deriveCoincallHealth(null, {
        optionConfig: {
          BTCUSD: {
            symbol: 'BTCUSD',
            base: 'BTC',
            settle: 'USD',
            takerFee: 0.0004,
            makerFee: 0.0003,
            multiplier: 0.01,
            tickSize: 0.1,
            priceDecimal: 2,
            qtyDecimal: 2,
          },
        },
      }),
    ).toEqual({ status: 'degraded', message: 'server time probe failed' });
  });

  it('degrades when optionConfig is empty', () => {
    expect(deriveCoincallHealth(1, { optionConfig: {} })).toEqual({
      status: 'degraded',
      message: 'option config missing',
    });
  });

  it('surfaces rest probe failure', () => {
    expect(deriveCoincallHealth(null, null, new Error('fetch failed'))).toEqual({
      status: 'degraded',
      message: 'rest probe failed: Error: fetch failed',
    });
  });
});
