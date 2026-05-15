import { describe, it, expect } from 'vitest';
import { mergeTradeAndMark, bucketTicks, bucketTrades } from './instrument-candles.js';

describe('mergeTradeAndMark', () => {
  it('uses trade bar when vol > 0', () => {
    const trade = [{ ts: 1, o: 10, h: 11, l: 9, c: 10.5, vol: 5 }];
    const mark = [{ ts: 1, o: 9, h: 12, l: 8, c: 11, vol: 0 }];
    const out = mergeTradeAndMark(trade, mark);
    expect(out.candles).toEqual([
      { ts: 1, o: 10, h: 11, l: 9, c: 10.5, vol: 5, synthetic: false },
    ]);
    expect(out.markLine).toEqual([{ ts: 1, c: 11 }]);
  });

  it('falls back to mark when trade vol is 0', () => {
    const trade = [{ ts: 1, o: 0, h: 0, l: 0, c: 0, vol: 0 }];
    const mark = [{ ts: 1, o: 9, h: 12, l: 8, c: 11, vol: 0 }];
    const out = mergeTradeAndMark(trade, mark);
    expect(out.candles).toEqual([
      { ts: 1, o: 9, h: 12, l: 8, c: 11, vol: 0, synthetic: true },
    ]);
  });

  it('fills mark-only buckets that have no trade bucket', () => {
    const trade: { ts: number; o: number; h: number; l: number; c: number; vol: number }[] = [];
    const mark = [
      { ts: 1, o: 1, h: 1, l: 1, c: 1, vol: 0 },
      { ts: 2, o: 2, h: 2, l: 2, c: 2, vol: 0 },
    ];
    const out = mergeTradeAndMark(trade, mark);
    expect(out.candles.map((c) => c.synthetic)).toEqual([true, true]);
    expect(out.markLine.map((m) => m.c)).toEqual([1, 2]);
  });

  it('emits trade-only buckets even when no mark bucket exists', () => {
    const trade = [{ ts: 1, o: 10, h: 11, l: 9, c: 10.5, vol: 5 }];
    const mark: { ts: number; o: number; h: number; l: number; c: number; vol: number }[] = [];
    const out = mergeTradeAndMark(trade, mark);
    expect(out.candles).toEqual([
      { ts: 1, o: 10, h: 11, l: 9, c: 10.5, vol: 5, synthetic: false },
    ]);
    expect(out.markLine).toEqual([]);
  });

  it('emits buckets in ascending ts order', () => {
    const trade = [{ ts: 2, o: 2, h: 2, l: 2, c: 2, vol: 1 }];
    const mark = [
      { ts: 1, o: 1, h: 1, l: 1, c: 1, vol: 0 },
      { ts: 2, o: 1.5, h: 2.5, l: 1.5, c: 2.5, vol: 0 },
    ];
    const out = mergeTradeAndMark(trade, mark);
    expect(out.candles.map((c) => c.ts)).toEqual([1, 2]);
  });
});

describe('bucketTrades', () => {
  it('aggregates trades into OHLCV candles', () => {
    const trades = [
      { execId: 'a', ts: 60_000, price: 10, size: 1 },
      { execId: 'b', ts: 60_500, price: 12, size: 0.5 },
      { execId: 'c', ts: 61_000, price: 9, size: 2 },
      { execId: 'd', ts: 120_000, price: 8, size: 1 },
    ];
    const out = bucketTrades(trades, 60_000);
    expect(out).toEqual([
      { ts: 60_000, o: 10, h: 12, l: 9, c: 9, vol: 3.5 },
      { ts: 120_000, o: 8, h: 8, l: 8, c: 8, vol: 1 },
    ]);
  });

  it('sorts unordered trades before bucketing so o/c stay correct', () => {
    const trades = [
      { execId: 'b', ts: 60_500, price: 12, size: 1 },
      { execId: 'a', ts: 60_000, price: 10, size: 1 },
      { execId: 'c', ts: 61_000, price: 9, size: 1 },
    ];
    const out = bucketTrades(trades, 60_000);
    expect(out[0]).toEqual({ ts: 60_000, o: 10, h: 12, l: 9, c: 9, vol: 3 });
  });

  it('skips trades with non-finite price or ts', () => {
    const trades = [
      { execId: 'a', ts: 60_000, price: NaN, size: 1 },
      { execId: 'b', ts: 60_500, price: 12, size: 1 },
    ];
    const out = bucketTrades(trades, 60_000);
    expect(out).toEqual([{ ts: 60_000, o: 12, h: 12, l: 12, c: 12, vol: 1 }]);
  });
});

describe('bucketTicks', () => {
  it('aggregates ticks into bucketed candles preserving high/low/close', () => {
    const ticks: [number, number][] = [
      [60_000, 10],
      [60_500, 12],
      [61_000, 9],
      [120_000, 8],
      [121_000, 11],
    ];
    const out = bucketTicks(ticks, 60_000);
    expect(out).toEqual([
      { ts: 60_000, o: 10, h: 12, l: 9, c: 9, vol: 0 },
      { ts: 120_000, o: 8, h: 11, l: 8, c: 11, vol: 0 },
    ]);
  });

  it('sorts buckets ascending when ticks arrive out of order', () => {
    const ticks: [number, number][] = [
      [120_000, 8],
      [60_000, 10],
      [121_000, 11],
      [60_500, 12],
    ];
    const out = bucketTicks(ticks, 60_000);
    expect(out.map((c) => c.ts)).toEqual([60_000, 120_000]);
    expect(out[0]?.h).toBe(12);
    expect(out[1]?.h).toBe(11);
  });
});
