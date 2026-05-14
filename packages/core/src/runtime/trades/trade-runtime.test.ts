import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  TradeRuntime,
  VENUE_STREAMS,
  clearCoincallInstrumentCache,
  fetchCoincallInstrumentsForBase,
  getDeribitTradeCurrency,
  getDeribitUnderlyingFromInstrument,
  normalizeTradeUnderlying,
} from './trade-runtime.js';
import type { TradeEvent } from './types.js';

function makeTrade(underlying: string, price = 70_000, size = 1): TradeEvent {
  return {
    venue: 'bybit',
    tradeId: null,
    instrument: `${underlying}-28MAR26-70000-C`,
    underlying,
    side: 'buy',
    price,
    size,
    iv: 0.5,
    markPrice: price,
    indexPrice: price,
    isBlock: false,
    timestamp: Date.now(),
  };
}

function pushTrades(runtime: TradeRuntime, underlying: string, trades: TradeEvent[]) {
  (runtime as unknown as { pushTrades(u: string, t: TradeEvent[]): void }).pushTrades(
    underlying,
    trades,
  );
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
    pushTrades(
      runtime,
      'BTC',
      Array.from({ length: 600 }, (_, i) => makeTrade('BTC', i)),
    );
    expect(runtime.getTrades('BTC')).toHaveLength(500);
  });

  it('keeps the newest 500 entries after overflow', () => {
    pushTrades(
      runtime,
      'BTC',
      Array.from({ length: 600 }, (_, i) => makeTrade('BTC', i)),
    );
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

    const connectSpy = vi
      .spyOn(
        runtime as unknown as { connectStream(s: unknown, u: string, attempt: number): void },
        'connectStream',
      )
      .mockImplementation(function (this: TradeRuntime, stream, underlying, attempt = 0) {
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
    ).mockImplementation(() => {
      order.push('connect');
    });

    vi.spyOn(
      runtime as unknown as { seedFromRest(u: string): Promise<void> },
      'seedFromRest',
    ).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      order.push('seed');
    });

    let resolved = false;
    const promise = runtime.start(['BTC', 'ETH']).then(() => {
      resolved = true;
    });

    // 7 venues (deribit/okx/bybit/binance/derive/thalex/gateio) × 2 underlyings.
    // Coincall is gated by COINCALL_API_KEY/SECRET — vitest does not auto-load
    // .env, so the production keys aren't visible inside the test process even
    // when present at the repo root. The runtime correctly skips coincall here.
    expect(order.filter((entry) => entry === 'connect').length).toBe(14);

    await Promise.resolve();
    await promise;

    expect(resolved).toBe(true);
    expect(order).not.toContain('seed');

    runtime.dispose();
  });
});

