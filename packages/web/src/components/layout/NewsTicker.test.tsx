import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

vi.mock('@hooks/useNewsFeed', () => ({
  useNewsFeed: () => ({
    data: Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`,
      text: i === 0 ? 'BREAKING: Fed pauses rate hikes' : `tweet ${i}`,
      url: `https://x.com/zerohedge/status/${i}`,
      source: 'Twitter[breaking-news] - @zerohedge',
      handle: 'zerohedge',
      ruleTag: 'breaking-news',
      timestamp: i,
      classification: 'GOOD' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    })),
  }),
}));

vi.mock('@hooks/useSpots', () => ({
  useSpots: () => ({
    data: [
      { symbol: 'BTCUSDT', lastPrice: 67432, change24hPct: 0.0041, updatedAt: 0 },
    ],
  }),
}));

import { NewsTicker } from './NewsTicker';

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('NewsTicker', () => {
  afterEach(() => cleanup());

  it('renders spot chips with base symbol and change', () => {
    render(wrap(<NewsTicker />));
    expect(screen.getAllByText('BTC').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+0.41%').length).toBeGreaterThan(0);
  });

  it('renders news chips as external links', () => {
    render(wrap(<NewsTicker />));
    const links = screen.getAllByRole('link');
    const tweetLink = links.find((a) => a.getAttribute('href')?.includes('x.com'));
    expect(tweetLink).toBeDefined();
    expect(tweetLink!.getAttribute('target')).toBe('_blank');
    expect(tweetLink!.getAttribute('rel')).toContain('noopener');
  });

  it('renders a Coincall sponsor chip with sponsored rel and data attribute', () => {
    render(wrap(<NewsTicker />));
    const links = screen.getAllByRole('link');
    const sponsor = links.find((a) => a.getAttribute('href')?.includes('coincall.com'));
    expect(sponsor).toBeDefined();
    expect(sponsor!.getAttribute('rel')).toContain('sponsored');
    expect(sponsor!.getAttribute('data-sponsor')).toBe('coincall');
  });
});

