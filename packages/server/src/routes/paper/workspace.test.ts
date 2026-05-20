import { describe, it, expect } from 'vitest';
import type { Fill } from '@oggregator/trading';
import { computeNetPremiumUsd } from './workspace.js';

function makeFill(
  overrides: Partial<Fill> & Pick<Fill, 'side' | 'quantity' | 'priceUsd' | 'feesUsd'>,
): Fill {
  return {
    id: 'fil_test',
    orderId: 'ord_test',
    legIndex: 0,
    venue: 'deribit',
    optionRight: 'call',
    underlying: 'BTC',
    expiry: '2026-05-15',
    strike: 78_000,
    benchmarkBidUsd: null,
    benchmarkAskUsd: null,
    benchmarkMidUsd: null,
    underlyingSpotUsd: null,
    source: 'paper',
    filledAt: new Date('2026-04-23T07:37:44Z'),
    ...overrides,
  };
}

describe('computeNetPremiumUsd', () => {
  it('returns 0 for an empty fills array', () => {
    expect(computeNetPremiumUsd([])).toBe(0);
  });

  it('reports a positive debit for a bull call spread (buy lower + sell higher)', () => {
    // Matches the screenshot: 78000C @ 3095, 79000C @ 2575, ~$23 taker fee per leg.
    const fills: Fill[] = [
      makeFill({ side: 'buy', quantity: 1, priceUsd: 3_095, feesUsd: 23.39, strike: 78_000 }),
      makeFill({ side: 'sell', quantity: 1, priceUsd: 2_575, feesUsd: 23.39, strike: 79_000 }),
    ];
    // debit = (3095 - 2575) + 2 × 23.39
    expect(computeNetPremiumUsd(fills)).toBeCloseTo(566.78, 4);
  });

  it('reports a negative (credit) value for a credit spread', () => {
    // Sell 2000, buy 1500 → receive $500, pay ~$46 fees → net credit ≈ $454
    const fills: Fill[] = [
      makeFill({ side: 'sell', quantity: 1, priceUsd: 2_000, feesUsd: 23, strike: 80_000 }),
      makeFill({ side: 'buy', quantity: 1, priceUsd: 1_500, feesUsd: 23, strike: 81_000 }),
    ];
    expect(computeNetPremiumUsd(fills)).toBeCloseTo(-454, 4);
  });

  it('reflects realized cash flow when open and close fills are both present', () => {
    // Open long @ 100, close the same leg @ 150 → net credit after exit.
    const fills: Fill[] = [
      makeFill({ side: 'buy', quantity: 1, priceUsd: 100, feesUsd: 1 }),
      makeFill({ side: 'sell', quantity: 1, priceUsd: 150, feesUsd: 1 }),
    ];
    // buy cash delta: -100 - 1 = -101; sell cash delta: +150 - 1 = 149
    // total cash: +48; netPremium = -48
    expect(computeNetPremiumUsd(fills)).toBeCloseTo(-48, 4);
  });

  it('scales correctly with quantity', () => {
    const fills: Fill[] = [
      makeFill({ side: 'buy', quantity: 3, priceUsd: 100, feesUsd: 0 }),
    ];
    expect(computeNetPremiumUsd(fills)).toBe(300);
  });
});
