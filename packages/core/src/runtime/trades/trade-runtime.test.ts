import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  TradeRuntime,
  getDeribitTradeCurrency,
  getDeribitUnderlyingFromInstrument,
  normalizeTradeUnderlying,
} from './trade-runtime.js';
import type { TradeEvent } from './types.js';

function makeTrade(underlying: string, price = 70_000, size = 1): TradeEvent {
  return {
    venue: 'bybit', tradeId: null, instrument: `${underlying}-28MAR26-70000-C`,
    underlying, side: 'buy', price, size,
    iv: 0.5, markPrice: price, indexPrice: price,
    isBlock: false, timestamp: Date.now(),
  };
}

function pushTrades(runtime: TradeRuntime, underlying: string, trades: TradeEvent[]) {
  (runtime as unknown as { pushTrades(u: string, t: TradeEvent[]): void }).pushTrades(underlying, trades);
}

function initBuffer(runtime: TradeRuntime, underlying: string) {
  (runtime as unknown as { buffers: Map<string, TradeEvent[]> }).buffers.set(underlying, []);
}

describe('TradeRuntime — Deribit underlying routing', () => {
  it('normalizes request underlyings to their base asset', () => {
    expect(normalizeTradeUnderlying('BTC')).toBe('BTC');
    expect(normalizeTradeUnderlying('AVAX_USDC')).toBe('AVAX');
    expect(normalizeTradeUnderlying('trx_usdc')).toBe('TRX');
  });

  it('maps Deribit live-trade currencies by settlement family', () => {
    expect(getDeribitTradeCurrency('BTC')).toBe('BTC');
    expect(getDeribitTradeCurrency('ETH')).toBe('ETH');
    expect(getDeribitTradeCurrency('AVAX')).toBe('USDC');
    expect(getDeribitTradeCurrency('TRX_USDC')).toBe('USDC');
    expect(getDeribitTradeCurrency('DOGE')).toBeNull();
    expect(getDeribitTradeCurrency('HYPE')).toBeNull();
  });

  it('extracts base assets from Deribit instrument families', () => {
    expect(getDeribitUnderlyingFromInstrument('BTC-29MAR26-70000-C')).toBe('BTC');
    expect(getDeribitUnderlyingFromInstrument('SOL_USDC-3APR26-140-C')).toBe('SOL');
    expect(getDeribitUnderlyingFromInstrument('TRX_USDC-10APR26-0d316-C')).toBe('TRX');
  });
});

describe('TradeRuntime — ring buffer', () => {
  let runtime: TradeRuntime;

  beforeEach(() => {
    runtime = new TradeRuntime();
    initBuffer(runtime, 'BTC');
    initBuffer(runtime, 'ETH');
  });

  afterEach(() => runtime.dispose());

  it('returns empty array for unknown underlying', () => {
    expect(runtime.getTrades('XRP')).toEqual([]);
  });

  it('returns trades pushed to the buffer', () => {
    pushTrades(runtime, 'BTC', [makeTrade('BTC', 70_000), makeTrade('BTC', 71_000)]);
    expect(runtime.getTrades('BTC')).toHaveLength(2);
  });

  it('isolates buffers per underlying', () => {
    pushTrades(runtime, 'BTC', [makeTrade('BTC')]);
    pushTrades(runtime, 'ETH', [makeTrade('ETH', 2_000)]);
    expect(runtime.getTrades('BTC')).toHaveLength(1);
    expect(runtime.getTrades('ETH')).toHaveLength(1);
  });

  it('caps buffer at 500 entries', () => {
    pushTrades(runtime, 'BTC', Array.from({ length: 600 }, (_, i) => makeTrade('BTC', i)));
    expect(runtime.getTrades('BTC')).toHaveLength(500);
  });

  it('keeps the newest 500 entries after overflow', () => {
    pushTrades(runtime, 'BTC', Array.from({ length: 600 }, (_, i) => makeTrade('BTC', i)));
    const trades = runtime.getTrades('BTC');
    expect(trades[0]!.price).toBe(100);
    expect(trades[499]!.price).toBe(599);
  });

  it('filters by minNotional when > 0', () => {
    pushTrades(runtime, 'BTC', [makeTrade('BTC', 100, 1), makeTrade('BTC', 100, 10)]);
    expect(runtime.getTrades('BTC', 500)).toHaveLength(1);
    expect(runtime.getTrades('BTC', 500)[0]!.size).toBe(10);
  });
});

