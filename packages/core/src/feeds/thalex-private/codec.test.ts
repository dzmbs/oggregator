import { describe, expect, it } from 'vitest';

import { thalexPortfolioEntryToLeg, thalexPortfolioToLegs } from './codec.js';
import type { ThalexPortfolioEntry } from './types.js';

const SAMPLE: ThalexPortfolioEntry = {
  instrument_name: 'BTC-21APR26-75000-C',
  position: 2.5,
  average_price: 1850.5,
  mark_price: 1900,
  delta: 0.6,
};

describe('thalexPortfolioEntryToLeg', () => {
  it('parses a long call with DDMMMYY date', () => {
    const leg = thalexPortfolioEntryToLeg(SAMPLE, 1_715_000_000_000);
    expect(leg).not.toBeNull();
    expect(leg).toMatchObject({
      underlying: 'BTC',
      expiry: '2026-04-21',
      strike: 75000,
      optionRight: 'call',
      size: 2.5,
      entryPriceUsd: 1850.5,
      venueHint: 'thalex',
      source: 'thalex',
    });
  });

  it('parses a short put', () => {
    const leg = thalexPortfolioEntryToLeg({
      ...SAMPLE,
      instrument_name: 'ETH-28MAR26-3500-P',
      position: -1,
    });
    expect(leg?.underlying).toBe('ETH');
    expect(leg?.expiry).toBe('2026-03-28');
    expect(leg?.optionRight).toBe('put');
    expect(leg?.size).toBe(-1);
  });

  it('returns null for malformed instrument name', () => {
    expect(thalexPortfolioEntryToLeg({ ...SAMPLE, instrument_name: 'BAD' })).toBeNull();
  });

  it('returns null for zero position', () => {
    expect(thalexPortfolioEntryToLeg({ ...SAMPLE, position: 0 })).toBeNull();
  });

  it('returns null when average_price missing', () => {
    const entry = { ...SAMPLE } as ThalexPortfolioEntry;
    delete (entry as { average_price?: unknown }).average_price;
    expect(thalexPortfolioEntryToLeg(entry)).toBeNull();
  });

  it('synthesizes a deterministic legId', () => {
    const leg1 = thalexPortfolioEntryToLeg(SAMPLE);
    const leg2 = thalexPortfolioEntryToLeg({ ...SAMPLE, position: 5 });
    expect(leg1?.legId).toBe('thalex|BTC|2026-04-21|75000|call');
    expect(leg1?.legId).toBe(leg2?.legId);
  });

  it('filters mixed list, keeping valid options', () => {
    const legs = thalexPortfolioToLegs([
      SAMPLE,
      { ...SAMPLE, instrument_name: 'BAD' },
      { ...SAMPLE, instrument_name: 'ETH-28MAR26-3500-P', position: -1 },
    ]);
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => l.source === 'thalex')).toBe(true);
  });
});
