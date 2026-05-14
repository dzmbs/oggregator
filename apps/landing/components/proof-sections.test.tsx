import { fireEvent, render, screen } from '@testing-library/react';

import { FaqSection } from './FaqSection';
import { FeatureBentoSection } from './FeatureBentoSection';
import { HowItWorksSection } from './HowItWorksSection';

describe('proof sections', () => {
  it('renders workflow and feature proof for the spatial experience', () => {
    render(
      <>
        <HowItWorksSection />
        <FeatureBentoSection />
      </>,
    );

    expect(
      screen.getByRole('heading', {
        name: /one surface, three disclosure depths\./i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^overview$/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: /modes, overlays, and clutter control\./i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/one object, four ways to read it/i)).toBeInTheDocument();
    expect(screen.getByText(/progressive disclosure by proximity/i)).toBeInTheDocument();
    expect(screen.getByText(/liquidity mode/i)).toBeInTheDocument();
  });

  it('opens and closes FAQ items', () => {
    render(<FaqSection />);

    expect(
      screen.getByText(/the platform is designed for multi-exchange options aggregation/i),
    ).toBeInTheDocument();

    const button = screen.getByRole('button', {
      name: /how fast is the feed and routing update cycle/i,
    });

    fireEvent.click(button);

    expect(
      screen.getByText(/the terminal is tuned for sub-second visibility/i),
    ).toBeInTheDocument();
  });
});
