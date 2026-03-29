import { beforeEach, describe, expect, it } from 'vitest';
import { BlockTradeRuntime } from './block-trade-runtime.js';
import type { BlockTradeEvent } from './types.js';

function makeBlockTrade(partial: Partial<BlockTradeEvent> = {}): BlockTradeEvent {
  return {
    venue: 'deribit',
    tradeId: partial.tradeId ?? `trade-${Math.random()}`,
    timestamp: partial.timestamp ?? Date.now(),
    underlying: partial.underlying ?? 'BTC',
    direction: partial.direction ?? 'buy',
    strategy: partial.strategy ?? null,
    legs: partial.legs ?? [{
      instrument: 'BTC-28MAR26-70000-C',
      direction: 'buy',
      price: 1_000,
      size: 1,
      ratio: 1,
    }],
    totalSize: partial.totalSize ?? 1,
    notionalUsd: partial.notionalUsd ?? 1_000,
    indexPrice: partial.indexPrice ?? 70_000,
  };
}

function pushTrades(runtime: BlockTradeRuntime, trades: BlockTradeEvent[]) {
  (runtime as unknown as { pushTrades(items: BlockTradeEvent[]): void }).pushTrades(trades);
}

describe('BlockTradeRuntime', () => {
  let runtime: BlockTradeRuntime;

  beforeEach(() => {
    runtime = new BlockTradeRuntime();
  });

  it('returns all trades when no underlying filter is provided', () => {
    pushTrades(runtime, [
      makeBlockTrade({ tradeId: '1', underlying: 'BTC' }),
      makeBlockTrade({ tradeId: '2', underlying: 'ETH' }),
    ]);

    expect(runtime.getTrades()).toHaveLength(2);
  });

  it('filters buffered trades by underlying', () => {
    pushTrades(runtime, [
      makeBlockTrade({ tradeId: '1', underlying: 'BTC' }),
      makeBlockTrade({ tradeId: '2', underlying: 'ETH' }),
    ]);

    expect(runtime.getTrades('BTC')).toHaveLength(1);
    expect(runtime.getTrades('BTC')[0]!.underlying).toBe('BTC');
  });

  it('deduplicates by venue and trade id', () => {
    const trade = makeBlockTrade({ tradeId: 'duplicate' });
    pushTrades(runtime, [trade, trade]);

    expect(runtime.getTrades()).toHaveLength(1);
  });

  it('keeps the newest 300 trades', () => {
    pushTrades(
      runtime,
      Array.from({ length: 350 }, (_, index) => makeBlockTrade({
        tradeId: `trade-${index}`,
        timestamp: index,
      })),
    );

    const trades = runtime.getTrades();
    expect(trades).toHaveLength(300);
    expect(trades[0]!.tradeId).toBe('trade-349');
    expect(trades[299]!.tradeId).toBe('trade-50');
  });

  it('updates venue health lastTradeAt from inserted trades', () => {
    (runtime as unknown as {
      venueState: Map<string, {
        transport: 'ws' | 'poll';
        connected: boolean;
        lastSuccessAt: number | null;
        lastTradeAt: number | null;
        lastStatusAt: number | null;
        lastPollCount: number | null;
        pollLimit: number | null;
        hitLimitCount: number;
        reconnects: number;
        errors: number;
      }>;
    }).venueState.set('deribit', {
      transport: 'ws',
      connected: true,
      lastSuccessAt: null,
      lastTradeAt: null,
      lastStatusAt: null,
      lastPollCount: null,
      pollLimit: null,
      hitLimitCount: 0,
      reconnects: 0,
      errors: 0,
    });

    pushTrades(runtime, [makeBlockTrade({ tradeId: 'health', timestamp: 1234 })]);

    expect(runtime.getHealth()[0]!.lastTradeAt).toBe(1234);
  });
});
