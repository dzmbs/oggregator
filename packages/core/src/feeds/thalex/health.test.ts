import { describe, expect, it } from 'vitest';
import { deriveThalexHealth } from './health.js';

describe('Thalex health', () => {
  it('reports connected when system_info + instruments present', () => {
    expect(
      deriveThalexHealth({ environment: 'production', api_version: '2.59.0' }, 500),
    ).toEqual({
      status: 'connected',
      message: 'rest health ok (production, v2.59.0)',
    });
  });

  it('degrades when system_info is null', () => {
    expect(deriveThalexHealth(null, 500)).toEqual({
      status: 'degraded',
      message: 'system_info probe failed',
    });
  });

  it('degrades when instrument count is zero', () => {
    expect(deriveThalexHealth({ environment: 'production' }, 0)).toEqual({
      status: 'degraded',
      message: 'no active instruments',
    });
  });

  it('surfaces rest probe failure', () => {
    expect(deriveThalexHealth(null, 0, new Error('fetch failed'))).toEqual({
      status: 'degraded',
      message: 'rest probe failed: Error: fetch failed',
    });
  });
});
