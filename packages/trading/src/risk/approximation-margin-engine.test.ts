import { describe, expect, it } from 'vitest';
import type { VenueId } from '@oggregator/core';
import type { Position } from '../book/position.js';
import type { QuoteBook, QuoteKey, QuoteProvider } from '../gateways/quote-provider.js';
import { ApproximationMarginEngine } from './approximation-margin-engine.js';
import { MarginCheckUnavailableError } from '../book/errors.js';

class StubQuotes implements QuoteProvider {
  constructor(private readonly spotByStrike: Map<number, number | null>) {}
  async getBooks(key: QuoteKey): Promise<QuoteBook[]> {
    const spot = this.spotByStrike.get(key.strike);
    if (spot == null) return [];
    return [
      {
        venue: 'deribit' as VenueId,
        bidUsd: 0,
        askUsd: 0,
        markUsd: null,
        markIv: null,
        underlyingPriceUsd: spot,
        feesTakerUsd: 0,
        bidSize: null,
        askSize: null,
      },
    ];
  }
  async getMark(): Promise<number | null> {
    return null;
  }
}

function pos(overrides: Partial<Position['key']> & { netQuantity: number }): Position {
  return {
    key: {
      accountId: 'acc',
      underlying: 'BTC',
      expiry: '2026-05-29',
      strike: 80_000,
      optionRight: 'call',
      ...overrides,
    },
    netQuantity: overrides.netQuantity,
    avgEntryPriceUsd: 1000,
    avgEntryIv: null,
    realizedPnlUsd: 0,
    openedAt: new Date('2026-04-23'),
    lastFillAt: new Date('2026-04-23'),
  };
}

describe('ApproximationMarginEngine', () => {
  it('long legs require zero margin', async () => {
    const quotes = new StubQuotes(new Map([[80_000, 80_000]]));
    const engine = new ApproximationMarginEngine(quotes);
    const r = await engine.estimate({
      prospectiveLegs: [
        {
          index: 0,
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 80_000,
          quantity: 1,
          preferredVenues: null,
        },
      ],
      existingPositions: [],
      equityUsd: 1_000,
      venueFilter: [],
    });
    expect(r.requiredUsd).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('short ATM call: max(0.15×spot − 0, 0.10×spot) = 0.15×spot', async () => {
    const quotes = new StubQuotes(new Map([[80_000, 80_000]]));
    const engine = new ApproximationMarginEngine(quotes);
    const r = await engine.estimate({
      prospectiveLegs: [
        {
          index: 0,
          side: 'sell',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 80_000,
          quantity: 1,
          preferredVenues: null,
        },
      ],
      existingPositions: [],
      equityUsd: 100_000,
      venueFilter: [],
    });
    expect(r.requiredUsd).toBeCloseTo(12_000, 4); // 0.15 × 80_000
    expect(r.ok).toBe(true);
  });

  it('deep OTM short call falls back to 0.10×spot floor', async () => {
    const quotes = new StubQuotes(new Map([[200_000, 80_000]]));
    const engine = new ApproximationMarginEngine(quotes);
    const r = await engine.estimate({
      prospectiveLegs: [
        {
          index: 0,
          side: 'sell',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 200_000,
          quantity: 1,
          preferredVenues: null,
        },
      ],
      existingPositions: [],
      equityUsd: 100_000,
      venueFilter: [],
    });
    // 0.15×80k − (200k−80k) = -108k; floor 0.10×80k = 8k
    expect(r.requiredUsd).toBeCloseTo(8_000, 4);
  });

  it('short ATM put margin uses 0.10×strike as floor', async () => {
    const quotes = new StubQuotes(new Map([[80_000, 80_000]]));
    const engine = new ApproximationMarginEngine(quotes);
    const r = await engine.estimate({
      prospectiveLegs: [
        {
          index: 0,
          side: 'sell',
          optionRight: 'put',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 80_000,
          quantity: 1,
          preferredVenues: null,
        },
      ],
      existingPositions: [],
      equityUsd: 100_000,
      venueFilter: [],
    });
    expect(r.requiredUsd).toBeCloseTo(12_000, 4);
  });

  it('rejects when required > equity − buffer', async () => {
    const quotes = new StubQuotes(new Map([[80_000, 80_000]]));
    const engine = new ApproximationMarginEngine(quotes);
    const r = await engine.estimate({
      prospectiveLegs: [
        {
          index: 0,
          side: 'sell',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 80_000,
          quantity: 1,
          preferredVenues: null,
        },
      ],
      existingPositions: [],
      equityUsd: 10_000,
      venueFilter: [],
    });
    expect(r.ok).toBe(false);
    expect(r.requiredUsd).toBeCloseTo(12_000, 4);
    // 5% of 10_000 = 500; available = 9_500
    expect(r.availableUsd).toBeCloseTo(9_500, 4);
    expect(r.reason).toContain('exceeds available');
  });

  it('scales by quantity', async () => {
    const quotes = new StubQuotes(new Map([[80_000, 80_000]]));
    const engine = new ApproximationMarginEngine(quotes);
    const r = await engine.estimate({
      prospectiveLegs: [
        {
          index: 0,
          side: 'sell',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 80_000,
          quantity: 5,
          preferredVenues: null,
        },
      ],
      existingPositions: [],
      equityUsd: 1_000_000,
      venueFilter: [],
    });
    expect(r.requiredUsd).toBeCloseTo(60_000, 4);
  });

  it('adds existing short positions to required margin', async () => {
    const quotes = new StubQuotes(
      new Map([
        [80_000, 80_000],
        [70_000, 80_000],
      ]),
    );
    const engine = new ApproximationMarginEngine(quotes);
    const r = await engine.estimate({
      prospectiveLegs: [
        {
          index: 0,
          side: 'sell',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 80_000,
          quantity: 1,
          preferredVenues: null,
        },
      ],
      existingPositions: [pos({ strike: 70_000, optionRight: 'put', netQuantity: -1 })],
      equityUsd: 1_000_000,
      venueFilter: [],
    });
    // new short call ATM: 12_000
    // existing short put: max(0.15×80k − 10k, 0.10×70k) = max(2k, 7k) = 7k
    expect(r.requiredUsd).toBeCloseTo(19_000, 4);
  });

  it('long existing positions contribute zero margin', async () => {
    const quotes = new StubQuotes(new Map([[80_000, 80_000]]));
    const engine = new ApproximationMarginEngine(quotes);
    const r = await engine.estimate({
      prospectiveLegs: [],
      existingPositions: [pos({ strike: 80_000, netQuantity: 5 })],
      equityUsd: 100_000,
      venueFilter: [],
    });
    expect(r.requiredUsd).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('throws MarginCheckUnavailableError when prospective leg has no spot', async () => {
    const quotes = new StubQuotes(new Map());
    const engine = new ApproximationMarginEngine(quotes);
    await expect(
      engine.estimate({
        prospectiveLegs: [
          {
            index: 2,
            side: 'sell',
            optionRight: 'call',
            underlying: 'BTC',
            expiry: '2026-05-29',
            strike: 80_000,
            quantity: 1,
            preferredVenues: null,
          },
        ],
        existingPositions: [],
        equityUsd: 100_000,
        venueFilter: [],
      }),
    ).rejects.toBeInstanceOf(MarginCheckUnavailableError);
  });
});
