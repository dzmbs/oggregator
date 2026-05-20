import { describe, expect, it } from 'vitest';
import { getHistoryCoverage } from './history-coverage';
import type { IvHistoryPoint } from '@shared/enriched';

function point(ts: number, values: Partial<IvHistoryPoint>): IvHistoryPoint {
  return {
    ts,
    atmIv: null,
    rr25d: null,
    bfly25d: null,
    ...values,
  };
}

describe('getHistoryCoverage', () => {
  it('renders hour coverage for short IV rank history', () => {
    const series = [
      point(1_000, { atmIv: 0.4 }),
      point(5 * 60 * 60 * 1000 + 1_000, { atmIv: 0.42 }),
    ];

    expect(getHistoryCoverage(series, '30d', ['atmIv'])).toEqual({
      label: 'history: 5h / 30d',
      short: true,
      coverageMs: 5 * 60 * 60 * 1000,
    });
  });

  it('renders day coverage when skew spans most of the selected window', () => {
    const series = [
      point(1_000, { rr25d: -0.04 }),
      point(31 * 24 * 60 * 60 * 1000 + 1_000, { bfly25d: 0.01 }),
    ];

    expect(getHistoryCoverage(series, '30d', ['rr25d', 'bfly25d'])).toEqual({
      label: 'history: 31d / 30d',
      short: false,
      coverageMs: 31 * 24 * 60 * 60 * 1000,
    });
  });

  it('ignores points with no selected metric values', () => {
    const series = [
      point(1_000, { atmIv: 0.4 }),
      point(5 * 60 * 60 * 1000 + 1_000, { rr25d: -0.03 }),
    ];

    expect(getHistoryCoverage(series, '90d', ['rr25d'])).toEqual({
      label: 'history: 1m / 90d',
      short: true,
      coverageMs: 0,
    });
  });
});
