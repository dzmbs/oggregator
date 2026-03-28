import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  FlowService,
  getDeribitTradeCurrency,
  getDeribitUnderlyingFromInstrument,
  normalizeTradeUnderlying,
} from './flow.js';
import type { TradeEvent } from './flow.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTrade(underlying: string, price = 70_000, size = 1): TradeEvent {
  return {
    venue: 'bybit', tradeId: null, instrument: `${underlying}-28MAR26-70000-C`,
    underlying, side: 'buy', price, size,
    iv: 0.5, markPrice: price, indexPrice: price,
    isBlock: false, timestamp: Date.now(),
  };
}

function pushTrades(svc: FlowService, underlying: string, trades: TradeEvent[]) {
  (svc as unknown as { pushTrades(u: string, t: TradeEvent[]): void }).pushTrades(underlying, trades);
}

function initBuffer(svc: FlowService, underlying: string) {
  (svc as unknown as { buffers: Map<string, TradeEvent[]> }).buffers.set(underlying, []);
}

// ── Deribit underlying routing ────────────────────────────────────────────────

describe('FlowService — Deribit underlying routing', () => {
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

// ── ring buffer ───────────────────────────────────────────────────────────────

describe('FlowService — ring buffer', () => {
  let svc: FlowService;

  beforeEach(() => {
    svc = new FlowService();
    initBuffer(svc, 'BTC');
    initBuffer(svc, 'ETH');
  });

  afterEach(() => svc.dispose());

  it('returns empty array for unknown underlying', () => {
    expect(svc.getTrades('XRP')).toEqual([]);
  });

  it('returns trades pushed to the buffer', () => {
    pushTrades(svc, 'BTC', [makeTrade('BTC', 70_000), makeTrade('BTC', 71_000)]);
    expect(svc.getTrades('BTC')).toHaveLength(2);
  });

  it('isolates buffers per underlying', () => {
    pushTrades(svc, 'BTC', [makeTrade('BTC')]);
    pushTrades(svc, 'ETH', [makeTrade('ETH', 2_000)]);
    expect(svc.getTrades('BTC')).toHaveLength(1);
    expect(svc.getTrades('ETH')).toHaveLength(1);
  });

  it('caps buffer at 500 entries', () => {
    pushTrades(svc, 'BTC', Array.from({ length: 600 }, (_, i) => makeTrade('BTC', i)));
    expect(svc.getTrades('BTC')).toHaveLength(500);
  });

  it('keeps the newest 500 entries after overflow', () => {
    pushTrades(svc, 'BTC', Array.from({ length: 600 }, (_, i) => makeTrade('BTC', i)));
    const trades = svc.getTrades('BTC');
    expect(trades[0]!.price).toBe(100);   // oldest evicted: prices 0-99
    expect(trades[499]!.price).toBe(599);
  });

  it('filters by minNotional when > 0', () => {
    pushTrades(svc, 'BTC', [makeTrade('BTC', 100, 1), makeTrade('BTC', 100, 10)]);
    expect(svc.getTrades('BTC', 500)).toHaveLength(1);
    expect(svc.getTrades('BTC', 500)[0]!.size).toBe(10);
  });

  it('returns all trades when minNotional is 0', () => {
    pushTrades(svc, 'BTC', [makeTrade('BTC', 100, 1), makeTrade('BTC', 100, 10)]);
    expect(svc.getTrades('BTC', 0)).toHaveLength(2);
  });

  it('returns all trades when minNotional is negative', () => {
    pushTrades(svc, 'BTC', [makeTrade('BTC')]);
    expect(svc.getTrades('BTC', -999)).toHaveLength(1);
  });
});

// ── reconnect backoff reset ───────────────────────────────────────────────────
//
// The real behaviour in connectStream:
//   - `let didOpen = false` tracks whether the WS reached OPEN
//   - on 'close': nextAttempt = didOpen ? 0 : attempt + 1
//
// This test drives a fake WS through open→close and asserts that the
// subsequent reconnect call uses attempt=0, not attempt+1.

describe('FlowService — reconnect backoff resets after healthy open', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('schedules next reconnect with attempt=0 when the stream previously opened', async () => {
    const svc = new FlowService();
    initBuffer(svc, 'BTC');

    // Each connectStream call gets a controllable fake WS.
    const fakes: EventEmitter[] = [];
    const attempts: number[] = [];

    const connectSpy = vi.spyOn(
      svc as unknown as { connectStream(s: unknown, u: string, attempt: number): void },
      'connectStream',
    ).mockImplementation(function (this: FlowService, stream, underlying, attempt = 0) {
      attempts.push(attempt);

      const fake = new EventEmitter();
      fakes.push(fake);

      // Replicates the didOpen flag from the real connectStream so the spy
      // produces the same nextAttempt=0 vs attempt+1 branching under test.
      let didOpen = false;
      const svcAny = this as unknown as {
        connections: Map<string, unknown>;
        reconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
        keepaliveTimers: Map<string, unknown>;
        shouldReconnect: boolean;
      };
      const key = `${(stream as { venue: string }).venue}:${underlying}`;

      fake.on('open', () => {
        didOpen = true;
        svcAny.connections.set(key, fake);
      });

      fake.on('close', () => {
        svcAny.connections.delete(key);
        const ka = svcAny.keepaliveTimers.get(key);
        if (ka) { clearInterval(ka as ReturnType<typeof setInterval>); svcAny.keepaliveTimers.delete(key); }

        if (svcAny.shouldReconnect) {
          const nextAttempt = didOpen ? 0 : attempt + 1;
          const delay = Math.min(1000 * 2 ** nextAttempt + Math.random() * 500, 30_000);
          const timer = setTimeout(() => {
            svcAny.reconnectTimers.delete(key);
            connectSpy.call(this, stream, underlying, nextAttempt);
          }, delay);
          svcAny.reconnectTimers.set(key, timer);
        }
      });
    });

    // Stub seeding so start() resolves immediately.
    vi.spyOn(
      svc as unknown as { seedFromRest(u: string): Promise<void> },
      'seedFromRest',
    ).mockResolvedValue(undefined);

    await svc.start(['BTC']);

    // All initial connections use attempt=0.
    const initialCount = attempts.length;
    expect(attempts.every(a => a === 0)).toBe(true);

    // Drive the first fake WS through a healthy lifecycle:
    // open (didOpen=true) then close → nextAttempt must be 0.
    const firstFake = fakes[0]!;
    firstFake.emit('open');
    firstFake.emit('close');

    // No immediate reconnect — it's behind a setTimeout.
    expect(attempts.length).toBe(initialCount);

    // Advance past the ~1s delay (attempt=0 backoff).
    await vi.advanceTimersByTimeAsync(2_000);

    // connectStream was called again — and crucially with attempt=0, not attempt=1.
    expect(attempts.length).toBeGreaterThan(initialCount);
    expect(attempts[attempts.length - 1]).toBe(0);

    svc.dispose();
  });

  it('increments attempt when the stream never opened (connection refused)', async () => {
    const svc = new FlowService();
    initBuffer(svc, 'BTC');

    const fakes: EventEmitter[] = [];
    const attempts: number[] = [];

    const connectSpy = vi.spyOn(
      svc as unknown as { connectStream(s: unknown, u: string, attempt: number): void },
      'connectStream',
    ).mockImplementation(function (this: FlowService, stream, underlying, attempt = 0) {
      attempts.push(attempt);
      const fake = new EventEmitter();
      fakes.push(fake);

      const svcAny = this as unknown as {
        connections: Map<string, unknown>;
        reconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
        keepaliveTimers: Map<string, unknown>;
        shouldReconnect: boolean;
      };
      const key = `${(stream as { venue: string }).venue}:${underlying}`;

      fake.on('close', () => {
        svcAny.connections.delete(key);
        if (svcAny.shouldReconnect) {
          const nextAttempt = attempt + 1;
          const delay = Math.min(1000 * 2 ** nextAttempt + Math.random() * 500, 30_000);
          const timer = setTimeout(() => {
            svcAny.reconnectTimers.delete(key);
            connectSpy.call(this, stream, underlying, nextAttempt);
          }, delay);
          svcAny.reconnectTimers.set(key, timer);
        }
      });
    });

    vi.spyOn(
      svc as unknown as { seedFromRest(u: string): Promise<void> },
      'seedFromRest',
    ).mockResolvedValue(undefined);

    await svc.start(['BTC']);

    const initialCount = attempts.length;

    // Close without open → attempt should increment.
    fakes[0]!.emit('close');
    await vi.advanceTimersByTimeAsync(5_000); // attempt=1 → delay ~2s

    expect(attempts.length).toBeGreaterThan(initialCount);
    expect(attempts[attempts.length - 1]).toBe(1);

    svc.dispose();
  });
});

// ── start() resolves before seeding finishes ──────────────────────────────────

describe('FlowService — start() resolves before seeding finishes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves immediately after opening WS connections, before REST seeds complete', async () => {
    const svc = new FlowService();
    const order: string[] = [];

    vi.spyOn(
      svc as unknown as { connectStream(...a: unknown[]): void },
      'connectStream',
    ).mockImplementation(() => { order.push('connect'); });

    vi.spyOn(
      svc as unknown as { seedFromRest(u: string): Promise<void> },
      'seedFromRest',
    ).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 10_000));
      order.push('seed');
    });

    let resolved = false;
    const p = svc.start(['BTC', 'ETH']).then(() => { resolved = true; });

    // All WS connections are initiated synchronously before the first await.
    expect(order.filter(e => e === 'connect').length).toBe(10); // 2 underlyings × 5 streams

    // Flush microtasks — start() should already have resolved.
    await Promise.resolve();
    await p;

    expect(resolved).toBe(true);
    // Seeding has NOT yet fired (still behind the 10s fake timer).
    expect(order).not.toContain('seed');

    svc.dispose();
  });
});
