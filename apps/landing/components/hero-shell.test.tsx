import { render, screen } from '@testing-library/react';

import { HeroTerminalSection } from './HeroTerminalSection';
import { LandingHeader } from './LandingHeader';
import { TopTicker } from './TopTicker';

describe('hero shell', () => {
  it('renders live ticker items, navigation, and the spatial surface hero', () => {
    render(
      <>
        <TopTicker />
        <LandingHeader />
        <HeroTerminalSection />
      </>,
    );

    expect(screen.getByText(/btc 30d iv/i)).toBeInTheDocument();
    expect(screen.getByText(/latency budget/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /how it works/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /request access/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /explore surface/i })).toBeInTheDocument();
    expect(screen.getByText(/spatial options intelligence/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/interactive 3d volatility surface/i)).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /3d volatility surface with depth-based telemetry/i }),
    ).toBeInTheDocument();
  });
});
