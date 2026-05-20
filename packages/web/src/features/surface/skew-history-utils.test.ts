import { describe, expect, it } from 'vitest';
import type { IvHistoryPoint } from '@shared/enriched';
import {
  buildSkewLineData,
  formatSkewDisplayValue,
  latestSkewDisplayValue,
  referenceLines,
  zoneFor,
} from './skew-history-utils';

function point(ts: number, values: Partial<IvHistoryPoint>): IvHistoryPoint {
  return {
    ts,
    atmIv: 0.5,
    rr25d: null,
    bfly25d: null,
    ...values,
  };
}

describe('skew history transforms', () => {
  it('raw conversion preserves vol-point values', () => {
    const rows = buildSkewLineData(
      [point(1_000, { rr25d: -0.05 }), point(2_000, { rr25d: -0.04 })],
      'rr25d',
      'raw',
    );

    expect(rows).toEqual([
      { time: 1, value: -5 },
      { time: 2, value: -4 },
    ]);
  });

  it('normalized conversion divides by ATM IV', () => {
    const rows = buildSkewLineData(
      [
        point(1_000, { atmIv: 0.5, rr25d: -0.05 }),
        point(2_000, { atmIv: 0, rr25d: -0.04 }),
        point(3_000, { atmIv: null, rr25d: -0.03 }),
      ],
      'rr25d',
      'normalized',
    );

    expect(rows).toEqual([{ time: 1, value: -10 }]);
  });

  it('z-score uses valid selected-window points', () => {
    const rows = buildSkewLineData(
      [
        point(1_000, { rr25d: -0.06 }),
        point(2_000, { rr25d: -0.05 }),
        point(3_000, { rr25d: -0.04 }),
        point(4_000, { rr25d: null }),
      ],
      'rr25d',
      'zscore',
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]!.value).toBeCloseTo(-1.224744871, 6);
    expect(rows[1]!.value).toBeCloseTo(0, 6);
    expect(rows[2]!.value).toBeCloseTo(1.224744871, 6);
  });

  it('z-score returns no points when the selected window is flat', () => {
    const rows = buildSkewLineData(
      [point(1_000, { bfly25d: 0.01 }), point(2_000, { bfly25d: 0.01 })],
      'bfly25d',
      'zscore',
    );

    expect(rows).toEqual([]);
  });

  it('reference lines vary by mode', () => {
    expect(referenceLines('raw')).toEqual([]);
    expect(referenceLines('normalized').map((r) => r.price)).toEqual([0]);
    expect(referenceLines('zscore').map((r) => r.price)).toEqual([2, 1, 0, -1, -2]);
  });

  it('zoneFor classifies by absolute z-score, only in zscore mode', () => {
    expect(zoneFor(0.4, 'zscore')).toBe('normal');
    expect(zoneFor(-1.2, 'zscore')).toBe('stretched');
    expect(zoneFor(2.5, 'zscore')).toBe('extreme');
    expect(zoneFor(-2, 'zscore')).toBe('extreme');
    expect(zoneFor(1, 'zscore')).toBe('stretched');
    expect(zoneFor(0.4, 'raw')).toBeNull();
    expect(zoneFor(0.4, 'normalized')).toBeNull();
    expect(zoneFor(null, 'zscore')).toBeNull();
    expect(zoneFor(Number.NaN, 'zscore')).toBeNull();
  });

  it('formats latest values for each display mode', () => {
    const series = [
      point(1_000, { rr25d: -0.06 }),
      point(2_000, { rr25d: -0.05 }),
      point(3_000, { rr25d: -0.04 }),
    ];

    expect(formatSkewDisplayValue(latestSkewDisplayValue(series, 'rr25d', 'raw'), 'raw')).toBe(
      '-4.0%',
    );
    expect(
      formatSkewDisplayValue(latestSkewDisplayValue(series, 'rr25d', 'normalized'), 'normalized'),
    ).toBe('-8.0% ATM');
    expect(
      formatSkewDisplayValue(latestSkewDisplayValue(series, 'rr25d', 'zscore'), 'zscore'),
    ).toBe('+1.22σ');
  });
});
