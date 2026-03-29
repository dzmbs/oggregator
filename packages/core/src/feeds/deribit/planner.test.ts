import { describe, expect, it } from 'vitest';
import type { CachedInstrument } from '../shared/sdk-base.js';
import {
  buildDeribitSubscriptionPlan,
  createDeribitSubscriptionState,
  deribitIndexNameFor,
  releaseDeribitTickerSubscription,
  resetDeribitSubscriptionState,
} from './planner.js';

function createInstrument(exchangeSymbol: string): CachedInstrument {
  return {
    symbol: `BTC/USD:BTC-260101-${exchangeSymbol.endsWith('C') ? '100-C' : '100-P'}`,
    exchangeSymbol,
    base: 'BTC',
    quote: 'BTC',
    settle: 'BTC',
    expiry: '2026-01-01',
    strike: 100,
    right: exchangeSymbol.endsWith('C') ? 'call' : 'put',
    inverse: true,
    contractSize: 1,
    tickSize: 0.0005,
    minQty: 0.1,
    makerFee: 0.0003,
    takerFee: 0.0003,
  };
}

describe('Deribit planner', () => {
  it('builds initial bulk and ticker subscriptions for a chain', () => {
    const state = createDeribitSubscriptionState();
    const plan = buildDeribitSubscriptionPlan(
      state,
      'BTC',
      [createInstrument('BTC-1JAN26-100-C')],
      'agg2',
    );

    expect(plan.indexName).toBe('btc_usd');
    expect(plan.bulkChannels).toEqual([
      'markprice.options.btc_usd',
      'deribit_price_index.btc_usd',
    ]);
    expect(plan.tickerChannels).toEqual(['ticker.BTC-1JAN26-100-C.agg2']);
    expect(plan.channelsToUnsubscribe).toEqual([]);
  });

  it('upgrades ticker interval without re-requesting bulk channels', () => {
    const state = createDeribitSubscriptionState();
    const instrument = createInstrument('BTC-1JAN26-100-C');

    buildDeribitSubscriptionPlan(state, 'BTC', [instrument], 'agg2');
    const plan = buildDeribitSubscriptionPlan(state, 'BTC', [instrument], '100ms');

    expect(plan.bulkChannels).toEqual([]);
    expect(plan.channelsToUnsubscribe).toEqual(['ticker.BTC-1JAN26-100-C.agg2']);
    expect(plan.tickerChannels).toEqual(['ticker.BTC-1JAN26-100-C.100ms']);
  });

  it('releases per-instrument ticker subscriptions cleanly', () => {
    const state = createDeribitSubscriptionState();
    const instrument = createInstrument('BTC-1JAN26-100-C');

    buildDeribitSubscriptionPlan(state, 'BTC', [instrument], '100ms');
    const channel = releaseDeribitTickerSubscription(state, instrument.exchangeSymbol);

    expect(channel).toBe('ticker.BTC-1JAN26-100-C.100ms');
    expect(state.subscribedTickers.has(instrument.exchangeSymbol)).toBe(false);
    expect(state.tickerIntervals.has(instrument.exchangeSymbol)).toBe(false);
  });

  it('resets all tracked subscriptions on full teardown', () => {
    const state = createDeribitSubscriptionState();
    buildDeribitSubscriptionPlan(state, 'BTC', [createInstrument('BTC-1JAN26-100-C')], '100ms');

    resetDeribitSubscriptionState(state);

    expect(state.subscribedIndexes.size).toBe(0);
    expect(state.subscribedPriceIndexes.size).toBe(0);
    expect(state.subscribedTickers.size).toBe(0);
    expect(state.tickerIntervals.size).toBe(0);
  });

  it('derives stable index names for usd and explicit quote underlyings', () => {
    expect(deribitIndexNameFor('BTC')).toBe('btc_usd');
    expect(deribitIndexNameFor('BTC_USDC')).toBe('btc_usdc');
  });
});
