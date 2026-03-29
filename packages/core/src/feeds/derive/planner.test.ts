import { describe, expect, it, vi } from 'vitest';
import type { CachedInstrument } from '../shared/sdk-base.js';
import {
  buildDeriveSubscriptionPlan,
  createDeriveSubscriptionState,
  resetDeriveSubscriptionState,
  subscribeDeriveBatches,
} from './planner.js';

function createInstrument(exchangeSymbol: string): CachedInstrument {
  return {
    symbol: `BTC/USDC:${exchangeSymbol}`,
    exchangeSymbol,
    base: 'BTC',
    quote: 'USDC',
    settle: 'USDC',
    expiry: '2026-03-28',
    strike: 60_000,
    right: 'call',
    inverse: false,
    contractSize: 1,
    tickSize: 0.1,
    minQty: 0.1,
    makerFee: 0.0003,
    takerFee: 0.0003,
  };
}

describe('Derive planner', () => {
  it('builds ticker subscriptions only for new instruments', () => {
    const state = createDeriveSubscriptionState();
    const first = createInstrument('BTC-20260328-60000-C');
    const second = createInstrument('BTC-20260328-65000-C');

    const plan = buildDeriveSubscriptionPlan(state, [first, second]);

    expect(plan.channels).toEqual([
      'ticker_slim.BTC-20260328-60000-C.1000',
      'ticker_slim.BTC-20260328-65000-C.1000',
    ]);
  });

  it('skips already-subscribed tickers', () => {
    const state = createDeriveSubscriptionState();
    const instrument = createInstrument('BTC-20260328-60000-C');

    buildDeriveSubscriptionPlan(state, [instrument]);
    const plan = buildDeriveSubscriptionPlan(state, [instrument]);

    expect(plan.channels).toEqual([]);
  });

  it('subscribes in batches of 100 channels', async () => {
    const subscribe = vi.fn<(channels: string[]) => Promise<void>>().mockResolvedValue();
    const channels = Array.from({ length: 205 }, (_, index) => `ticker_slim.instrument-${index}.1000`);

    await subscribeDeriveBatches(channels, subscribe);

    expect(subscribe).toHaveBeenCalledTimes(3);
    expect(subscribe.mock.calls[0]?.[0]).toHaveLength(100);
    expect(subscribe.mock.calls[1]?.[0]).toHaveLength(100);
    expect(subscribe.mock.calls[2]?.[0]).toHaveLength(5);
  });

  it('resets tracked ticker subscriptions', () => {
    const state = createDeriveSubscriptionState();
    buildDeriveSubscriptionPlan(state, [createInstrument('BTC-20260328-60000-C')]);

    resetDeriveSubscriptionState(state);

    expect(state.subscribedTickers.size).toBe(0);
  });
});