describe('TradeRuntime — coincall instrument cache TTL', () => {
  const fetchSpy = vi.fn();

  function instrumentsResponse(active: string[], inactive: string[] = []): Response {
    const body = {
      code: 0,
      msg: 'Success',
      data: [
        ...active.map((symbolName) => ({ symbolName, isActive: true })),
        ...inactive.map((symbolName) => ({ symbolName, isActive: false })),
      ],
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  beforeEach(() => {
    clearCoincallInstrumentCache();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearCoincallInstrumentCache();
  });

  it('deduplicates concurrent calls within the TTL window', async () => {
    fetchSpy.mockResolvedValue(instrumentsResponse(['BTCUSD-1JUN26-70000-C']));

    const [a, b] = await Promise.all([
      fetchCoincallInstrumentsForBase('BTC'),
      fetchCoincallInstrumentsForBase('BTC'),
    ]);

    expect(a).toEqual(['BTCUSD-1JUN26-70000-C']);
    expect(b).toEqual(['BTCUSD-1JUN26-70000-C']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('serves cached results while inside the TTL window', async () => {
    fetchSpy
      .mockResolvedValueOnce(instrumentsResponse(['BTCUSD-1JUN26-70000-C']))
      .mockResolvedValueOnce(instrumentsResponse(['BTCUSD-1JUN26-70000-C', 'BTCUSD-2JUN26-72000-C']));

    await fetchCoincallInstrumentsForBase('BTC');
    vi.setSystemTime(Date.now() + 14 * 60_000);
    const second = await fetchCoincallInstrumentsForBase('BTC');

    expect(second).toEqual(['BTCUSD-1JUN26-70000-C']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refetches after the TTL window expires (picks up new daily expiries)', async () => {
    fetchSpy
      .mockResolvedValueOnce(instrumentsResponse(['BTCUSD-1JUN26-70000-C']))
      .mockResolvedValueOnce(instrumentsResponse(['BTCUSD-1JUN26-70000-C', 'BTCUSD-2JUN26-72000-C']));

    await fetchCoincallInstrumentsForBase('BTC');
    vi.setSystemTime(Date.now() + 16 * 60_000);
    const refreshed = await fetchCoincallInstrumentsForBase('BTC');

    expect(refreshed).toEqual(['BTCUSD-1JUN26-70000-C', 'BTCUSD-2JUN26-72000-C']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries an empty-result base after the TTL — the prior poison is the bug this fixes', async () => {
    fetchSpy
      .mockResolvedValueOnce(instrumentsResponse([])) // simulates TRX/LTC/MATIC right now: code:0 data:[]
      .mockResolvedValueOnce(instrumentsResponse(['TRXUSD-1JUN26-0.30-C']));

    const initial = await fetchCoincallInstrumentsForBase('TRX');
    expect(initial).toEqual([]);

    vi.setSystemTime(Date.now() + 16 * 60_000);
    const refreshed = await fetchCoincallInstrumentsForBase('TRX');
    expect(refreshed).toEqual(['TRXUSD-1JUN26-0.30-C']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries after a failed fetch once the TTL expires', async () => {
    fetchSpy
      .mockRejectedValueOnce(new Error('coincall 502'))
      .mockResolvedValueOnce(instrumentsResponse(['BTCUSD-1JUN26-70000-C']));

    const initial = await fetchCoincallInstrumentsForBase('BTC');
    expect(initial).toEqual([]);

    vi.setSystemTime(Date.now() + 16 * 60_000);
    const refreshed = await fetchCoincallInstrumentsForBase('BTC');
    expect(refreshed).toEqual(['BTCUSD-1JUN26-70000-C']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('TradeRuntime — gateio VENUE_STREAMS entry', () => {
  function getGateioStream() {
    const stream = VENUE_STREAMS.find((s) => s.venue === 'gateio');
    if (!stream) throw new Error('gateio stream not registered');
    return stream;
  }

  it('parses a signed-size trade frame as side=sell with magnitude size', () => {
    const stream = getGateioStream();
    const frame = {
      time: 1778748883,
      channel: 'options.trades',
      event: 'update',
      result: [
        {
          size: -3,
          id: 99,
          create_time: 1778748883,
          contract: 'BTC_USDT-20260605-79000-P',
          price: '2432',
        },
      ],
    };
    const out = stream.parse(frame, 'BTC');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      venue: 'gateio',
      side: 'sell',
      size: 3,
      price: 2432,
      instrument: 'BTC_USDT-20260605-79000-P',
      underlying: 'BTC',
      isBlock: false,
      timestamp: 1778748883_000,
    });
  });

  it('parses a positive-size trade as side=buy and prefers create_time_ms when present', () => {
    const stream = getGateioStream();
    const frame = {
      time: 1778765126,
      channel: 'options.trades',
      event: 'update',
      result: [
        {
          size: 2,
          id: 99,
          create_time: 1778765126,
          create_time_ms: 1778765126_777,
          contract: 'BTC_USDT-20260517-81500-C',
          price: '388',
        },
      ],
    };
    const out = stream.parse(frame, 'BTC');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ side: 'buy', size: 2, timestamp: 1778765126_777 });
  });

  it('filters trades whose contract is for a different underlying', () => {
    const stream = getGateioStream();
    const frame = {
      time: 1,
      channel: 'options.trades',
      event: 'update',
      result: [
        { size: 1, id: 1, create_time: 1, contract: 'ETH_USDT-20260605-2000-C', price: '50' },
        { size: 1, id: 2, create_time: 1, contract: 'BTC_USDT-20260605-70000-C', price: '100' },
      ],
    };
    expect(stream.parse(frame, 'BTC')).toHaveLength(1);
    expect(stream.parse(frame, 'ETH')).toHaveLength(1);
  });

  it('ignores subscribe acks, errors, and non-trade channels', () => {
    const stream = getGateioStream();
    expect(
      stream.parse(
        { time: 1, channel: 'options.trades', event: 'subscribe', result: { status: 'success' } },
        'BTC',
      ),
    ).toEqual([]);
    expect(
      stream.parse(
        { time: 1, channel: 'options.trades', event: 'update', error: { code: 1, message: 'x' } },
        'BTC',
      ),
    ).toEqual([]);
    expect(
      stream.parse(
        { time: 1, channel: 'options.contract_tickers', event: 'update', result: [] },
        'BTC',
      ),
    ).toEqual([]);
  });

  it('drops zero-size trades and unparseable prices', () => {
    const stream = getGateioStream();
    const frame = {
      time: 1,
      channel: 'options.trades',
      event: 'update',
      result: [
        { size: 0, id: 1, create_time: 1, contract: 'BTC_USDT-20260605-70000-C', price: '100' },
        {
          size: 1,
          id: 2,
          create_time: 1,
          contract: 'BTC_USDT-20260605-70000-C',
          price: 'not-a-number',
        },
      ],
    };
    expect(stream.parse(frame, 'BTC')).toEqual([]);
  });
});