describe('TradeRuntime — reconnect backoff resets after healthy open', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('schedules next reconnect with attempt=0 when the stream previously opened', async () => {
    const runtime = new TradeRuntime();
    initBuffer(runtime, 'BTC');

    const fakes: EventEmitter[] = [];
    const attempts: number[] = [];

    const connectSpy = vi.spyOn(
      runtime as unknown as { connectStream(s: unknown, u: string, attempt: number): void },
      'connectStream',
    ).mockImplementation(function (this: TradeRuntime, stream, underlying, attempt = 0) {
      attempts.push(attempt);

      const fake = new EventEmitter();
      fakes.push(fake);

      let didOpen = false;
      const runtimeAny = this as unknown as {
        connections: Map<string, unknown>;
        reconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
        keepaliveTimers: Map<string, unknown>;
        shouldReconnect: boolean;
      };
      const key = `${(stream as { venue: string }).venue}:${underlying}`;

      fake.on('open', () => {
        didOpen = true;
        runtimeAny.connections.set(key, fake);
      });

      fake.on('close', () => {
        runtimeAny.connections.delete(key);
        const ka = runtimeAny.keepaliveTimers.get(key);
        if (ka) {
          clearInterval(ka as ReturnType<typeof setInterval>);
          runtimeAny.keepaliveTimers.delete(key);
        }

        if (runtimeAny.shouldReconnect) {
          const nextAttempt = didOpen ? 0 : attempt + 1;
          const delay = Math.min(1000 * 2 ** nextAttempt + Math.random() * 500, 30_000);
          const timer = setTimeout(() => {
            runtimeAny.reconnectTimers.delete(key);
            connectSpy.call(this, stream, underlying, nextAttempt);
          }, delay);
          runtimeAny.reconnectTimers.set(key, timer);
        }
      });
    });

    vi.spyOn(
      runtime as unknown as { seedFromRest(u: string): Promise<void> },
      'seedFromRest',
    ).mockResolvedValue(undefined);

    await runtime.start(['BTC']);

    const initialCount = attempts.length;
    expect(attempts.every((attempt) => attempt === 0)).toBe(true);

    fakes[0]!.emit('open');
    fakes[0]!.emit('close');

    expect(attempts.length).toBe(initialCount);

    await vi.advanceTimersByTimeAsync(2_000);

    expect(attempts.length).toBeGreaterThan(initialCount);
    expect(attempts[attempts.length - 1]).toBe(0);

    runtime.dispose();
  });
});

describe('TradeRuntime — start() resolves before seeding finishes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves immediately after opening WS connections, before REST seeds complete', async () => {
    const runtime = new TradeRuntime();
    const order: string[] = [];

    vi.spyOn(
      runtime as unknown as { connectStream(...args: unknown[]): void },
      'connectStream',
    ).mockImplementation(() => { order.push('connect'); });

    vi.spyOn(
      runtime as unknown as { seedFromRest(u: string): Promise<void> },
      'seedFromRest',
    ).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      order.push('seed');
    });

    let resolved = false;
    const promise = runtime.start(['BTC', 'ETH']).then(() => { resolved = true; });

    expect(order.filter((entry) => entry === 'connect').length).toBe(10);

    await Promise.resolve();
    await promise;

    expect(resolved).toBe(true);
    expect(order).not.toContain('seed');

    runtime.dispose();
  });
});
