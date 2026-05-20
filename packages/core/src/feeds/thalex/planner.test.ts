import { describe, expect, it } from 'vitest';
import type { CachedInstrument } from '../shared/sdk-base.js';
import {
  buildThalexIndexChannel,
  buildThalexNewTickerChannels,
  buildThalexRemovedTickerChannels,
  buildThalexSubscribeMessage,
  buildThalexTickerChannel,
  buildThalexUnsubscribeMessage,
  chunkChannels,
  createThalexSubscriptionState,
  ensureThalexIndexSub,
  resetThalexSubscriptionState,
  THALEX_MAX_CHANNELS_PER_BATCH,
  THALEX_TICKER_DELAY,
} from './planner.js';

function instrument(exchangeSymbol: string): CachedInstrument {
  return {
    symbol: `BTC/USD:USD-${exchangeSymbol}`,
    exchangeSymbol,
    base: 'BTC',
    quote: 'USD',
    settle: 'USD',
    expiry: '2026-04-21',
    strike: 75000,
    right: 'put',
    inverse: false,
    contractSize: 1,
    tickSize: 5,
    minQty: 0.01,
    makerFee: null,
    takerFee: null,
  };
}

describe('Thalex planner', () => {
  it('builds ticker channel names at the default delay tier', () => {
    expect(buildThalexTickerChannel('BTC-21APR26-75000-P')).toBe(
      `ticker.BTC-21APR26-75000-P.${THALEX_TICKER_DELAY}`,
    );
  });

  it('builds index channel names', () => {
    expect(buildThalexIndexChannel('btcusd')).toBe('price_index.BTCUSD');
  });

  it('builds a public/subscribe message with a monotonic id', () => {
    const state = createThalexSubscriptionState();
    const first = buildThalexSubscribeMessage(state, ['ticker.X.1000ms']);
    expect(first).toMatchObject({
      method: 'public/subscribe',
      id: 1,
      params: { channels: ['ticker.X.1000ms'] },
    });
    const second = buildThalexSubscribeMessage(state, ['ticker.Y.1000ms']);
    expect(second['id']).toBe(2);
  });

  it('builds an unsubscribe with method "unsubscribe"', () => {
    const state = createThalexSubscriptionState();
    const msg = buildThalexUnsubscribeMessage(state, ['ticker.X.1000ms']);
    expect(msg['method']).toBe('unsubscribe');
  });

  it('tracks new ticker channels and skips duplicates', () => {
    const state = createThalexSubscriptionState();
    const first = buildThalexNewTickerChannels(state, [
      instrument('BTC-21APR26-75000-P'),
      instrument('BTC-21APR26-80000-C'),
    ]);
    expect(first).toHaveLength(2);
    const again = buildThalexNewTickerChannels(state, [
      instrument('BTC-21APR26-75000-P'),
      instrument('BTC-21APR26-90000-C'),
    ]);
    expect(again).toHaveLength(1);
    expect(again[0]).toContain('90000');
  });

  it('removes tracked channels only if present', () => {
    const state = createThalexSubscriptionState();
    buildThalexNewTickerChannels(state, [instrument('BTC-21APR26-75000-P')]);
    const removed = buildThalexRemovedTickerChannels(state, [
      'BTC-21APR26-75000-P',
      'BTC-21APR26-80000-C',
    ]);
    expect(removed).toHaveLength(1);
    expect(state.tickerChannels.size).toBe(0);
  });

  it('tracks index underlyings uniquely', () => {
    const state = createThalexSubscriptionState();
    expect(ensureThalexIndexSub(state, 'BTCUSD')).toBe('price_index.BTCUSD');
    expect(ensureThalexIndexSub(state, 'BTCUSD')).toBeNull();
    expect(ensureThalexIndexSub(state, 'ETHUSD')).toBe('price_index.ETHUSD');
  });

  it('resets both subscription sets', () => {
    const state = createThalexSubscriptionState();
    buildThalexNewTickerChannels(state, [instrument('BTC-21APR26-75000-P')]);
    ensureThalexIndexSub(state, 'BTCUSD');
    resetThalexSubscriptionState(state);
    expect(state.tickerChannels.size).toBe(0);
    expect(state.indexUnderlyings.size).toBe(0);
  });

  it('chunks channels into batches at the configured size', () => {
    const size = THALEX_MAX_CHANNELS_PER_BATCH;
    const many = Array.from({ length: size + 7 }, (_, i) => `ticker.X${i}.1000ms`);
    const batches = Array.from(chunkChannels(many, size));
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(size);
    expect(batches[1]).toHaveLength(7);
  });
});
