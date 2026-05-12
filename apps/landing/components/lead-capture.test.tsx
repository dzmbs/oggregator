import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, vi } from 'vitest';

import { LeadCaptureSection } from './LeadCaptureSection';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LeadCaptureSection', () => {
  it('submits the email and shows the success state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      }),
    );

    render(React.createElement(LeadCaptureSection));

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'desk@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /request access/i }));

    await waitFor(() => {
      expect(screen.getByText(/you are on the list/i)).toBeInTheDocument();
    });
  });

  it('blocks invalid email input before sending a request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(React.createElement(LeadCaptureSection));

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: /request access/i }));

    await waitFor(() => {
      expect(screen.getByText(/enter a valid work email address/i)).toBeInTheDocument();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
