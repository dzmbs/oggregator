import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { TradeEvent } from '@oggregator/core';
import type { InstrumentSummary } from '@oggregator/db';
import Fastify from 'fastify';

vi.mock('../services.js', () => ({
  isFlowReady: vi.fn(() => false),
  isDvolReady: vi.fn(() => false),
  isSpotReady: vi.fn(() => false),
  flowService: { getTrades: vi.fn() },
  dvolService: { getSnapshot: vi.fn() },
  spotService: { getSnapshot: vi.fn(() => null) },
  tradeStore: {
    enabled: true,
    loadHistory: vi.fn(async () => []),
    summarizeHistory: vi.fn(async () => ({
      count: 0,
      premiumUsd: 0,
      notionalUsd: 0,
      oldestTs: null,
      newestTs: null,
      venues: [],
    })),
    listInstruments: vi.fn(async () => [] as InstrumentSummary[]),
  },
}));

// Import the mocked module after vi.mock so we get the stubbed version.
import * as services from '../services.js';
import { flowRoute } from './flow.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function setFlowReady(v: boolean) {
  vi.mocked(services.isFlowReady).mockReturnValue(v);
}

const getTrades = () => vi.mocked(services.flowService.getTrades);

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(flowRoute);
  await app.ready();
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /flow', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns 503 when flow service is not ready', async () => {
    setFlowReady(false);
    const res = await app.inject({ method: 'GET', url: '/flow' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: expect.any(String) });
  });

  // Build a minimal TradeEvent for test data — only fields the route serialises matter.
  function fakeTrades(count: number): TradeEvent[] {
    return Array.from(
      { length: count },
      (_, i) =>
        ({
          venue: 'deribit',
          instrument: `BTC-28MAR26-${70_000 + i}-C`,
          underlying: 'BTC',
          side: 'buy',
          price: 70_000 + i,
          size: 1,
          iv: 0.5,
          markPrice: 70_000,
          indexPrice: 70_000,
          isBlock: false,
          timestamp: Date.now() + i,
        }) as TradeEvent,
    );
  }

  it('returns trades with defaults (underlying=BTC, limit=100)', async () => {
    setFlowReady(true);
    getTrades().mockReturnValue(fakeTrades(50));

    const res = await app.inject({ method: 'GET', url: '/flow' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.underlying).toBe('BTC');
    expect(body.count).toBe(50);
    expect(getTrades()).toHaveBeenCalledWith('BTC');
  });

  it('passes underlying to getTrades and applies minNotional after enrichment', async () => {
    setFlowReady(true);
    getTrades().mockReturnValue([
      {
        venue: 'bybit',
        instrument: 'ETH-28MAR26-3000-C',
        underlying: 'ETH',
        side: 'buy',
        price: 10,
        size: 1,
        iv: 0.5,
        markPrice: 10,
        indexPrice: 100,
        isBlock: false,
        timestamp: Date.now(),
      } as TradeEvent,
      {
        venue: 'bybit',
        instrument: 'ETH-28MAR26-3000-C',
        underlying: 'ETH',
        side: 'buy',
        price: 10,
        size: 10,
        iv: 0.5,
        markPrice: 10,
        indexPrice: 100,
        isBlock: false,
        timestamp: Date.now() + 1,
      } as TradeEvent,
    ]);

    const res = await app.inject({ method: 'GET', url: '/flow?underlying=ETH&minNotional=500' });
    expect(getTrades()).toHaveBeenCalledWith('ETH');
    expect(res.json().trades).toHaveLength(1);
  });

  it('clamps limit to 500 maximum', async () => {
    setFlowReady(true);
    getTrades().mockReturnValue(fakeTrades(600));

    const res = await app.inject({ method: 'GET', url: '/flow?limit=9999' });
    expect(res.statusCode).toBe(200);
    expect(res.json().trades).toHaveLength(500);
  });

  it('treats negative limit as default (100)', async () => {
    setFlowReady(true);
    getTrades().mockReturnValue(fakeTrades(200));

    const res = await app.inject({ method: 'GET', url: '/flow?limit=-5' });
    expect(res.statusCode).toBe(200);
    expect(res.json().trades).toHaveLength(100);
  });

  it('treats negative minNotional as 0', async () => {
    setFlowReady(true);
    getTrades().mockReturnValue([]);

    await app.inject({ method: 'GET', url: '/flow?minNotional=-999' });
    expect(getTrades()).toHaveBeenCalledWith('BTC');
  });

  it('treats NaN limit as default (100)', async () => {
    setFlowReady(true);
    getTrades().mockReturnValue(fakeTrades(200));

    const res = await app.inject({ method: 'GET', url: '/flow?limit=abc' });
    expect(res.statusCode).toBe(200);
    expect(res.json().trades).toHaveLength(100);
  });

  it('returns trades in reverse order (newest first)', async () => {
    setFlowReady(true);
    const trades = fakeTrades(3); // timestamps: now+0, now+1, now+2
    getTrades().mockReturnValue(trades);

    const res = await app.inject({ method: 'GET', url: '/flow?limit=3' });
    const body = res.json();
    // slice(-3).reverse() → newest (index 2) first
    expect(body.trades[0].timestamp).toBe(trades[2]!.timestamp);
    expect(body.trades[2].timestamp).toBe(trades[0]!.timestamp);
  });
});

