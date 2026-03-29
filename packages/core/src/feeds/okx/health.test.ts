import { describe, expect, it } from 'vitest';
import { deriveOkxNoticeHealth, deriveOkxStatusHealth } from './health.js';

describe('OKX health', () => {
  it('turns notice events into reconnecting status', () => {
    expect(deriveOkxNoticeHealth({ event: 'notice', code: '64008', msg: 'service upgrade' })).toEqual({
      status: 'reconnecting',
      message: 'service upgrade (64008)',
    });
  });

  it('degrades on active status incidents', () => {
    expect(
      deriveOkxStatusHealth({
        arg: { channel: 'status' },
        data: [{ state: 'ongoing', title: 'Options trading upgrade' }],
      }),
    ).toEqual({
      status: 'degraded',
      message: 'system status ongoing: Options trading upgrade',
    });
  });

  it('reports healthy status when no active incident exists', () => {
    expect(
      deriveOkxStatusHealth({
        arg: { channel: 'status' },
        data: [{ state: 'completed' }],
      }),
    ).toEqual({
      status: 'connected',
      message: 'system status healthy',
    });
  });
});
