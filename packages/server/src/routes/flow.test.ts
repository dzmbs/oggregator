import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { TradeEvent } from '@oggregator/core';
import Fastify from 'fastify';

// vi.mock is hoisted before imports — the factory must be self-contained.
vi.mock('../services.js', () => ({
  isFlowReady: vi.fn(() => false),
  isDvolReady: vi.fn(() => false),
  isSpotReady: vi.fn(() => false),
  flowService: { getTrades: vi.fn() },
  dvolService: { getSnapshot: vi.fn() },
  spotService: { getSnapshot: vi.fn() },
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

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('returns 503 when flow service is not ready', async () => {
    setFlowReady(false);
    const res = await app.inject({ method: 'GET', url: '/flow' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: expect.any(String) });
  });

  // Build a minimal TradeEvent for test data — only fields the route serialises matter.
  function fakeTrades(count: number): TradeEvent[] {
    return Array.from({ length: count }, (_, i) => ({
      venue: 'deribit', instrument: `BTC-28MAR26-${70_000 + i}-C`,
      underlying: 'BTC', side: 'buy', price: 70_000 + i, size: 1,
      iv: 0.5, markPrice: 70_000, indexPrice: 70_000,
      isBlock: false, timestamp: Date.now() + i,
    } as TradeEvent));
  }

  it('returns trades with defaults (underlying=BTC, limit=100)', async () => {
    setFlowReady(true);
    getTrades().mockReturnValue(fakeTrades(50));

    const res = await app.inject({ method: 'GET', url: '/flow' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.underlying).toBe('BTC');
    expect(body.count).toBe(50);
    expect(getTrades()).toHaveBeenCalledWith('BTC', 0);
  });

  it('passes underlying and minNotional to getTrades', async () => {
    setFlowReady(true);
    getTrades().mockReturnValue([]);

    await app.inject({ method: 'GET', url: '/flow?underlying=ETH&minNotional=50000' });
    expect(getTrades()).toHaveBeenCalledWith('ETH', 50_000);
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
    expect(getTrades()).toHaveBeenCalledWith('BTC', 0);
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
    const trades = fakeTrades(3);  // timestamps: now+0, now+1, now+2
    getTrades().mockReturnValue(trades);

    const res = await app.inject({ method: 'GET', url: '/flow?limit=3' });
    const body = res.json();
    // slice(-3).reverse() → newest (index 2) first
    expect(body.trades[0].timestamp).toBe(trades[2]!.timestamp);
    expect(body.trades[2].timestamp).toBe(trades[0]!.timestamp);
  });
});
