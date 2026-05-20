import { describe, expect, it } from 'vitest';
import {
  buildGateioReplayFrames,
  buildGateioSubscribeFrames,
  buildGateioUnsubscribeFrames,
  createGateioSubscriptionState,
} from './planner.js';

const NOW = () => 1747008000;

describe('Gate.io planner', () => {
  it('builds a contract-ticker subscribe frame for two contracts', () => {
    const state = createGateioSubscriptionState();
    const frames = buildGateioSubscribeFrames(
      state,
      ['BTC_USDT-20260626-70000-C', 'BTC_USDT-20260626-70000-P'],
      'BTC_USDT',
      NOW,
    );
    expect(frames).toEqual([
      {
        time: 1747008000,
        channel: 'options.contract_tickers',
        event: 'subscribe',
        payload: ['BTC_USDT-20260626-70000-C', 'BTC_USDT-20260626-70000-P'],
      },
      {
        time: 1747008000,
        channel: 'options.trades',
        event: 'subscribe',
        payload: ['BTC_USDT-20260626-70000-C', 'BTC_USDT-20260626-70000-P'],
      },
      {
        time: 1747008000,
        channel: 'options.order_book_update',
        event: 'subscribe',
        payload: ['BTC_USDT-20260626-70000-C', '20ms', '5'],
      },
      {
        time: 1747008000,
        channel: 'options.order_book_update',
        event: 'subscribe',
        payload: ['BTC_USDT-20260626-70000-P', '20ms', '5'],
      },
      {
        time: 1747008000,
        channel: 'options.underlying_tickers',
        event: 'subscribe',
        payload: ['BTC_USDT'],
      },
    ]);
    expect(state.contracts.has('BTC_USDT-20260626-70000-C')).toBe(true);
    expect(state.underlyings.has('BTC_USDT')).toBe(true);
  });

  it('batches > 50 contracts into multiple frames per channel', () => {
    const state = createGateioSubscriptionState();
    const contracts = Array.from({ length: 130 }, (_, i) => `BTC_USDT-20260626-${i + 1}-C`);
    const frames = buildGateioSubscribeFrames(state, contracts, 'BTC_USDT', NOW);
    const tickerFrames = frames.filter((f) => f.channel === 'options.contract_tickers');
    expect(tickerFrames).toHaveLength(3);
    expect(tickerFrames[0]!.payload.length).toBe(50);
    expect(tickerFrames[2]!.payload.length).toBe(30);
  });

  it('produces replay frames matching tracked state', () => {
    const state = createGateioSubscriptionState();
    buildGateioSubscribeFrames(state, ['BTC_USDT-20260626-70000-C'], 'BTC_USDT', NOW);
    const replay = buildGateioReplayFrames(state, NOW);
    expect(replay.find((f) => f.channel === 'options.contract_tickers')?.payload).toEqual([
      'BTC_USDT-20260626-70000-C',
    ]);
    expect(replay.find((f) => f.channel === 'options.underlying_tickers')?.payload).toEqual([
      'BTC_USDT',
    ]);
  });

  it('unsubscribes the right contracts and drops the underlying when empty', () => {
    const state = createGateioSubscriptionState();
    buildGateioSubscribeFrames(state, ['BTC_USDT-20260626-70000-C'], 'BTC_USDT', NOW);
    const frames = buildGateioUnsubscribeFrames(
      state,
      ['BTC_USDT-20260626-70000-C'],
      'BTC_USDT',
      NOW,
    );
    expect(frames.find((f) => f.channel === 'options.contract_tickers')?.payload).toEqual([
      'BTC_USDT-20260626-70000-C',
    ]);
    expect(frames.find((f) => f.channel === 'options.underlying_tickers')?.payload).toEqual([
      'BTC_USDT',
    ]);
    expect(state.contracts.size).toBe(0);
    expect(state.underlyings.size).toBe(0);
  });
});
