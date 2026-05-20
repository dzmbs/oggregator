// packages/web/src/features/analytics/oi-by-strike/OiByStrikeCard.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import OiByStrikeCard from './OiByStrikeCard';

// Stub lightweight-charts so the canvas chart never tries to mount in jsdom.
vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => ({
      attachPrimitive: () => undefined,
      setData: () => undefined,
      createPriceLine: () => ({}),
      removePriceLine: () => undefined,
      coordinateToPrice: () => null,
      priceToCoordinate: () => null,
    }),
    subscribeCrosshairMove: () => undefined,
    timeScale: () => ({
      fitContent: () => undefined,
      setVisibleRange: () => undefined,
      getVisibleRange: () => null,
      timeToCoordinate: () => null,
    }),
    remove: () => undefined,
  }),
  ColorType: { Solid: 'solid' },
  LineStyle: { Solid: 0, Dashed: 1, Dotted: 2 },
  CandlestickSeries: 'CandlestickSeries',
}));

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('OiByStrikeCard', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ currency: 'BTC', resolution: 3600, count: 0, candles: [] }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders V1 by default and shows the V1/V2 toggle', () => {
    render(wrap(<OiByStrikeCard chains={[]} spotPrice={null} currency="BTC" />));
    expect(screen.getByRole('button', { name: 'V1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'V2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Contracts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notional'  })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Calls' })).toBeNull();
  });

  it('switches to V2 when V2 is clicked, exposing the Calls/Puts/Both toggles', () => {
    render(wrap(<OiByStrikeCard chains={[]} spotPrice={null} currency="BTC" />));
    fireEvent.click(screen.getByRole('button', { name: 'V2' }));
    expect(screen.getByRole('button', { name: 'Calls' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Puts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Both' })).toBeTruthy();
  });

  it('exposes the A3/A4 significance toggle in V2 with A3 active by default', () => {
    render(wrap(<OiByStrikeCard chains={[]} spotPrice={null} currency="BTC" />));
    fireEvent.click(screen.getByRole('button', { name: 'V2' }));
    const a3 = screen.getByRole('button', { name: 'A3' });
    const a4 = screen.getByRole('button', { name: /A4/ });
    expect(a3.hasAttribute('data-active')).toBe(true);
    expect(a4.hasAttribute('data-active')).toBe(false);
    expect(a4.textContent).toContain('BETA');
    fireEvent.click(a4);
    expect(screen.getByRole('button', { name: /A4/ }).hasAttribute('data-active')).toBe(true);
    expect(screen.getByRole('button', { name: 'A3' }).hasAttribute('data-active')).toBe(false);
  });

  it('exposes timeframe tabs (1d/3d/7d/30d/90d) in V2 with 30d active by default', () => {
    render(wrap(<OiByStrikeCard chains={[]} spotPrice={null} currency="BTC" />));
    fireEvent.click(screen.getByRole('button', { name: 'V2' }));
    for (const tf of ['1d', '3d', '7d', '30d', '90d']) {
      expect(screen.getByRole('button', { name: tf })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: '30d' }).hasAttribute('data-active')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '1d' }));
    expect(screen.getByRole('button', { name: '1d' }).hasAttribute('data-active')).toBe(true);
    expect(screen.getByRole('button', { name: '30d' }).hasAttribute('data-active')).toBe(false);
  });

  it('switches back to V1 when V1 is clicked', () => {
    render(wrap(<OiByStrikeCard chains={[]} spotPrice={null} currency="BTC" />));
    fireEvent.click(screen.getByRole('button', { name: 'V2' }));
    fireEvent.click(screen.getByRole('button', { name: 'V1' }));
    expect(screen.getByRole('button', { name: 'Contracts' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Calls' })).toBeNull();
  });

  it('disables the V2 toggle for non-BTC/ETH underlyings', () => {
    render(wrap(<OiByStrikeCard chains={[]} spotPrice={null} currency="SOL" />));
    const v2Button = screen.getByRole('button', { name: 'V2' });
    expect(v2Button.hasAttribute('disabled')).toBe(true);
    // Clicking the disabled button must NOT swap to V2
    fireEvent.click(v2Button);
    expect(screen.queryByRole('button', { name: 'Calls' })).toBeNull();
  });
});
