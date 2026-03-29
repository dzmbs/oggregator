import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import type { DvolSnapshot, SpotSnapshot } from '@oggregator/core';

vi.mock('../services.js', () => ({
  isFlowReady: vi.fn(() => false),
  isDvolReady: vi.fn(() => false),
  isSpotReady: vi.fn(() => false),
  flowService: { getTrades: vi.fn() },
  dvolService: { getSnapshot: vi.fn() },
  spotService: { getSnapshot: vi.fn() },
}));

import * as services from '../services.js';
import { statsRoute } from './stats.js';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeDvol(overrides: Partial<DvolSnapshot> = {}): DvolSnapshot {
  return {
    currency: 'BTC',
    current: 0.52,
    high52w: 0.8,
    low52w: 0.3,
    ivr: 65,
    previousClose: 0.5,
    ivChange1d: 0.02,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeSpot(overrides: Partial<SpotSnapshot> = {}): SpotSnapshot {
  return {
    symbol: 'BTCUSDT',
    lastPrice: 70_000,
    prevPrice24h: 68_000,
    change24hPct: 2.5,
    high24h: 71_000,
    low24h: 69_000,
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setReady(dvol: boolean, spot: boolean) {
  vi.mocked(services.isDvolReady).mockReturnValue(dvol);
  vi.mocked(services.isSpotReady).mockReturnValue(spot);
}

const getDvol = () => vi.mocked(services.dvolService.getSnapshot);
const getSpot = () => vi.mocked(services.spotService.getSnapshot);

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(statsRoute);
  await app.ready();
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /stats', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns 503 when both services are not ready', async () => {
    setReady(false, false);
    const res = await app.inject({ method: 'GET', url: '/stats' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: expect.any(String) });
  });

  it('returns 200 when only dvol is ready', async () => {
    setReady(true, false);
    getDvol().mockReturnValue(makeDvol());
    getSpot().mockReturnValue(null);

    const res = await app.inject({ method: 'GET', url: '/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dvol).not.toBeNull();
    expect(body.spot).toBeNull();
  });

  it('returns 200 when only spot is ready', async () => {
    setReady(false, true);
    getDvol().mockReturnValue(null);
    getSpot().mockReturnValue(makeSpot());

    const res = await app.inject({ method: 'GET', url: '/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.spot).not.toBeNull();
    expect(body.dvol).toBeNull();
  });

  it('returns full stats when both services are ready', async () => {
    setReady(true, true);
    getDvol().mockReturnValue(makeDvol({ current: 0.52, ivr: 65 }));
    getSpot().mockReturnValue(makeSpot({ lastPrice: 70_000, change24hPct: 2.5 }));

    const res = await app.inject({ method: 'GET', url: '/stats?underlying=BTC' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.underlying).toBe('BTC');
    expect(body.spot).toMatchObject({ price: 70_000, change24hPct: 2.5 });
    expect(body.dvol).toMatchObject({ current: 0.52, ivr: 65 });
    expect(getDvol()).toHaveBeenCalledWith('BTC');
    expect(getSpot()).toHaveBeenCalledWith('BTC');
  });

  it('defaults underlying to BTC when not provided', async () => {
    setReady(true, true);
    getDvol().mockReturnValue(null);
    getSpot().mockReturnValue(null);

    const res = await app.inject({ method: 'GET', url: '/stats' });
    expect(res.json().underlying).toBe('BTC');
    expect(getDvol()).toHaveBeenCalledWith('BTC');
  });
});
