import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkHistoryBuffer, mergeBaseBuckets } from './mark-history-buffer.js';

const MIN = 60_000;
// Aligned to a 1-hour boundary so 1m / 5m / 15m / 1h assertions all line up.
const BASE_TS = Math.floor(1_700_000_000_000 / (60 * MIN)) * (60 * MIN);

describe('MarkHistoryBuffer', () => {
  let buf: MarkHistoryBuffer;

  beforeEach(() => {
    buf = new MarkHistoryBuffer({ retentionMs: 60 * MIN });
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS + 5 * MIN);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('buckets mark ticks into the correct 1m slot and tracks OHLC', () => {
    buf.recordMark('derive', 'HYPE-X', BASE_TS + 10_000, 100);
    buf.recordMark('derive', 'HYPE-X', BASE_TS + 20_000, 110);
    buf.recordMark('derive', 'HYPE-X', BASE_TS + 30_000, 90);
    buf.recordMark('derive', 'HYPE-X', BASE_TS + 50_000, 105);
    buf.recordMark('derive', 'HYPE-X', BASE_TS + 70_000, 120);

    const candles = buf.getMarkCandles('derive', 'HYPE-X', MIN, 10 * MIN);
    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({ ts: BASE_TS, o: 100, h: 110, l: 90, c: 105, vol: 0 });
    expect(candles[1]).toMatchObject({ ts: BASE_TS + MIN, o: 120, h: 120, l: 120, c: 120, vol: 0 });
  });

  it('aggregates trade ticks with summed volume', () => {
    buf.recordTrade('derive', 'HYPE-X', BASE_TS + 10_000, 100, 5);
    buf.recordTrade('derive', 'HYPE-X', BASE_TS + 30_000, 110, 3);
    buf.recordTrade('derive', 'HYPE-X', BASE_TS + 50_000, 95, 2);

    const candles = buf.getTradeCandles('derive', 'HYPE-X', MIN, 10 * MIN);
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ ts: BASE_TS, o: 100, h: 110, l: 95, c: 95, vol: 10 });
  });

  it('isolates streams between mark and trade', () => {
    buf.recordMark('derive', 'A', BASE_TS, 100);
    buf.recordTrade('derive', 'A', BASE_TS, 200, 1);

    const mark = buf.getMarkCandles('derive', 'A', MIN, 10 * MIN);
    const trade = buf.getTradeCandles('derive', 'A', MIN, 10 * MIN);
    expect(mark[0]?.c).toBe(100);
    expect(trade[0]?.c).toBe(200);
  });

  it('isolates instruments and venues', () => {
    buf.recordMark('derive', 'A', BASE_TS, 1);
    buf.recordMark('derive', 'B', BASE_TS, 2);
    buf.recordMark('deribit', 'A', BASE_TS, 3);

    expect(buf.getMarkCandles('derive', 'A', MIN, 10 * MIN)[0]?.c).toBe(1);
    expect(buf.getMarkCandles('derive', 'B', MIN, 10 * MIN)[0]?.c).toBe(2);
    expect(buf.getMarkCandles('deribit', 'A', MIN, 10 * MIN)[0]?.c).toBe(3);
  });

  it('filters by the requested range', () => {
    buf.recordMark('derive', 'A', BASE_TS, 1);
    buf.recordMark('derive', 'A', BASE_TS + 4 * MIN, 2);

    vi.setSystemTime(BASE_TS + 4 * MIN + 30_000);
    const recent = buf.getMarkCandles('derive', 'A', MIN, 2 * MIN);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.c).toBe(2);
  });

  it('re-buckets to a coarser interval', () => {
    for (let i = 0; i < 10; i++) {
      buf.recordMark('derive', 'A', BASE_TS + i * MIN, 100 + i);
    }
    const five = buf.getMarkCandles('derive', 'A', 5 * MIN, 60 * MIN);
    expect(five).toHaveLength(2);
    expect(five[0]).toMatchObject({ ts: BASE_TS, o: 100, h: 104, l: 100, c: 104 });
    expect(five[1]).toMatchObject({ ts: BASE_TS + 5 * MIN, o: 105, h: 109, l: 105, c: 109 });
  });

  it('drops stale buckets past the retention window once prune fires', () => {
    const buffer = new MarkHistoryBuffer({ retentionMs: 5 * MIN });
    // 255 writes within the first 5 minutes — under the prune-on-256 threshold.
    for (let i = 0; i < 255; i++) {
      buffer.recordMark('derive', 'A', BASE_TS + i * 1000, 100);
    }
    // 256th write lands 100 minutes later: cutoff = ts - retentionMs is well
    // past every earlier bucket, so prune leaves only this latest bucket.
    buffer.recordMark('derive', 'A', BASE_TS + 100 * MIN, 999);
    expect(buffer.stats().markBuckets).toBe(1);
  });

  it('rejects non-finite or non-positive prices', () => {
    buf.recordMark('derive', 'A', BASE_TS, Number.NaN);
    buf.recordMark('derive', 'A', BASE_TS, 0);
    buf.recordMark('derive', 'A', BASE_TS, -1);
    buf.recordTrade('derive', 'A', BASE_TS, Number.NaN, 1);
    expect(buf.hasMark('derive', 'A')).toBe(false);
    expect(buf.hasTrade('derive', 'A')).toBe(false);
  });

  it('returns empty arrays for unknown instruments', () => {
    expect(buf.getMarkCandles('derive', 'never-seen', MIN, MIN)).toEqual([]);
    expect(buf.getTradeCandles('derive', 'never-seen', MIN, MIN)).toEqual([]);
  });
});

describe('mergeBaseBuckets', () => {
  it('rolls 1m candles into a 5m candle with correct OHLCV', () => {
    const minutes = [100, 110, 90, 95, 105].map((c, i) => ({
      ts: i * MIN,
      o: c - 1,
      h: c + 2,
      l: c - 3,
      c,
      vol: i,
    }));
    const out = mergeBaseBuckets(minutes, 5 * MIN);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      ts: 0,
      o: 99,
      h: 112,
      l: 87,
      c: 105,
      vol: 0 + 1 + 2 + 3 + 4,
    });
  });

  it('keeps base candles unchanged when interval equals base', () => {
    const minutes = [
      { ts: 0, o: 1, h: 1, l: 1, c: 1, vol: 1 },
      { ts: MIN, o: 2, h: 2, l: 2, c: 2, vol: 2 },
    ];
    const out = mergeBaseBuckets(minutes, MIN);
    expect(out).toEqual(minutes);
  });
});
