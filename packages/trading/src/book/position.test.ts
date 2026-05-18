import { describe, expect, it } from 'vitest';
import type { Fill } from './fill.js';
import { applyFillToPosition, type Position } from './position.js';

function makeFill(partial: Partial<Fill> & Pick<Fill, 'side' | 'quantity' | 'priceUsd'>): Fill {
  return {
    id: 'fil_x',
    orderId: 'ord_x',
    legIndex: 0,
    venue: 'deribit',
    optionRight: 'call',
    underlying: 'BTC',
    expiry: '2026-06-26',
    strike: 70000,
    requestedQuantity: partial.quantity,
    iv: null,
    feesUsd: 0,
    slippageUsd: 0,
    partialFill: false,
    benchmarkBidUsd: null,
    benchmarkAskUsd: null,
    benchmarkMidUsd: null,
    underlyingSpotUsd: null,
    source: 'paper',
    filledAt: new Date('2026-04-17T00:00:00Z'),
    ...partial,
  };
}

describe('applyFillToPosition', () => {
  it('opens a new long position from a buy fill', () => {
    const next = applyFillToPosition(
      null,
      makeFill({ side: 'buy', quantity: 2, priceUsd: 1000 }),
    );
    expect(next.netQuantity).toBe(2);
    expect(next.avgEntryPriceUsd).toBe(1000);
    expect(next.realizedPnlUsd).toBe(0);
  });

  it('opens a new short position from a sell fill', () => {
    const next = applyFillToPosition(
      null,
      makeFill({ side: 'sell', quantity: 3, priceUsd: 500 }),
    );
    expect(next.netQuantity).toBe(-3);
    expect(next.avgEntryPriceUsd).toBe(500);
  });

  it('averages entry when adding to a long', () => {
    const first = applyFillToPosition(
      null,
      makeFill({ side: 'buy', quantity: 2, priceUsd: 1000 }),
    );
    const second = applyFillToPosition(
      first,
      makeFill({ side: 'buy', quantity: 2, priceUsd: 1500 }),
    );
    expect(second.netQuantity).toBe(4);
    expect(second.avgEntryPriceUsd).toBe(1250);
    expect(second.realizedPnlUsd).toBe(0);
  });

  it('realizes PnL on partial close of a long', () => {
    const open = applyFillToPosition(
      null,
      makeFill({ side: 'buy', quantity: 4, priceUsd: 1000 }),
    );
    const close = applyFillToPosition(
      open,
      makeFill({ side: 'sell', quantity: 1, priceUsd: 1200 }),
    );
    expect(close.netQuantity).toBe(3);
    expect(close.avgEntryPriceUsd).toBe(1000);
    expect(close.realizedPnlUsd).toBe(200);
  });

  it('realizes PnL on full close', () => {
    const open = applyFillToPosition(
      null,
      makeFill({ side: 'buy', quantity: 2, priceUsd: 1000 }),
    );
    const close = applyFillToPosition(
      open,
      makeFill({ side: 'sell', quantity: 2, priceUsd: 1500 }),
    );
    expect(close.netQuantity).toBe(0);
    expect(close.realizedPnlUsd).toBe(1000);
  });

  it('flips from long to short and resets avg entry', () => {
    const open = applyFillToPosition(
      null,
      makeFill({ side: 'buy', quantity: 2, priceUsd: 1000 }),
    );
    const flip = applyFillToPosition(
      open,
      makeFill({ side: 'sell', quantity: 5, priceUsd: 1200 }),
    );
    expect(flip.netQuantity).toBe(-3);
    expect(flip.avgEntryPriceUsd).toBe(1200);
    expect(flip.realizedPnlUsd).toBe(400);
  });

  it('qty-weights entry IV when adding to the same side', () => {
    const first = applyFillToPosition(
      null,
      makeFill({ side: 'buy', quantity: 2, priceUsd: 1000, iv: 0.6 }),
    );
    const second = applyFillToPosition(
      first,
      makeFill({ side: 'buy', quantity: 2, priceUsd: 1500, iv: 0.8 }),
    );
    expect(second.avgEntryIv).toBeCloseTo(0.7, 6);
  });

  it('keeps prior IV when fill has no IV', () => {
    const first = applyFillToPosition(
      null,
      makeFill({ side: 'buy', quantity: 1, priceUsd: 1000, iv: 0.6 }),
    );
    const second = applyFillToPosition(
      first,
      makeFill({ side: 'buy', quantity: 1, priceUsd: 1200, iv: null }),
    );
    expect(second.avgEntryIv).toBeCloseTo(0.6, 6);
  });

  it('drops avgEntryIv when the position fully closes', () => {
    const open = applyFillToPosition(
      null,
      makeFill({ side: 'buy', quantity: 1, priceUsd: 1000, iv: 0.6 }),
    );
    const close = applyFillToPosition(
      open,
      makeFill({ side: 'sell', quantity: 1, priceUsd: 1100, iv: 0.55 }),
    );
    expect(close.netQuantity).toBe(0);
    expect(close.avgEntryIv).toBeNull();
  });

  it('on sign flip, avgEntryIv resets to the incoming fill IV', () => {
    const open = applyFillToPosition(
      null,
      makeFill({ side: 'buy', quantity: 2, priceUsd: 1000, iv: 0.6 }),
    );
    const flip = applyFillToPosition(
      open,
      makeFill({ side: 'sell', quantity: 5, priceUsd: 1200, iv: 0.42 }),
    );
    expect(flip.netQuantity).toBe(-3);
    expect(flip.avgEntryPriceUsd).toBe(1200);
    expect(flip.avgEntryIv).toBeCloseTo(0.42, 6);
  });

  it('on sign flip with no incoming IV, avgEntryIv resets to null (not preserved)', () => {
    const open = applyFillToPosition(
      null,
      makeFill({ side: 'buy', quantity: 2, priceUsd: 1000, iv: 0.6 }),
    );
    const flip = applyFillToPosition(
      open,
      makeFill({ side: 'sell', quantity: 5, priceUsd: 1200, iv: null }),
    );
    expect(flip.netQuantity).toBe(-3);
    expect(flip.avgEntryIv).toBeNull();
  });

  it('realizes PnL on partial close of a short', () => {
    const open = applyFillToPosition(
      null,
      makeFill({ side: 'sell', quantity: 4, priceUsd: 1200 }),
    );
    const close = applyFillToPosition(
      open,
      makeFill({ side: 'buy', quantity: 1, priceUsd: 800 }),
    );
    expect(close.netQuantity).toBe(-3);
    expect(close.avgEntryPriceUsd).toBe(1200);
    expect(close.realizedPnlUsd).toBe(400);
  });
});
