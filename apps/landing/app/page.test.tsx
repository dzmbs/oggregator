import { render, screen } from '@testing-library/react';

import HomePage from './page';

describe('landing page', () => {
  it('renders the app-like landing architecture', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', {
        name: /the landing page now moves like the app/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: /one surface, three disclosure depths/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: /technical answers before the onboarding call/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: /simulated live volatility surface inspired by the app view/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /request access/i }).length).toBeGreaterThan(0);
  });
});
