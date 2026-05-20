import { describe, it, expect } from 'vitest';
import { computeSviRichness } from './sviRichness';
import type { SmileCurve, SmilePoint } from '@lib/analytics/smile';

function makeSmile(points: { strike: number; iv: number }[], spot: number): SmileCurve {
  const smilePoints: SmilePoint[] = points.map((p) => ({
    strike: p.strike,
    moneyness: p.strike / spot,
    callIv: p.iv,
    putIv: p.iv,
    blendedIv: p.iv,
  }));
  return { spot, points: smilePoints, atmIv: null, skew: null };
}

describe('computeSviRichness', () => {
  it('returns empty richness when fewer than 5 usable points', () => {
    const smile = makeSmile(
      [
        { strike: 90, iv: 0.6 },
        { strike: 100, iv: 0.55 },
        { strike: 110, iv: 0.6 },
      ],
      100,
    );
    const r = computeSviRichness(smile, 30 / 365);
    expect(r.params).toBeNull();
    expect(r.points).toEqual([]);
  });

  it('returns null richness when T is invalid', () => {
    const smile = makeSmile(
      [80, 90, 100, 110, 120].map((s) => ({ strike: s, iv: 0.55 })),
      100,
    );
    expect(computeSviRichness(smile, 0).params).toBeNull();
    expect(computeSviRichness(smile, -1).params).toBeNull();
    expect(computeSviRichness(smile, null).points).toEqual([]);
  });

  it('flags an outlier strike with high |zScore|', () => {
    // Smooth smile with ONE strike artificially inflated by ~5%.
    const baseline = [
      { strike: 80, iv: 0.65 },
      { strike: 90, iv: 0.60 },
      { strike: 95, iv: 0.58 },
      { strike: 100, iv: 0.57 },
      { strike: 105, iv: 0.58 },
      { strike: 110, iv: 0.60 },
      { strike: 120, iv: 0.65 },
    ];
    const withOutlier = baseline.map((p) =>
      p.strike === 105 ? { ...p, iv: p.iv + 0.05 } : p,
    );
    const r = computeSviRichness(makeSmile(withOutlier, 100), 30 / 365);
    expect(r.params).not.toBeNull();
    const outlier = r.points.find((p) => p.strike === 105)!;
    const others = r.points.filter((p) => p.strike !== 105);
    // The outlier's |zScore| should dominate the rest.
    expect(Math.abs(outlier.zScore!)).toBeGreaterThan(1.5);
    for (const p of others) {
      expect(Math.abs(p.zScore!)).toBeLessThan(Math.abs(outlier.zScore!));
    }
  });
});
