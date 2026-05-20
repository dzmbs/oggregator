import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';

const { getAllSnapshotsMock, isSpotReadyMock } = vi.hoisted(() => ({
  getAllSnapshotsMock: vi.fn(),
  isSpotReadyMock: vi.fn(() => true),
}));

vi.mock('../services.js', () => ({
  isSpotReady: isSpotReadyMock,
  spotService: { getAllSnapshots: getAllSnapshotsMock },
}));

import { spotsRoute } from './spots.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(spotsRoute);
  await app.ready();
  return app;
}

describe('GET /spots', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    getAllSnapshotsMock.mockReset();
    isSpotReadyMock.mockReturnValue(true);
  });

  it('maps spot snapshots to the wire shape', async () => {
    getAllSnapshotsMock.mockReturnValue([
      {
        symbol: 'BTCUSDT',
        lastPrice: 67432,
        prevPrice24h: 67000,
        change24hPct: 0.0064,
        high24h: 68000,
        low24h: 66500,
        updatedAt: 1234567890,
      },
    ]);

    const res = await app.inject({ method: 'GET', url: '/spots' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [{ symbol: 'BTCUSDT', lastPrice: 67432, change24hPct: 0.0064, updatedAt: 1234567890 }],
    });
  });

  it('returns empty when spot service not ready', async () => {
    isSpotReadyMock.mockReturnValue(false);
    const res = await app.inject({ method: 'GET', url: '/spots' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });
});
