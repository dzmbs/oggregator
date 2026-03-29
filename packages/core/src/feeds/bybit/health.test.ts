import { describe, expect, it } from 'vitest';
import { deriveBybitHealth } from './health.js';

describe('Bybit health', () => {
  it('degrades when the system status endpoint reports active maintenance', () => {
    expect(
      deriveBybitHealth({
        retCode: 0,
        retMsg: 'OK',
        result: { list: [{ state: 'ongoing', title: 'Option engine upgrade' }] },
      }),
    ).toEqual({
      status: 'degraded',
      message: 'system status ongoing: Option engine upgrade',
    });
  });

  it('reports healthy when no active maintenance exists', () => {
    expect(
      deriveBybitHealth({
        retCode: 0,
        retMsg: 'OK',
        result: { list: [{ state: 'completed' }] },
      }),
    ).toEqual({
      status: 'connected',
      message: 'system status healthy',
    });
  });

  it('surfaces system status probe failures', () => {
    expect(deriveBybitHealth(null, new Error('timeout'))).toEqual({
      status: 'degraded',
      message: 'system status probe failed: Error: timeout',
    });
  });
});
