import { describe, expect, it } from 'vitest';
import { deriveDeriveHealth } from './health.js';

describe('Derive health', () => {
  it('reports healthy probes when time is valid and incidents are empty', () => {
    expect(
      deriveDeriveHealth({
        serverTime: 123,
        incidents: { incidents: [] },
      }),
    ).toEqual({
      status: 'connected',
      message: 'incident probe healthy',
    });
  });

  it('degrades when the time probe is invalid', () => {
    expect(
      deriveDeriveHealth({
        serverTime: null,
        incidents: { incidents: [] },
      }),
    ).toEqual({
      status: 'degraded',
      message: 'time probe failed',
    });
  });

  it('degrades when live incidents are reported', () => {
    expect(
      deriveDeriveHealth({
        serverTime: 123,
        incidents: { incidents: [{ id: 'incident-1' }] },
      }),
    ).toEqual({
      status: 'degraded',
      message: 'live incidents: 1',
    });
  });

  it('degrades when the probe throws', () => {
    expect(
      deriveDeriveHealth({
        serverTime: null,
        incidents: null,
        error: new Error('timeout'),
      }),
    ).toEqual({
      status: 'degraded',
      message: 'health probe failed: Error: timeout',
    });
  });
});
