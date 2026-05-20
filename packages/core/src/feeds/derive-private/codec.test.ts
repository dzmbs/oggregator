import { describe, expect, it } from 'vitest';

import { derivePositionToLeg, derivePositionsToLegs } from './codec.js';
import type { DerivePosition } from './types.js';

const SAMPLE: DerivePosition = {
  instrument_name: 'BTC-20260627-70000-C',
  instrument_type: 'option',
  amount: '2.5',
  average_price: '1850.50',
  mark_price: '1900.00',
  index_price: '69500',
  creation_timestamp: 1_715_000_000_000,
  delta: '0.62',
  gamma: '0.00003',
  theta: '-50.5',
  vega: '120',
};

describe('derivePositionToLeg', () => {
  it('parses a long call', () => {
    const leg = derivePositionToLeg(SAMPLE);
    expect(leg).not.toBeNull();
    expect(leg).toMatchObject({
      underlying: 'BTC',
      expiry: '2026-06-27',
      strike: 70000,
      optionRight: 'call',
      size: 2.5,
      entryPriceUsd: 1850.5,
      venueHint: 'derive',
      source: 'derive',
    });
  });

  it('parses a short put', () => {
    const leg = derivePositionToLeg({
      ...SAMPLE,
      instrument_name: 'ETH-20260328-3500-P',
      amount: '-1.0',
    });
    expect(leg?.underlying).toBe('ETH');
    expect(leg?.optionRight).toBe('put');
    expect(leg?.size).toBe(-1);
  });

  it('returns null for perp', () => {
    expect(
      derivePositionToLeg({ ...SAMPLE, instrument_type: 'perp', instrument_name: 'BTC-PERP' }),
    ).toBeNull();
  });

  it('returns null for malformed instrument', () => {
    expect(derivePositionToLeg({ ...SAMPLE, instrument_name: 'BAD' })).toBeNull();
  });

  it('returns null for zero size', () => {
    expect(derivePositionToLeg({ ...SAMPLE, amount: '0' })).toBeNull();
  });

  it('synthesizes deterministic legId', () => {
    const leg1 = derivePositionToLeg(SAMPLE);
    const leg2 = derivePositionToLeg({ ...SAMPLE, amount: '5.0' });
    expect(leg1?.legId).toBe('derive|BTC|2026-06-27|70000|call');
    expect(leg1?.legId).toBe(leg2?.legId);
  });

  it('filters mixed list to options only', () => {
    const legs = derivePositionsToLegs([
      SAMPLE,
      { ...SAMPLE, instrument_type: 'perp', instrument_name: 'BTC-PERP' },
      { ...SAMPLE, instrument_name: 'ETH-20260328-3500-P', amount: '-1' },
    ]);
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => l.source === 'derive')).toBe(true);
  });
});
