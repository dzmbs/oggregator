import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mergeTradeAndMark, bucketTicks, bucketTrades, InstrumentCandleService } from './instrument-candles.js';
import { MarkHistoryBuffer } from './mark-history-buffer.js';

describe('mergeTradeAndMark', () => {
  it('uses trade bar when vol > 0', () => {
    const trade = [{ ts: 1, o: 10, h: 11, l: 9, c: 10.5, vol: 5 }];
    const mark = [{ ts: 1, o: 9, h: 12, l: 8, c: 11, vol: 0 }];
    const out = mergeTradeAndMark(trade, mark);
    expect(out.candles).toEqual([
      { ts: 1, o: 10, h: 11, l: 9, c: 10.5, vol: 5, synthetic: false },
    ]);
    expect(out.markLine).toEqual([{ ts: 1, c: 11 }]);
  });

  it('falls back to mark when trade vol is 0', () => {
    const trade = [{ ts: 1, o: 0, h: 0, l: 0, c: 0, vol: 0 }];
    const mark = [{ ts: 1, o: 9, h: 12, l: 8, c: 11, vol: 0 }];
    const out = mergeTradeAndMark(trade, mark);
    expect(out.candles).toEqual([
      { ts: 1, o: 9, h: 12, l: 8, c: 11, vol: 0, synthetic: true },
    ]);
  });

  it('fills mark-only buckets that have no trade bucket', () => {
    const trade: { ts: number; o: number; h: number; l: number; c: number; vol: number }[] = [];
    const mark = [
      { ts: 1, o: 1, h: 1, l: 1, c: 1, vol: 0 },
      { ts: 2, o: 2, h: 2, l: 2, c: 2, vol: 0 },
    ];
    const out = mergeTradeAndMark(trade, mark);
    expect(out.candles.map((c) => c.synthetic)).toEqual([true, true]);
    expect(out.markLine.map((m) => m.c)).toEqual([1, 2]);
  });

  it('emits trade-only buckets even when no mark bucket exists', () => {
    const trade = [{ ts: 1, o: 10, h: 11, l: 9, c: 10.5, vol: 5 }];
    const mark: { ts: number; o: number; h: number; l: number; c: number; vol: number }[] = [];
    const out = mergeTradeAndMark(trade, mark);
    expect(out.candles).toEqual([
      { ts: 1, o: 10, h: 11, l: 9, c: 10.5, vol: 5, synthetic: false },
    ]);
    expect(out.markLine).toEqual([]);
  });

  it('emits buckets in ascending ts order', () => {
    const trade = [{ ts: 2, o: 2, h: 2, l: 2, c: 2, vol: 1 }];
    const mark = [
      { ts: 1, o: 1, h: 1, l: 1, c: 1, vol: 0 },
      { ts: 2, o: 1.5, h: 2.5, l: 1.5, c: 2.5, vol: 0 },
    ];
    const out = mergeTradeAndMark(trade, mark);
    expect(out.candles.map((c) => c.ts)).toEqual([1, 2]);
  });
});

describe('bucketTrades', () => {
  it('aggregates trades into OHLCV candles', () => {
    const trades = [
      { execId: 'a', ts: 60_000, price: 10, size: 1 },
      { execId: 'b', ts: 60_500, price: 12, size: 0.5 },
      { execId: 'c', ts: 61_000, price: 9, size: 2 },
      { execId: 'd', ts: 120_000, price: 8, size: 1 },
    ];
    const out = bucketTrades(trades, 60_000);
    expect(out).toEqual([
      { ts: 60_000, o: 10, h: 12, l: 9, c: 9, vol: 3.5 },
      { ts: 120_000, o: 8, h: 8, l: 8, c: 8, vol: 1 },
    ]);
  });

  it('sorts unordered trades before bucketing so o/c stay correct', () => {
    const trades = [
      { execId: 'b', ts: 60_500, price: 12, size: 1 },
      { execId: 'a', ts: 60_000, price: 10, size: 1 },
      { execId: 'c', ts: 61_000, price: 9, size: 1 },
    ];
    const out = bucketTrades(trades, 60_000);
    expect(out[0]).toEqual({ ts: 60_000, o: 10, h: 12, l: 9, c: 9, vol: 3 });
  });

  it('skips trades with non-finite price or ts', () => {
    const trades = [
      { execId: 'a', ts: 60_000, price: NaN, size: 1 },
      { execId: 'b', ts: 60_500, price: 12, size: 1 },
    ];
    const out = bucketTrades(trades, 60_000);
    expect(out).toEqual([{ ts: 60_000, o: 12, h: 12, l: 12, c: 12, vol: 1 }]);
  });
});

