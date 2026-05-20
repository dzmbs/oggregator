import { describe, expect, it } from 'vitest';
import { computePositionPnl, computeSnapshot } from './pnl.js';
import type { Position } from './position.js';

const BASE_KEY: Position['key'] = {
  accountId: 'acc',
  underlying: 'BTC',
  expiry: '2026-06-26',
  strike: 70000,
  optionRight: 'call',
};

function makePos(netQuantity: number, avg: number, realized = 0): Position {
  return {
    key: BASE_KEY,
    netQuantity,
    avgEntryPriceUsd: avg,
    avgEntryIv: null,
    realizedPnlUsd: realized,
    openedAt: new Date('2026-04-17T00:00:00Z'),
    lastFillAt: new Date('2026-04-17T00:00:00Z'),
  };
}

describe('computePositionPnl', () => {
  it('returns null unrealized when mark is null', () => {
    const pnl = computePositionPnl(makePos(2, 1000), null);
    expect(pnl.unrealizedUsd).toBeNull();
    expect(pnl.markPriceUsd).toBeNull();
  });

  it('returns positive unrealized when mark is above entry for a long', () => {
    const pnl = computePositionPnl(makePos(2, 1000), 1500);
    expect(pnl.unrealizedUsd).toBe(1000);
  });

  it('returns negative unrealized when mark is below entry for a long', () => {
    const pnl = computePositionPnl(makePos(2, 1000), 800);
    expect(pnl.unrealizedUsd).toBe(-400);
  });

  it('inverts sign for shorts', () => {
    const pnl = computePositionPnl(makePos(-2, 1000), 800);
    expect(pnl.unrealizedUsd).toBe(400);
  });
});

describe('computeSnapshot', () => {
  it('sums realized + unrealized and adds cash for equity', () => {
    const longPos = makePos(2, 1000, 50);
    const shortPos = { ...makePos(-1, 500), key: { ...BASE_KEY, strike: 80000 } };
    const marks = new Map<string, number | null>([
      ['BTC|2026-06-26|70000|call', 1200],
      ['BTC|2026-06-26|80000|call', 400],
    ]);
    const snap = computeSnapshot([longPos, shortPos], marks, 100_000, new Date());
    expect(snap.realizedUsd).toBe(50);
    expect(snap.unrealizedUsd).toBe(400 + 100);
    expect(snap.equityUsd).toBe(100_000 + 500);
  });
});
