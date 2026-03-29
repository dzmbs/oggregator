import { describe, expect, it } from 'vitest';
import { deriveBinanceHealth } from './health.js';

describe('Binance health', () => {
  it('reports healthy when server time and symbols are present', () => {
    expect(
      deriveBinanceHealth(123, { optionSymbols: [{}] }),
    ).toEqual({
      status: 'connected',
      message: 'rest health ok',
    });
  });

  it('degrades when health inputs are incomplete', () => {
    expect(
      deriveBinanceHealth(null, { symbols: [] }),
    ).toEqual({
      status: 'degraded',
      message: 'rest health incomplete',
    });
  });

  it('surfaces probe failures', () => {
    expect(
      deriveBinanceHealth(null, null, new Error('timeout')),
    ).toEqual({
      status: 'degraded',
      message: 'rest probe failed: Error: timeout',
    });
  });
});
