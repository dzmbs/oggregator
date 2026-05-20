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
import { TRADE_RUNTIME_BUFFER_SIZE } from './retention.js';
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

  it('caps buffer at TRADE_RUNTIME_BUFFER_SIZE entries', () => {
    const overflow = 100;
    pushTrades(
      runtime,
      'BTC',
      Array.from({ length: TRADE_RUNTIME_BUFFER_SIZE + overflow }, (_, i) =>
        makeTrade('BTC', i),
      ),
    );
    expect(runtime.getTrades('BTC')).toHaveLength(TRADE_RUNTIME_BUFFER_SIZE);
  });

  it('keeps the newest TRADE_RUNTIME_BUFFER_SIZE entries after overflow', () => {
    const overflow = 100;
    pushTrades(
      runtime,
      'BTC',
      Array.from({ length: TRADE_RUNTIME_BUFFER_SIZE + overflow }, (_, i) =>
        makeTrade('BTC', i),
      ),
    );
    const trades = runtime.getTrades('BTC');
    expect(trades[0]!.price).toBe(overflow);
    expect(trades[TRADE_RUNTIME_BUFFER_SIZE - 1]!.price).toBe(
      TRADE_RUNTIME_BUFFER_SIZE + overflow - 1,
    );
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

describe('TradeRuntime — periodic reseed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('Coincall VENUE_STREAMS entry declares a reseedIntervalMs', () => {
    const stream = VENUE_STREAMS.find((s) => s.venue === 'coincall');
    expect(stream?.reseedIntervalMs).toBe(10 * 60 * 1000);
    expect(stream?.seed).toBeDefined();
  });

  it('schedules a reseed timer per (venue with reseed, supported underlying) and clears on dispose', async () => {
    vi.stubEnv('COINCALL_API_KEY', 'test-key');
    vi.stubEnv('COINCALL_API_SECRET', 'test-secret');

    const runtime = new TradeRuntime();
    vi.spyOn(
      runtime as unknown as { connectStream(...args: unknown[]): void },
      'connectStream',
    ).mockImplementation(() => {});
    vi.spyOn(
      runtime as unknown as { seedFromRest(u: string): Promise<void> },
      'seedFromRest',
    ).mockResolvedValue(undefined);

    await runtime.start(['BTC', 'ETH']);

    const reseedTimers = (runtime as unknown as { reseedTimers: Map<string, unknown> }).reseedTimers;
    expect(reseedTimers.has('coincall:BTC')).toBe(true);
    expect(reseedTimers.has('coincall:ETH')).toBe(true);
    // Gate.io reseeds for every underlying — newly-listed daily strikes wouldn't
    // be WS-subscribed until reconnect, so the reseed backfills via REST.
    expect(reseedTimers.has('gateio:BTC')).toBe(true);
    expect(reseedTimers.has('gateio:ETH')).toBe(true);

    runtime.dispose();
    expect(reseedTimers.size).toBe(0);
  });

  it('invokes the stream seed() at each reseed interval and pushes returned trades', async () => {
    vi.stubEnv('COINCALL_API_KEY', 'test-key');
    vi.stubEnv('COINCALL_API_SECRET', 'test-secret');

    const runtime = new TradeRuntime();
    vi.spyOn(
      runtime as unknown as { connectStream(...args: unknown[]): void },
      'connectStream',
    ).mockImplementation(() => {});
    vi.spyOn(
      runtime as unknown as { seedFromRest(u: string): Promise<void> },
      'seedFromRest',
    ).mockResolvedValue(undefined);

    const reseedSpy = vi
      .spyOn(
        runtime as unknown as {
          runVenueReseed(stream: { venue: string }, underlying: string): Promise<void>;
        },
        'runVenueReseed',
      )
      .mockResolvedValue(undefined);

    await runtime.start(['BTC']);
    expect(reseedSpy).not.toHaveBeenCalled();

    // Advance one interval — should fire one reseed per venue with seed
    // (currently coincall + gateio) for the single subscribed underlying.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    const venues = reseedSpy.mock.calls
      .map((call) => (call[0] as { venue: string }).venue)
      .sort();
    expect(venues).toEqual(['coincall', 'gateio']);
    for (const call of reseedSpy.mock.calls) {
      expect(call[1]).toBe('BTC');
    }
    const callsAfterFirst = reseedSpy.mock.calls.length;

    // Advance a second interval — both venues fire again.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(reseedSpy.mock.calls.length).toBe(callsAfterFirst * 2);

    runtime.dispose();
  });

  it('skips coincall reseed scheduling when keys are missing but still schedules gateio', async () => {
    vi.stubEnv('COINCALL_API_KEY', '');
    vi.stubEnv('COINCALL_API_SECRET', '');
    const runtime = new TradeRuntime();
    vi.spyOn(
      runtime as unknown as { connectStream(...args: unknown[]): void },
      'connectStream',
    ).mockImplementation(() => {});
    vi.spyOn(
      runtime as unknown as { seedFromRest(u: string): Promise<void> },
      'seedFromRest',
    ).mockResolvedValue(undefined);

    await runtime.start(['BTC']);

    const reseedTimers = (runtime as unknown as { reseedTimers: Map<string, unknown> }).reseedTimers;
    const keys = Array.from(reseedTimers.keys());
    expect(keys).toContain('gateio:BTC');
    expect(keys.some((k) => k.startsWith('coincall:'))).toBe(false);

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

  it('seed() pulls recent trades from REST and converts them like the WS parser', async () => {
    const stream = getGateioStream();
    expect(stream.seed).toBeDefined();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      expect(url).toContain('/api/v4/options/trades');
      expect(url).toContain('underlying=DOGE_USDT');
      expect(url).toContain('limit=200');
      return new Response(
        JSON.stringify([
          {
            size: -3,
            id: 7,
            create_time: 1779100000,
            contract: 'DOGE_USDT-20260519-0.106-C',
            price: '0.0004',
          },
          {
            size: 2,
            id: 8,
            create_time: 1779100100,
            create_time_ms: 1779100100_500,
            contract: 'DOGE_USDT-20260519-0.108-C',
            price: '0.00031',
          },
          // Cross-underlying noise — Gate.io's REST always filters by the
          // underlying query param, but the helper still defends.
          { size: 1, id: 1, create_time: 1, contract: 'BTC_USDT-20260605-70000-C', price: '100' },
        ]),
        { status: 200 },
      );
    });

    const trades = await stream.seed!('DOGE');
    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({
      venue: 'gateio',
      side: 'sell',
      size: 3,
      price: 0.0004,
      instrument: 'DOGE_USDT-20260519-0.106-C',
      underlying: 'DOGE',
      tradeId: 'DOGE_USDT-20260519-0.106-C:7',
      timestamp: 1779100000_000,
    });
    expect(trades[1]).toMatchObject({
      side: 'buy',
      size: 2,
      timestamp: 1779100100_500,
    });

    fetchSpy.mockRestore();
  });

  it('seed() returns [] for underlyings Gate.io does not list (400/404) instead of throwing', async () => {
    const stream = getGateioStream();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ label: 'CONTRACT_NOT_FOUND' }), { status: 400 }),
      );

    await expect(stream.seed!('AVAX')).resolves.toEqual([]);
    fetchSpy.mockRestore();
  });
});
