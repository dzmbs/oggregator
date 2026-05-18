import { render, screen } from '@testing-library/react';

import HomePage from './page';

describe('landing page', () => {
  it('renders the app-like landing architecture', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', {
        name: /one terminal\. every venue\./i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: /surface\. chain\. portfolio\./i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: /answers before the call/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /request access/i }).length).toBeGreaterThan(0);
  });
});