describe('GET /flow/instruments', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns available:false when trade store is disabled', async () => {
    const services = await import('../services.js');
    Object.assign(services.tradeStore, { enabled: false });

    const res = await app.inject({ method: 'GET', url: '/flow/instruments?underlying=BTC&venue=deribit' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: false, instruments: [] });

    Object.assign(services.tradeStore, { enabled: true });
  });

  it('returns aggregated instruments ordered by count desc', async () => {
    const services = await import('../services.js');
    const fakeRows: InstrumentSummary[] = [
      {
        instrument: 'BTC-28MAR26-100000-C',
        count: 12,
        lastTs: new Date('2026-05-12T10:00:00Z'),
        lastPrice: 0.04,
        lastReferencePriceUsd: 4000,
        optionType: 'call',
        strike: 100000,
        expiry: '2026-03-28',
      },
      {
        instrument: 'BTC-28MAR26-90000-P',
        count: 3,
        lastTs: new Date('2026-05-12T09:30:00Z'),
        lastPrice: 0.02,
        lastReferencePriceUsd: 2000,
        optionType: 'put',
        strike: 90000,
        expiry: '2026-03-28',
      },
    ];
    vi.mocked(services.tradeStore.listInstruments).mockResolvedValueOnce(fakeRows);

    const res = await app.inject({
      method: 'GET',
      url: '/flow/instruments?underlying=BTC&venue=deribit&start=2026-05-12T00:00:00Z&end=2026-05-13T00:00:00Z',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.available).toBe(true);
    expect(body.instruments).toHaveLength(2);
    expect(body.instruments[0]).toMatchObject({
      instrument: 'BTC-28MAR26-100000-C',
      count: 12,
      lastTs: '2026-05-12T10:00:00.000Z',
      lastPrice: 0.04,
      lastReferencePriceUsd: 4000,
      optionType: 'call',
      strike: 100000,
      expiry: '2026-03-28',
    });
  });
});

describe('GET /flow/instrument-trades', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns available:false when trade store is disabled', async () => {
    const services = await import('../services.js');
    Object.assign(services.tradeStore, { enabled: false });

    const res = await app.inject({
      method: 'GET',
      url: '/flow/instrument-trades?underlying=BTC&venue=deribit&instrument=BTC-28MAR26-100000-C',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: false, trades: [], nextCursor: null });

    Object.assign(services.tradeStore, { enabled: true });
  });

  it('400s when venue or instrument is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/flow/instrument-trades?underlying=BTC&venue=deribit',
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns trades filtered to a single instrument', async () => {
    const services = await import('../services.js');
    vi.mocked(services.tradeStore.loadHistory).mockResolvedValueOnce([
      {
        tradeUid: 'deribit:abc',
        mode: 'live',
        venue: 'deribit',
        underlying: 'BTC',
        instrumentName: 'BTC-28MAR26-100000-C',
        tradeTs: new Date('2026-05-12T10:00:00Z'),
        ingestedAt: new Date('2026-05-12T10:00:01Z'),
        direction: 'buy',
        contracts: 5,
        price: 0.04,
        premiumUsd: 1200,
        notionalUsd: 24000,
        referencePriceUsd: 4800,
        expiry: '2026-03-28',
        strike: 100000,
        optionType: 'call',
        iv: 0.5,
        markPrice: 0.041,
        isBlock: false,
        strategyLabel: null,
        legs: null,
        raw: {},
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/flow/instrument-trades?underlying=BTC&venue=deribit&instrument=BTC-28MAR26-100000-C',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.available).toBe(true);
    expect(body.trades).toHaveLength(1);
    expect(body.trades[0]).toMatchObject({
      tradeUid: 'deribit:abc',
      venue: 'deribit',
      instrument: 'BTC-28MAR26-100000-C',
      side: 'buy',
      price: 0.04,
      size: 5,
      iv: 0.5,
      premiumUsd: 1200,
      notionalUsd: 24000,
      referencePriceUsd: 4800,
    });

    expect(vi.mocked(services.tradeStore.loadHistory)).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'live',
        venues: ['deribit'],
        instrumentName: 'BTC-28MAR26-100000-C',
      }),
    );
  });
});
