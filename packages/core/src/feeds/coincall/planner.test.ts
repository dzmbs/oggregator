import { describe, expect, it } from 'vitest';
import type { CachedInstrument } from '../shared/sdk-base.js';
import {
  buildBsInfoSubscribeMessage,
  buildBsInfoUnsubscribeMessage,
  buildCoincallNewBsInfoSymbols,
  buildCoincallNewOrderBookSymbols,
  buildCoincallRemovedBsInfoSymbols,
  buildCoincallRemovedOrderBookSymbols,
  buildOrderBookSubscribeMessage,
  buildOrderBookUnsubscribeMessage,
  buildTOptionSubscribeMessage,
  createCoincallSubscriptionState,
  ensureCoincallTOptionSub,
  pairRootFor,
  removeCoincallTOptionSub,
  resetCoincallSubscriptionState,
} from './planner.js';

function instrument(exchangeSymbol: string): CachedInstrument {
  return {
    symbol: `BTC/USD:USD-${exchangeSymbol}`,
    exchangeSymbol,
    base: 'BTC',
    quote: 'USD',
    settle: 'USD',
    expiry: '2026-03-28',
    strike: 70000,
    right: 'call',
    inverse: false,
    contractSize: 0.01,
    tickSize: 0.1,
    minQty: 0.01,
    makerFee: 0.0003,
    takerFee: 0.0004,
  };
}

describe('Coincall planner', () => {
  it('builds a bsInfo subscribe message with the real action/dataType shape', () => {
    expect(buildBsInfoSubscribeMessage('BTCUSD-28MAR26-70000-C')).toEqual({
      action: 'subscribe',
      dataType: 'bsInfo',
      payload: { symbol: 'BTCUSD-28MAR26-70000-C' },
    });
  });

  it('builds a bsInfo unsubscribe with action:unsubscribe', () => {
    expect(buildBsInfoUnsubscribeMessage('BTCUSD-28MAR26-70000-C').action).toBe('unsubscribe');
  });

  it('builds an orderBook subscribe message per instrument', () => {
    expect(buildOrderBookSubscribeMessage('BTCUSD-28MAR26-70000-C')).toEqual({
      action: 'subscribe',
      dataType: 'orderBook',
      payload: { symbol: 'BTCUSD-28MAR26-70000-C' },
    });
  });

  it('builds an orderBook unsubscribe with action:unsubscribe', () => {
    expect(buildOrderBookUnsubscribeMessage('BTCUSD-28MAR26-70000-C').action).toBe('unsubscribe');
  });

  it('builds a tOption subscribe with pair root and ms cutoff', () => {
    expect(buildTOptionSubscribeMessage('BTCUSD', 1776758400000)).toEqual({
      action: 'subscribe',
      dataType: 'tOption',
      payload: { symbol: 'BTCUSD', end: 1776758400000 },
    });
  });

  it('tracks new bsInfo symbols and skips duplicates', () => {
    const state = createCoincallSubscriptionState();
    const first = buildCoincallNewBsInfoSymbols(state, [instrument('A-C'), instrument('B-C')]);
    expect(first).toEqual(['A-C', 'B-C']);
    const again = buildCoincallNewBsInfoSymbols(state, [instrument('A-C'), instrument('C-C')]);
    expect(again).toEqual(['C-C']);
  });

  it('removes tracked bsInfo symbols only if present', () => {
    const state = createCoincallSubscriptionState();
    buildCoincallNewBsInfoSymbols(state, [instrument('A-C')]);
    expect(buildCoincallRemovedBsInfoSymbols(state, ['A-C', 'B-C'])).toEqual(['A-C']);
    expect(state.bsInfoSymbols.size).toBe(0);
  });

  it('tracks new orderBook symbols independently from bsInfo', () => {
    const state = createCoincallSubscriptionState();
    const first = buildCoincallNewOrderBookSymbols(state, [instrument('A-C'), instrument('B-C')]);
    expect(first).toEqual(['A-C', 'B-C']);
    const again = buildCoincallNewOrderBookSymbols(state, [instrument('A-C'), instrument('C-C')]);
    expect(again).toEqual(['C-C']);
  });

  it('removes tracked orderBook symbols only if present', () => {
    const state = createCoincallSubscriptionState();
    buildCoincallNewOrderBookSymbols(state, [instrument('A-C')]);
    expect(buildCoincallRemovedOrderBookSymbols(state, ['A-C', 'B-C'])).toEqual(['A-C']);
    expect(state.orderBookSymbols.size).toBe(0);
  });

  it('tracks tOption subs uniquely by (pairRoot, expiryMs)', () => {
    const state = createCoincallSubscriptionState();
    expect(ensureCoincallTOptionSub(state, 'BTCUSD', 100)).toBe(true);
    expect(ensureCoincallTOptionSub(state, 'BTCUSD', 100)).toBe(false);
    expect(ensureCoincallTOptionSub(state, 'BTCUSD', 200)).toBe(true);
    expect(state.tOptionKeys.has('BTCUSD:100')).toBe(true);
    expect(state.tOptionKeys.has('BTCUSD:200')).toBe(true);
  });

  it('removes tOption subs that were tracked', () => {
    const state = createCoincallSubscriptionState();
    ensureCoincallTOptionSub(state, 'BTCUSD', 100);
    expect(removeCoincallTOptionSub(state, 'BTCUSD', 100)).toBe(true);
    expect(removeCoincallTOptionSub(state, 'BTCUSD', 100)).toBe(false);
  });

  it('resets both subscription sets', () => {
    const state = createCoincallSubscriptionState();
    buildCoincallNewBsInfoSymbols(state, [instrument('A-C')]);
    buildCoincallNewOrderBookSymbols(state, [instrument('A-C')]);
    ensureCoincallTOptionSub(state, 'BTCUSD', 100);
    resetCoincallSubscriptionState(state);
    expect(state.bsInfoSymbols.size).toBe(0);
    expect(state.orderBookSymbols.size).toBe(0);
    expect(state.tOptionKeys.size).toBe(0);
  });

  it('builds the pair root from a base asset', () => {
    expect(pairRootFor('btc')).toBe('BTCUSD');
    expect(pairRootFor('ETH')).toBe('ETHUSD');
  });
});
