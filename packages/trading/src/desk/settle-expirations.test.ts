import { describe, expect, it } from 'vitest';
import type { Position } from '../book/position.js';
import { buildSettlementFill } from './settle-expirations.js';
import { deliveryFeeUsd } from './delivery-fees.js';

const ASOF = new Date('2026-04-25T08:00:00Z');

function makePosition(
  optionRight: 'call' | 'put',
  netQuantity: number,
  strike: number,
): Position {
  return {
    key: {
      accountId: 'acct_test',
      underlying: 'BTC',
      expiry: '2026-04-25',
      strike,
      optionRight,
    },
    netQuantity,
    avgEntryPriceUsd: 1234,
    avgEntryIv: null,
    realizedPnlUsd: 0,
    openedAt: new Date('2026-04-01T00:00:00Z'),
    lastFillAt: new Date('2026-04-01T00:00:00Z'),
  };
}

describe('buildSettlementFill', () => {
  it('long call ITM → sell-side fill at intrinsic', () => {
    const fill = buildSettlementFill({
      position: makePosition('call', 5, 30000),
      venue: 'deribit',
      settlementSpotUsd: 35000,
      asOf: ASOF,
    });
    expect(fill).not.toBeNull();
    expect(fill!.side).toBe('sell');
    expect(fill!.quantity).toBe(5);
    expect(fill!.priceUsd).toBe(5000);
    expect(fill!.source).toBe('settlement');
    expect(fill!.feesUsd).toBeGreaterThan(0);
    expect(fill!.underlyingSpotUsd).toBe(35000);
    expect(fill!.filledAt).toEqual(ASOF);
  });

  it('long call OTM → priceUsd=0, fees=0', () => {
    const fill = buildSettlementFill({
      position: makePosition('call', 5, 50000),
      venue: 'deribit',
      settlementSpotUsd: 35000,
      asOf: ASOF,
    });
    expect(fill).not.toBeNull();
    expect(fill!.priceUsd).toBe(0);
    expect(fill!.feesUsd).toBe(0);
    expect(fill!.side).toBe('sell');
  });

  it('short put ITM → buy-side fill at intrinsic', () => {
    const fill = buildSettlementFill({
      position: makePosition('put', -3, 40000),
      venue: 'deribit',
      settlementSpotUsd: 35000,
      asOf: ASOF,
    });
    expect(fill).not.toBeNull();
    expect(fill!.side).toBe('buy');
    expect(fill!.quantity).toBe(3);
    expect(fill!.priceUsd).toBe(5000);
  });

  it('flat position → null', () => {
    const fill = buildSettlementFill({
      position: makePosition('call', 0, 30000),
      venue: 'deribit',
      settlementSpotUsd: 35000,
      asOf: ASOF,
    });
    expect(fill).toBeNull();
  });
});

describe('deliveryFeeUsd', () => {
  it('uses notional branch for low-intrinsic', () => {
    // qty=1, spot=35000, intrinsic=100 → notional=0.00015*35000=5.25, cap=0.125*100=12.5
    const fee = deliveryFeeUsd('deribit', 35000, 100, 1);
    expect(fee).toBeCloseTo(5.25, 6);
  });

  it('uses cap branch for cheap-but-deep ITM', () => {
    // qty=1, spot=35000, intrinsic=10 → notional=5.25, cap=0.125*10=1.25
    const fee = deliveryFeeUsd('deribit', 35000, 10, 1);
    expect(fee).toBeCloseTo(1.25, 6);
  });

  it('zero intrinsic → zero fee', () => {
    expect(deliveryFeeUsd('deribit', 35000, 0, 5)).toBe(0);
  });

  it('scales with quantity', () => {
    const one = deliveryFeeUsd('deribit', 35000, 5000, 1);
    const five = deliveryFeeUsd('deribit', 35000, 5000, 5);
    expect(five).toBeCloseTo(one * 5, 6);
  });
});
