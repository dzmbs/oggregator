import { render, screen } from '@testing-library/react';

import { HeroTerminalSection } from './HeroTerminalSection';
import { LandingHeader } from './LandingHeader';
import { TopTicker } from './TopTicker';

describe('hero shell', () => {
  it('renders live ticker items, navigation, and the app-like surface hero', () => {
    render(
      <>
        <TopTicker />
        <LandingHeader />
        <HeroTerminalSection />
      </>,
    );

    expect(
      screen.getAllByText(/coincall low fees \+ deep options liquidity/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/thalex private feed synced to portfolio workspace/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /how it works/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /request access/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /explore surface/i })).toBeInTheDocument();
    expect(screen.getByText(/terminal-first options intelligence/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/interactive 3d volatility surface/i)).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: /simulated live volatility surface inspired by the app view/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /portfolio workspace screenshot from the live app/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /chain workspace screenshot from the live app/i }),
    ).toBeInTheDocument();
  });
});