describe('InstrumentCandleService — Derive buffer integration', () => {
  const MIN = 60_000;
  const BASE_TS = Math.floor(1_700_000_000_000 / (60 * MIN)) * (60 * MIN);
  let svc: InstrumentCandleService;
  let buffer: MarkHistoryBuffer;
  const fetchSpy = vi.fn();

  beforeEach(() => {
    buffer = new MarkHistoryBuffer({ retentionMs: 24 * 60 * MIN });
    svc = new InstrumentCandleService({ markHistoryBuffer: buffer });
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS + 30 * MIN);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('serves Derive mark + trade history from the live buffer when populated', async () => {
    buffer.recordMark('derive', 'HYPE-TEST', BASE_TS, 50);
    buffer.recordMark('derive', 'HYPE-TEST', BASE_TS + MIN, 52);
    buffer.recordTrade('derive', 'HYPE-TEST', BASE_TS, 51, 2);

    const res = await svc.getCandles('derive', 'HYPE-TEST', '1m', '1d');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.markLine.map((m) => m.c)).toEqual([50, 52]);
    expect(res.candles.some((c) => c.vol > 0)).toBe(true);
  });

  it('falls back to REST trades when the Derive buffer is cold', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ result: { trades: [], pagination: { num_pages: 0, count: 0 } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await svc.getCandles('derive', 'COLD-X', '1m', '1d');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toContain('/public/get_trade_history');
    expect(res.candles).toEqual([]);
    expect(res.markLine).toEqual([]);
  });

  it('serves Coincall trades from signed REST and overlays live buffer mark', async () => {
    vi.stubEnv('COINCALL_API_KEY', 'test-key');
    vi.stubEnv('COINCALL_API_SECRET', 'test-secret');
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          msg: 'Success',
          data: [
            { ts: BASE_TS, open: '1200', high: '1205', low: '1195', close: '1200', volume: '3' },
            { ts: BASE_TS + MIN, o: '1200', h: '1210', l: '1190', c: '1180', v: '5' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    // Buffer adds live mark on top of REST historical.
    buffer.recordMark('coincall', 'BTCUSD-22MAY26-110000-C', BASE_TS, 1200);
    buffer.recordMark('coincall', 'BTCUSD-22MAY26-110000-C', BASE_TS + MIN, 1180);

    const res = await svc.getCandles('coincall', 'BTCUSD-22MAY26-110000-C', '1m', '1d');

    // REST kline was called once with signed headers and the documented
    // /kline/history/v1 path plus start/end/limit per Coincall's spec.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain('/open/option/market/kline/history/v1/BTCUSD-22MAY26-110000-C');
    expect(calledUrl).toContain('period=m1');
    expect(calledUrl).toMatch(/start=\d+/);
    expect(calledUrl).toMatch(/end=\d+/);
    expect(calledUrl).toContain('limit=1');
    const headers = calledInit.headers as Record<string, string>;
    expect(headers['X-CC-APIKEY']).toBe('test-key');
    expect(headers.sign).toMatch(/^[0-9A-F]+$/);

    expect(res.priceCurrency).toBe('USD');
    expect(res.markLine.map((m) => m.c)).toEqual([1200, 1180]);
    expect(res.candles.some((c) => c.vol > 0)).toBe(true);
  });

  it('falls back to live buffer when Coincall credentials are missing', async () => {
    vi.stubEnv('COINCALL_API_KEY', '');
    vi.stubEnv('COINCALL_API_SECRET', '');
    buffer.recordMark('coincall', 'KAS-WARM', BASE_TS, 0.05);
    buffer.recordTrade('coincall', 'KAS-WARM', BASE_TS, 0.05, 1);

    const res = await svc.getCandles('coincall', 'KAS-WARM', '1m', '1d');

    // No REST call when credentials missing — buffer-only path.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.markLine.map((m) => m.c)).toEqual([0.05]);
    expect(res.candles.some((c) => c.vol > 0)).toBe(true);
  });

  it('returns empty candles for Coincall when neither REST nor buffer has data', async () => {
    vi.stubEnv('COINCALL_API_KEY', 'test-key');
    vi.stubEnv('COINCALL_API_SECRET', 'test-secret');
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ code: 0, msg: 'Success', data: [] }), { status: 200 }),
    );

    const res = await svc.getCandles('coincall', 'KAS-COLD', '1m', '1d');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.candles).toEqual([]);
    expect(res.markLine).toEqual([]);
  });

  it('degrades to buffer when Coincall REST returns a non-success code', async () => {
    vi.stubEnv('COINCALL_API_KEY', 'test-key');
    vi.stubEnv('COINCALL_API_SECRET', 'test-secret');
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ code: 10004, msg: 'Parameter illegal', data: null }),
        { status: 200 },
      ),
    );
    buffer.recordMark('coincall', 'KAS-FALLBACK', BASE_TS, 0.05);

    const res = await svc.getCandles('coincall', 'KAS-FALLBACK', '1m', '1d');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // REST returned no usable rows but the buffer mark still seeds the line.
    expect(res.markLine.map((m) => m.c)).toEqual([0.05]);
  });

  it('pairs Gate.io REST candlesticks with buffered mark when REST returns [] (no creds)', async () => {
    vi.stubEnv('GATEIO_API_KEY', '');
    vi.stubEnv('GATEIO_API_SECRET', '');
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    buffer.recordMark('gateio', 'DOGE_USDT-20260519-0.106-C', BASE_TS, 0.0005);
    buffer.recordMark('gateio', 'DOGE_USDT-20260519-0.106-C', BASE_TS + MIN, 0.00052);

    const res = await svc.getCandles('gateio', 'DOGE_USDT-20260519-0.106-C', '1m', '1d');

    // Without credentials the mark fetcher short-circuits before any fetch,
    // so only the public trade call hits the wire.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toContain('/options/candlesticks');
    expect(fetchSpy.mock.calls[0]?.[0]).not.toContain('mark_price_candlesticks');
    expect(res.markLine.map((m) => m.c)).toEqual([0.0005, 0.00052]);
    expect(res.candles.every((c) => c.synthetic === true || c.vol === 0)).toBe(true);
  });

  it('pairs Gate.io REST candlesticks with buffered mark when REST returns trades (no creds)', async () => {
    vi.stubEnv('GATEIO_API_KEY', '');
    vi.stubEnv('GATEIO_API_SECRET', '');
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify([
          { t: Math.floor(BASE_TS / 1000), o: '5.84', h: '5.84', l: '5.84', c: '5.84', v: 1 },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    buffer.recordMark('gateio', 'HYPE_USDT-20260522-40-C', BASE_TS, 5.5);

    const res = await svc.getCandles('gateio', 'HYPE_USDT-20260522-40-C', '1m', '1d');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.markLine.map((m) => m.c)).toEqual([5.5]);
    expect(res.candles.some((c) => c.vol > 0)).toBe(true);
  });

  it('signs the Gate.io mark candle request and fills buckets the buffer lacks', async () => {
    vi.stubEnv('GATEIO_API_KEY', 'test-key');
    vi.stubEnv('GATEIO_API_SECRET', 'test-secret');
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/options/mark_price_candlesticks')) {
        return new Response(
          JSON.stringify([
            { t: Math.floor(BASE_TS / 1000), o: '0.0006', h: '0.0006', l: '0.0006', c: '0.0006', v: 0 },
            { t: Math.floor((BASE_TS + MIN) / 1000), o: '0.0007', h: '0.0007', l: '0.0007', c: '0.0007', v: 0 },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // Public candlesticks: empty (untraded strike).
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    // Buffer covers only the current bucket with the freshest live sample;
    // mergeCandlesByTs gives live the tie-break (see comment in service), so
    // the buffer wins at BASE_TS and REST fills BASE_TS + MIN.
    buffer.recordMark('gateio', 'DOGE_USDT-20260519-0.106-C', BASE_TS, 0.0005);

    const res = await svc.getCandles('gateio', 'DOGE_USDT-20260519-0.106-C', '1m', '1d');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const markCall = fetchSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('mark_price_candlesticks'),
    );
    expect(markCall).toBeDefined();
    const headers = (markCall![1] as RequestInit).headers as Record<string, string>;
    expect(headers.KEY).toBe('test-key');
    expect(headers.Timestamp).toMatch(/^\d+$/);
    expect(headers.SIGN).toMatch(/^[0-9a-f]+$/);

    expect(res.markLine.map((m) => m.c)).toEqual([0.0005, 0.0007]);
  });

  it('falls back to buffered Gate.io mark when signed REST returns []', async () => {
    vi.stubEnv('GATEIO_API_KEY', 'test-key');
    vi.stubEnv('GATEIO_API_SECRET', 'test-secret');
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    buffer.recordMark('gateio', 'DOGE_USDT-20260519-0.106-C', BASE_TS, 0.0005);

    const res = await svc.getCandles('gateio', 'DOGE_USDT-20260519-0.106-C', '1m', '1d');

    // Both endpoints get hit; REST mark empty → buffer fills the line.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(res.markLine.map((m) => m.c)).toEqual([0.0005]);
  });
});

describe('bucketTicks', () => {
  it('aggregates ticks into bucketed candles preserving high/low/close', () => {
    const ticks: [number, number][] = [
      [60_000, 10],
      [60_500, 12],
      [61_000, 9],
      [120_000, 8],
      [121_000, 11],
    ];
    const out = bucketTicks(ticks, 60_000);
    expect(out).toEqual([
      { ts: 60_000, o: 10, h: 12, l: 9, c: 9, vol: 0 },
      { ts: 120_000, o: 8, h: 11, l: 8, c: 11, vol: 0 },
    ]);
  });

  it('sorts buckets ascending when ticks arrive out of order', () => {
    const ticks: [number, number][] = [
      [120_000, 8],
      [60_000, 10],
      [121_000, 11],
      [60_500, 12],
    ];
    const out = bucketTicks(ticks, 60_000);
    expect(out.map((c) => c.ts)).toEqual([60_000, 120_000]);
    expect(out[0]?.h).toBe(12);
    expect(out[1]?.h).toBe(11);
  });
});
