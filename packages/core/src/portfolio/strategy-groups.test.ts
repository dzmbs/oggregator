import { describe, expect, it } from 'vitest';

import type { PositionLeg } from '@oggregator/protocol';

import { detectStrategyGroups } from './strategy-groups.js';

function leg(partial: Partial<PositionLeg> & { legId: string }): PositionLeg {
  return {
    underlying: 'BTC',
    expiry: '2026-06-26',
    strike: 70_000,
    optionRight: 'call',
    size: 1,
    entryPriceUsd: 1_000,
    entryIv: 0.6,
    entryTs: 1_700_000_000_000,
    venueHint: null,
    source: 'manual',
    realizedPnlUsd: 0,
    ...partial,
  };
}

describe('detectStrategyGroups', () => {
  it('returns naked leg when one leg is present', () => {
    const groups = detectStrategyGroups([leg({ legId: 'a' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe('naked');
  });

  it('detects a bull put credit spread (short higher, long lower)', () => {
    const legs = [
      leg({
        legId: 'short-80',
        optionRight: 'put',
        strike: 80_000,
        size: -0.31,
        entryPriceUsd: 4_660,
      }),
      leg({
        legId: 'long-78',
        optionRight: 'put',
        strike: 78_000,
        size: 0.31,
        entryPriceUsd: 3_835,
      }),
    ];
    const groups = detectStrategyGroups(legs);
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.kind).toBe('put_spread');
    // net premium = sum(entry * size) = -0.31 * 4660 + 0.31 * 3835 = -255.75
    expect(group.netEntryPremiumUsd).toBeCloseTo(-255.75, 4);
    expect(group.debitOrCredit).toBe('credit');
    // Bull put credit spread max profit = credit, max loss = width - credit.
    expect(group.maxProfitUsd).toBeCloseTo(255.75, 4);
    expect(group.maxLossUsd).toBeCloseTo(0.31 * 2_000 - 255.75, 4);
    expect(group.breakEvenSpotsUsd).toHaveLength(1);
    // Break-even spot for short put spread: short strike - credit/qty
    expect(group.breakEvenSpotsUsd[0]).toBeCloseTo(80_000 - 255.75 / 0.31, 2);
  });

  it('detects a long call debit spread', () => {
    const legs = [
      leg({ legId: 'long-70', strike: 70_000, size: 1, entryPriceUsd: 5_000 }),
      leg({ legId: 'short-80', strike: 80_000, size: -1, entryPriceUsd: 2_000 }),
    ];
    const groups = detectStrategyGroups(legs);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.kind).toBe('call_spread');
    expect(g.debitOrCredit).toBe('debit');
    expect(g.netEntryPremiumUsd).toBeCloseTo(3_000, 6);
    expect(g.maxProfitUsd).toBeCloseTo(7_000, 6);
    expect(g.maxLossUsd).toBeCloseTo(3_000, 6);
  });

  it('detects a long straddle (same strike, opposite right, same sign size)', () => {
    const legs = [
      leg({ legId: 'call-70', strike: 70_000, size: 1, entryPriceUsd: 4_000 }),
      leg({
        legId: 'put-70',
        strike: 70_000,
        size: 1,
        entryPriceUsd: 3_500,
        optionRight: 'put',
      }),
    ];
    const groups = detectStrategyGroups(legs);
    expect(groups[0]?.kind).toBe('straddle');
    expect(groups[0]?.netEntryPremiumUsd).toBeCloseTo(7_500, 6);
    expect(groups[0]?.debitOrCredit).toBe('debit');
    expect(groups[0]?.breakEvenSpotsUsd).toHaveLength(2);
  });

  it('detects a strangle (different strikes, opposite right, same sign size)', () => {
    const legs = [
      leg({ legId: 'call-80', strike: 80_000, size: 1, entryPriceUsd: 2_000 }),
      leg({
        legId: 'put-60',
        strike: 60_000,
        size: 1,
        entryPriceUsd: 1_500,
        optionRight: 'put',
      }),
    ];
    const groups = detectStrategyGroups(legs);
    expect(groups[0]?.kind).toBe('strangle');
    expect(groups[0]?.maxProfitUsd).toBeNull();
  });

  it('does not group legs across underlyings', () => {
    const legs = [
      leg({ legId: 'a', underlying: 'BTC', strike: 80_000, size: 1, optionRight: 'put' }),
      leg({ legId: 'b', underlying: 'ETH', strike: 4_000, size: -1, optionRight: 'put' }),
    ];
    const groups = detectStrategyGroups(legs);
    expect(groups.every((g) => g.kind === 'naked')).toBe(true);
  });

  it('does not group legs across expiries', () => {
    const legs = [
      leg({ legId: 'a', expiry: '2026-06-26', strike: 80_000, size: 1, optionRight: 'put' }),
      leg({ legId: 'b', expiry: '2026-09-26', strike: 78_000, size: -1, optionRight: 'put' }),
    ];
    const groups = detectStrategyGroups(legs);
    expect(groups.every((g) => g.kind === 'naked')).toBe(true);
  });
});
