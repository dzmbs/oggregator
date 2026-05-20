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
    expect(screen.getByRole('link', { name: /^terminal$/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /request access/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /see the terminal/i })).toBeInTheDocument();
    expect(screen.getByText(/cross-venue options terminal/i)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/interactive 3d volatility surface/i).length).toBeGreaterThan(
      0,
    );
  });
});
