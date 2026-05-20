import { describe, it, expect } from 'vitest';
import { applyLiveTick } from './use-instrument-candles.js';
import type { InstrumentCandle } from '@oggregator/protocol';

const base: InstrumentCandle[] = [
  { ts: 1, o: 10, h: 11, l: 9, c: 10.5, vol: 5, synthetic: false },
  { ts: 2, o: 10.5, h: 12, l: 10, c: 11, vol: 3, synthetic: false },
];

describe('applyLiveTick', () => {
  it('extends last candle close and updates high when mid moves above prior high', () => {
    const out = applyLiveTick(base, 13);
    const last = out[out.length - 1]!;
    expect(last.c).toBe(13);
    expect(last.h).toBe(13);
  });

  it('lowers low when mid drops below prior low', () => {
    const out = applyLiveTick(base, 8);
    const last = out[out.length - 1]!;
    expect(last.l).toBe(8);
    expect(last.c).toBe(8);
  });

  it('returns original array reference when liveMid is null', () => {
    const out = applyLiveTick(base, null);
    expect(out).toBe(base);
  });

  it('returns empty when candle list is empty', () => {
    const out = applyLiveTick([], 10);
    expect(out).toEqual([]);
  });
});
