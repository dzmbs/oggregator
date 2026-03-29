import { describe, expect, it } from 'vitest';
import {
  applyDeribitPlatformState,
  createDeribitHealthState,
  deriveDeribitPlatformHealth,
  deriveDeribitPublicStatusHealth,
} from './health.js';

describe('Deribit health', () => {
  it('marks maintenance as degraded', () => {
    const state = createDeribitHealthState();

    applyDeribitPlatformState(state, { maintenance: true });

    expect(deriveDeribitPlatformHealth(state)).toEqual({
      status: 'degraded',
      message: 'platform maintenance',
    });
  });

  it('tracks locked indices from platform_state', () => {
    const state = createDeribitHealthState();

    applyDeribitPlatformState(state, { price_index: 'btc_usd', locked: true });
    expect(deriveDeribitPlatformHealth(state)).toEqual({
      status: 'degraded',
      message: 'locked indices: btc_usd',
    });

    applyDeribitPlatformState(state, { price_index: 'btc_usd', locked: false });
    expect(deriveDeribitPlatformHealth(state)).toEqual({
      status: 'connected',
      message: 'platform healthy',
    });
  });

  it('prefers explicit public/status locks over healthy platform state', () => {
    const state = createDeribitHealthState();

    const health = deriveDeribitPublicStatusHealth(state, {
      locked: 'partial',
      locked_indices: ['eth_usd'],
    });

    expect(health).toEqual({
      status: 'degraded',
      message: 'public status locked: eth_usd',
    });
  });

  it('accepts the boolean locked form shown in the public/status example', () => {
    const state = createDeribitHealthState();

    const health = deriveDeribitPublicStatusHealth(state, {
      locked: true,
      locked_currencies: ['BTC', 'ETH'],
    });

    expect(health).toEqual({
      status: 'degraded',
      message: 'public status locked: BTC, ETH',
    });
  });

  it('surfaces probe failures as degraded', () => {
    const state = createDeribitHealthState();
    const health = deriveDeribitPublicStatusHealth(state, null, new Error('timeout'));

    expect(health).toEqual({
      status: 'degraded',
      message: 'public status probe failed: Error: timeout',
    });
  });
});
