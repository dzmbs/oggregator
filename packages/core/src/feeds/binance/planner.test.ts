import { describe, expect, it } from 'vitest';
import type { CachedInstrument } from '../shared/sdk-base.js';
import {
  buildBinanceChainStreams,
  buildBinanceInitialStreams,
  confirmBinanceSubscribedStreams,
  createBinanceSubscriptionState,
  resetBinanceSubscriptionState,
  rollbackBinancePendingStreams,
  trackBinanceStreams,
} from './planner.js';

function createInstrument(exchangeSymbol: string, base = 'BTC', settle = 'USDT'): CachedInstrument {
  return {
    symbol: `${base}/${settle}:${exchangeSymbol}`,
    exchangeSymbol,
    base,
    quote: settle,
    settle,
    expiry: '2026-03-28',
    strike: 60_000,
    right: 'call',
    inverse: false,
    contractSize: 1,
    tickSize: 0.1,
    minQty: 0.1,
    makerFee: 0.0002,
    takerFee: 0.0005,
  };
}

describe('Binance planner', () => {
  it('builds initial mark-price, new-symbol, and oi streams', () => {
    const streams = buildBinanceInitialStreams([
      createInstrument('BTC-260328-60000-C'),
      createInstrument('BTC-260328-65000-C'),
    ]);

    expect(streams).toContain('btcusdt@optionMarkPrice');
    expect(streams).toContain('!optionSymbol');
    expect(streams).toContain('btcusdt@openInterest@260328');
  });

  it('tracks only newly added streams until Binance confirms the subscribe', () => {
    const state = createBinanceSubscriptionState();
    const first = trackBinanceStreams(state, ['a', 'b']);
    const second = trackBinanceStreams(state, ['b', 'c']);
    confirmBinanceSubscribedStreams(state, ['a', 'b']);

    expect(first).toEqual(['a', 'b']);
    expect(second).toEqual(['c']);
    expect([...state.subscribedStreams]).toEqual(['a', 'b']);
    expect([...state.pendingSubscribeStreams]).toEqual(['c']);
  });

  it('rolls back pending streams when a subscribe request is rejected', () => {
    const state = createBinanceSubscriptionState();
    trackBinanceStreams(state, ['a', 'b']);

    rollbackBinancePendingStreams(state, ['a']);

    expect([...state.pendingSubscribeStreams]).toEqual(['b']);
  });

  it('builds chain streams for targeted subscriptions', () => {
    const streams = buildBinanceChainStreams('BTC', [createInstrument('BTC-260328-60000-C')]);
    expect(streams).toEqual([
      'btcusdt@optionMarkPrice',
      'btcusdt@openInterest@260328',
    ]);
  });

  it('resets tracked streams', () => {
    const state = createBinanceSubscriptionState();
    trackBinanceStreams(state, ['a', 'b']);
    resetBinanceSubscriptionState(state);
    expect(state.subscribedStreams.size).toBe(0);
    expect(state.pendingSubscribeStreams.size).toBe(0);
  });
});
