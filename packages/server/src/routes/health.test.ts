import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('../services.js', () => ({
  getIvHistoryStorageStats: vi.fn(() =>
    Promise.resolve({
      enabled: true,
      bytes: 1024,
      thresholdBytes: 10 * 1024 * 1024 * 1024,
      warning: false,
    }),
  ),
  isBlockFlowReady: vi.fn(() => true),
  isDvolReady: vi.fn(() => true),
  isFlowReady: vi.fn(() => true),
  isIvHistoryReady: vi.fn(() => true),
  isNewsReady: vi.fn(() => true),
  isSpotReady: vi.fn(() => true),
}));

import * as services from '../services.js';
import { healthRoute } from './health.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(healthRoute);
  await app.ready();
  return app;
}

describe('GET /health', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('includes IV history readiness and storage stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json().services).toMatchObject({
      ivHistory: true,
      ivHistoryStorage: {
        enabled: true,
        bytes: 1024,
        thresholdBytes: 10 * 1024 * 1024 * 1024,
        warning: false,
      },
    });
  });

  it('surfaces IV history storage warnings', async () => {
    vi.mocked(services.getIvHistoryStorageStats).mockResolvedValueOnce({
      enabled: true,
      bytes: 11 * 1024 * 1024 * 1024,
      thresholdBytes: 10 * 1024 * 1024 * 1024,
      warning: true,
    });

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json().services.ivHistoryStorage).toMatchObject({
      bytes: 11 * 1024 * 1024 * 1024,
      warning: true,
    });
  });
});
