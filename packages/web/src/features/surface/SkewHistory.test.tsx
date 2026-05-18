import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SkewHistory from './SkewHistory';

vi.mock('lightweight-charts', () => ({
  ColorType: { Solid: 'solid' },
  LineSeries: 'LineSeries',
  AreaSeries: 'AreaSeries',
  BaselineSeries: 'BaselineSeries',
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
  createChart: vi.fn(() => ({
    addSeries: vi.fn(() => ({
      setData: vi.fn(),
      createPriceLine: vi.fn(),
    })),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    remove: vi.fn(),
  })),
}));

vi.mock('@lib/token-meta', () => ({
  getTokenLogo: () => null,
}));

vi.mock('./queries', () => ({
  useIvHistory: () => ({
    data: {
      underlying: 'BTC',
      windowDays: 30,
      tenors: {
        '7d': { series: [], current: {}, min: {}, max: {} },
        '30d': {
          series: [
            { ts: 1_000, atmIv: 0.5, rr25d: -0.06, bfly25d: 0.01 },
            { ts: 2_000, atmIv: 0.5, rr25d: -0.05, bfly25d: 0.02 },
            { ts: 3_000, atmIv: 0.5, rr25d: -0.04, bfly25d: 0.03 },
          ],
          current: {},
          min: {},
          max: {},
        },
        '60d': { series: [], current: {}, min: {}, max: {} },
        '90d': { series: [], current: {}, min: {}, max: {} },
      },
    },
  }),
}));

describe('SkewHistory', () => {
  it('switches latest values between raw, normalized, and z-score modes', () => {
    render(<SkewHistory underlying="BTC" />);

    expect(screen.getByRole('button', { name: 'Raw' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Normalized' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Z-Score' })).toBeTruthy();
    expect(screen.getByText('-8.0% ATM')).toBeTruthy();
    expect(screen.getByText('Default lens: skew relative to ATM IV')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Z-Score' }));
    expect(screen.getAllByText('+1.22σ')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
    expect(screen.getByText('-4.0%')).toBeTruthy();
  });
});
