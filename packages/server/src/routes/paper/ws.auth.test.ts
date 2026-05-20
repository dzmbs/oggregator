import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';

const { storeMock, getUserByApiKeyMock } = vi.hoisted(() => ({
  storeMock: { enabled: false as boolean },
  getUserByApiKeyMock: vi.fn(),
}));

vi.mock('../../trading-services.js', () => ({
  paperTradingStore: storeMock,
  pnlService: {
    snapshot: vi.fn().mockResolvedValue({
      cashUsd: 0,
      realizedUsd: 0,
      unrealizedUsd: 0,
      equityUsd: 0,
      totalReturnPct: 0,
    }),
  },
  positionRepository: { listPositions: vi.fn().mockResolvedValue([]) },
  quoteProvider: { getMark: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../user-service.js', () => ({
  getUserByApiKey: getUserByApiKeyMock,
}));

import { paperWsRoute } from './ws.js';

const WS_CLOSED = 3;

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  await app.register(paperWsRoute);
  await app.ready();
  return app;
}

async function waitForState(
  ws: { readyState: number },
  target: number,
  timeoutMs = 500,
): Promise<number> {
  const start = Date.now();
  while (ws.readyState !== target && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return ws.readyState;
}

describe('WS /ws/paper auth gate', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    storeMock.enabled = false;
    getUserByApiKeyMock.mockReset();
  });

  it('closes the connection without a hello when anonymous and persistence is enabled', async () => {
    storeMock.enabled = true;
    const ws = await app.injectWS('/ws/paper');
    expect(await waitForState(ws, WS_CLOSED)).toBe(WS_CLOSED);
  });

  it('closes the connection when apiKey is invalid and persistence is enabled', async () => {
    storeMock.enabled = true;
    getUserByApiKeyMock.mockResolvedValue(null);

    const ws = await app.injectWS('/ws/paper?apiKey=does-not-exist');
    expect(await waitForState(ws, WS_CLOSED)).toBe(WS_CLOSED);
    expect(getUserByApiKeyMock).toHaveBeenCalledWith('does-not-exist');
  });

  it('accepts authenticated connections and keeps them open', async () => {
    storeMock.enabled = true;
    getUserByApiKeyMock.mockResolvedValue({
      id: 'usr_abc',
      apiKey: 'good-key',
      accountId: 'acct_alice',
      label: 'alice',
      createdAt: new Date(),
    });

    const ws = await app.injectWS('/ws/paper?apiKey=good-key');
    await new Promise((r) => setTimeout(r, 100));

    expect(getUserByApiKeyMock).toHaveBeenCalledWith('good-key');
    expect(ws.readyState).not.toBe(WS_CLOSED);

    ws.terminate();
  });

  it('accepts anonymous connections (default account) when persistence is disabled', async () => {
    storeMock.enabled = false;
    const ws = await app.injectWS('/ws/paper');
    await new Promise((r) => setTimeout(r, 100));
    expect(ws.readyState).not.toBe(WS_CLOSED);
    expect(getUserByApiKeyMock).not.toHaveBeenCalled();
    ws.terminate();
  });
});
