import { describe, expect, it } from 'vitest';
import type { VenueId } from '@oggregator/core';
import type { Order, OrderLeg } from '../book/order.js';
import { FixedClock } from '../gateways/clock.js';
import type { QuoteBook, QuoteKey, QuoteProvider } from '../gateways/quote-provider.js';
import { PaperFillEngine } from './paper-fill-engine.js';
import { RealisticFillModel } from './realistic-fill-model.js';

class StubQuotes implements QuoteProvider {
  constructor(private readonly byStrike: Map<number, QuoteBook[]>) {}
  async getBooks(key: QuoteKey): Promise<QuoteBook[]> {
    return this.byStrike.get(key.strike) ?? [];
  }
  async getMark(): Promise<number | null> {
    return null;
  }
}

function book(overrides: Partial<QuoteBook>): QuoteBook {
  return {
    venue: 'deribit' as VenueId,
    bidUsd: 100,
    askUsd: 110,
    markUsd: 105,
    markIv: 0.6,
    underlyingPriceUsd: 78_000,
    feesTakerUsd: 0,
    bidSize: null,
    askSize: null,
    ...overrides,
  };
}

function single(byStrike: Map<number, QuoteBook>): StubQuotes {
  const wrapped = new Map<number, QuoteBook[]>();
  for (const [k, v] of byStrike) wrapped.set(k, [v]);
  return new StubQuotes(wrapped);
}

function order(legs: Array<Omit<OrderLeg, 'index'>>): Order {
  return {
    id: 'ord_test',
    clientOrderId: 'cid_test',
    accountId: 'acc_test',
    mode: 'paper',
    kind: 'market',
    status: 'accepted',
    legs: legs.map((leg, index) => ({ ...leg, index })),
    submittedAt: new Date('2026-04-23T00:00:00Z'),
    filledAt: null,
    rejectionReason: null,
    totalDebitUsd: null,
  };
}

const clock = new FixedClock(new Date('2026-04-23T00:00:00Z'));

describe('PaperFillEngine', () => {
  it('applies fees as USD-per-contract × quantity, not price × rate', async () => {
    const quotes = single(
      new Map([[78_000, book({ bidUsd: 3_000, askUsd: 3_095, feesTakerUsd: 23.4 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock);
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 1,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills).toHaveLength(1);
    expect(fills[0]!.priceUsd).toBe(3_095);
    expect(fills[0]!.feesUsd).toBeCloseTo(23.4, 6);
  });

  it('scales fees by quantity', async () => {
    const quotes = single(
      new Map([[78_000, book({ askUsd: 500, feesTakerUsd: 10 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock);
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 5,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.feesUsd).toBeCloseTo(50, 6);
  });

  it('propagates the venue mark IV onto the produced Fill', async () => {
    const quotes = single(
      new Map([[78_000, book({ askUsd: 3_095, markIv: 0.4275, feesTakerUsd: 0 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock);
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 1,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.iv).toBe(0.4275);
  });

  it('passes through a null venue mark IV as Fill.iv = null', async () => {
    const quotes = single(
      new Map([[78_000, book({ askUsd: 3_095, markIv: null, feesTakerUsd: 0 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock);
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 1,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.iv).toBeNull();
  });

  it('defaults to zero fees when venue provides no estimate', async () => {
    const quotes = single(
      new Map([[78_000, book({ askUsd: 3_095, feesTakerUsd: 0 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock);
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 1,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.feesUsd).toBe(0);
  });

  it('bull call spread: two-leg fill produces separate fees per leg', async () => {
    const quotes = single(
      new Map([
        [78_000, book({ bidUsd: 4_000, askUsd: 4_005, feesTakerUsd: 23 })],
        [79_000, book({ bidUsd: 3_520, askUsd: 3_530, feesTakerUsd: 23 })],
      ]),
    );
    const engine = new PaperFillEngine(quotes, clock);
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 1,
          preferredVenues: null,
        },
        {
          side: 'sell',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 79_000,
          quantity: 1,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills).toHaveLength(2);
    expect(fills[0]!.priceUsd).toBe(4_005);
    expect(fills[0]!.feesUsd).toBe(23);
    expect(fills[1]!.priceUsd).toBe(3_520);
    expect(fills[1]!.feesUsd).toBe(23);
  });

  it('optimistic mode: zero slippage, no partial fills, even when oversized', async () => {
    const quotes = single(
      new Map([[78_000, book({ askUsd: 100, askSize: 1, feesTakerUsd: 0 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock);
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 100,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.slippageUsd).toBe(0);
    expect(fills[0]!.partialFill).toBe(false);
    expect(fills[0]!.quantity).toBe(100);
    expect(fills[0]!.requestedQuantity).toBe(100);
  });

  it('realistic mode: order within L1 size pays no slippage', async () => {
    const quotes = single(
      new Map([[78_000, book({ bidUsd: 99, askUsd: 101, askSize: 5, bidSize: 5 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock, new RealisticFillModel());
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 3,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.priceUsd).toBe(101);
    expect(fills[0]!.slippageUsd).toBe(0);
    expect(fills[0]!.partialFill).toBe(false);
  });

  it('realistic mode: oversized order pays spread penalty when no L2 ladder', async () => {
    const quotes = single(
      new Map([[78_000, book({ bidUsd: 99, askUsd: 101, askSize: 1, bidSize: 1 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock, new RealisticFillModel());
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 5,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.priceUsd).toBeGreaterThan(101);
    expect(fills[0]!.slippageUsd).toBeGreaterThan(0);
    expect(fills[0]!.partialFill).toBe(false);
  });

  it('realistic mode: VWAP-walks an L2 ladder', async () => {
    const quotes = single(
      new Map([
        [
          78_000,
          book({
            bidUsd: 99,
            askUsd: 100,
            askSize: 2,
            bidSize: 2,
            askLevels: [
              { priceUsd: 100, size: 2 },
              { priceUsd: 102, size: 3 },
              { priceUsd: 105, size: 5 },
            ],
          }),
        ],
      ]),
    );
    const engine = new PaperFillEngine(quotes, clock, new RealisticFillModel());
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 5,
          preferredVenues: null,
        },
      ]),
      [],
    );
    // 2@100 + 3@102 = 506, vwap 101.2
    expect(fills[0]!.priceUsd).toBeCloseTo(101.2, 4);
    expect(fills[0]!.slippageUsd).toBeCloseTo(1.2, 4);
    expect(fills[0]!.quantity).toBe(5);
  });

  it('realistic mode: ladder thinner than request returns partial fill', async () => {
    const quotes = single(
      new Map([
        [
          78_000,
          book({
            bidUsd: 99,
            askUsd: 100,
            askSize: 1,
            bidSize: 1,
            askLevels: [
              { priceUsd: 100, size: 1 },
              { priceUsd: 102, size: 1 },
            ],
          }),
        ],
      ]),
    );
    const engine = new PaperFillEngine(quotes, clock, new RealisticFillModel());
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 5,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.quantity).toBe(2);
    expect(fills[0]!.requestedQuantity).toBe(5);
    expect(fills[0]!.partialFill).toBe(true);
  });
});
