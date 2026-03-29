import { describe, expect, it } from 'vitest';
import type { CachedInstrument } from '../shared/sdk-base.js';
import {
  buildOkxChainSubscriptionArgs,
  buildOkxInstrumentSubscriptionArgs,
  buildOkxReplayArgs,
  buildOkxUnsubscribeArgs,
  createOkxSubscriptionState,
  resetOkxSubscriptionState,
} from './planner.js';

function createInstrument(exchangeSymbol: string, base = 'BTC'): CachedInstrument {
  return {
    symbol: `${base}/USD:${exchangeSymbol}`,
    exchangeSymbol,
    base,
    quote: 'USD',
    settle: base,
    expiry: '2026-03-28',
    strike: 60_000,
    right: 'call',
    inverse: true,
    contractSize: 0.01,
    tickSize: 0.1,
    minQty: 0.1,
    makerFee: 0.0002,
    takerFee: 0.0005,
  };
}

describe('OKX planner', () => {
  it('builds family, ticker, and mark-price subscriptions for a chain', () => {
    const state = createOkxSubscriptionState();
    const args = buildOkxChainSubscriptionArgs(state, 'BTC', [
      createInstrument('BTC-USD-260328-60000-C'),
    ]);

    expect(args).toEqual([
      { channel: 'opt-summary', instFamily: 'BTC-USD' },
      { channel: 'tickers', instId: 'BTC-USD-260328-60000-C' },
      { channel: 'mark-price', instId: 'BTC-USD-260328-60000-C' },
    ]);
  });

  it('adds only instrument-level subscriptions for newly listed contracts', () => {
    const state = createOkxSubscriptionState();
    const args = buildOkxInstrumentSubscriptionArgs(state, [
      createInstrument('BTC-USD-260328-65000-C'),
    ]);

    expect(args).toEqual([
      { channel: 'tickers', instId: 'BTC-USD-260328-65000-C' },
      { channel: 'mark-price', instId: 'BTC-USD-260328-65000-C' },
    ]);
  });

  it('replays and unsubscribes from all tracked subscriptions', () => {
    const state = createOkxSubscriptionState();
    buildOkxChainSubscriptionArgs(state, 'BTC', [createInstrument('BTC-USD-260328-60000-C')]);
    buildOkxInstrumentSubscriptionArgs(state, [createInstrument('ETH-USD-260328-3000-C', 'ETH')]);

    expect(buildOkxReplayArgs(state)).toEqual(buildOkxUnsubscribeArgs(state));
  });

  it('resets tracked subscriptions', () => {
    const state = createOkxSubscriptionState();
    buildOkxChainSubscriptionArgs(state, 'BTC', [createInstrument('BTC-USD-260328-60000-C')]);
    resetOkxSubscriptionState(state);

    expect(state.subscribedFamilies.size).toBe(0);
    expect(state.subscribedTickers.size).toBe(0);
    expect(state.subscribedMarkPrice.size).toBe(0);
  });
});
