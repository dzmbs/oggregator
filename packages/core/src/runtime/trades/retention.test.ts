import { describe, expect, it } from 'vitest';
import { TRADE_RUNTIME_BUFFER_SIZE, pushTradeEvents } from './retention.js';
import type { TradeEvent } from './types.js';

function trade(overrides: Partial<TradeEvent> = {}): TradeEvent {
  return {
    venue: 'coincall',
    tradeId: null,
    instrument: 'BTCUSD-15MAY26-65000-C',
    underlying: 'BTC',
    side: 'buy',
    price: 100,
    size: 1,
    iv: null,
    markPrice: null,
    indexPrice: null,
    isBlock: false,
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe('pushTradeEvents', () => {
  it('exposes a buffer size large enough for sparse-venue history', () => {
    expect(TRADE_RUNTIME_BUFFER_SIZE).toBeGreaterThanOrEqual(2000);
  });

  it('is a no-op when given no trades', () => {
    const buffer: TradeEvent[] = [trade({ tradeId: 'a', timestamp: 1 })];
    pushTradeEvents(buffer, []);
    expect(buffer).toHaveLength(1);
  });

  it('keeps trades sorted by timestamp', () => {
    const buffer: TradeEvent[] = [];
    pushTradeEvents(buffer, [
      trade({ tradeId: 'a', timestamp: 30 }),
      trade({ tradeId: 'b', timestamp: 10 }),
      trade({ tradeId: 'c', timestamp: 20 }),
    ]);
    expect(buffer.map((t) => t.tradeId)).toEqual(['b', 'c', 'a']);
  });

  it('trims to maxSize, keeping the most recent', () => {
    const buffer: TradeEvent[] = [];
    const trades = Array.from({ length: 10 }, (_, i) =>
      trade({ tradeId: `t${i}`, timestamp: i + 1 }),
    );
    pushTradeEvents(buffer, trades, 5);
    expect(buffer.map((t) => t.tradeId)).toEqual(['t5', 't6', 't7', 't8', 't9']);
  });

  it('dedupes by venue + tradeId when both are present', () => {
    const buffer: TradeEvent[] = [trade({ tradeId: 'shared', timestamp: 1 })];
    pushTradeEvents(buffer, [
      trade({ tradeId: 'shared', timestamp: 1, price: 999 }),
      trade({ tradeId: 'fresh', timestamp: 2 }),
    ]);
    expect(buffer).toHaveLength(2);
    expect(buffer.find((t) => t.tradeId === 'shared')?.price).toBe(100);
  });

  it('treats same tradeId across different venues as distinct trades', () => {
    const buffer: TradeEvent[] = [trade({ venue: 'coincall', tradeId: '42', timestamp: 1 })];
    pushTradeEvents(buffer, [trade({ venue: 'deribit', tradeId: '42', timestamp: 2 })]);
    expect(buffer).toHaveLength(2);
  });

  it('pushes trades with null tradeId without dedupe — venues without stable ids', () => {
    const buffer: TradeEvent[] = [trade({ tradeId: null, timestamp: 1 })];
    pushTradeEvents(buffer, [
      trade({ tradeId: null, timestamp: 1, price: 200 }),
      trade({ tradeId: null, timestamp: 2 }),
    ]);
    expect(buffer).toHaveLength(3);
  });

  it('dedupes within a single push batch', () => {
    const buffer: TradeEvent[] = [];
    pushTradeEvents(buffer, [
      trade({ tradeId: 'x', timestamp: 1 }),
      trade({ tradeId: 'x', timestamp: 1, price: 200 }),
      trade({ tradeId: 'x', timestamp: 1, price: 300 }),
    ]);
    expect(buffer).toHaveLength(1);
    expect(buffer[0]?.price).toBe(100);
  });

  it('survives a coincall-style reseed without duplicating prior trades', () => {
    const buffer: TradeEvent[] = [];
    const seeded = [
      trade({ tradeId: 'BTCUSD-15MAY26-65000-P:1777134389631', timestamp: 1777134389631 }),
      trade({ tradeId: 'BTCUSD-15MAY26-65000-P:1777290050416', timestamp: 1777290050416 }),
    ];
    pushTradeEvents(buffer, seeded);
    pushTradeEvents(buffer, seeded);
    expect(buffer).toHaveLength(2);
  });
});
