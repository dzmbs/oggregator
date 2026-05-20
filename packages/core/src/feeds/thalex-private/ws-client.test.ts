import { afterEach, describe, expect, it, vi } from 'vitest';

const thalexWsMockState = vi.hoisted(() => ({
  sentPayloads: [] as Array<{ id: number; method: string; params: Record<string, unknown> }>,
  loginResult: { account_number: 'main' },
  subscribeResult: ['account.portfolio', 'account.summary'],
  portfolioResult: [
    {
      instrument_name: 'BTC-21APR26-75000-C',
      position: 2,
      average_price: 1850.5,
      mark_price: 1900,
    },
  ],
}));

const mintAuthTokenMock = vi.hoisted(() => vi.fn(() => 'jwt-token'));

vi.mock('./auth.js', () => ({
  mintAuthToken: mintAuthTokenMock,
}));

vi.mock('../shared/topic-ws-client.js', () => ({
  TopicWsClient: class {
    public isConnected = false;

    constructor(
      private readonly _url: string,
      private readonly _label: string,
      private readonly options: {
        onStatusChange?: (state: 'connected' | 'reconnecting' | 'down') => void;
        onMessage?: (raw: Buffer) => void;
      },
    ) {}

    async connect(): Promise<void> {
      this.isConnected = true;
      this.options.onStatusChange?.('connected');
    }

    async disconnect(): Promise<void> {
      this.isConnected = false;
    }

    send(payload: string | Record<string, unknown>): void {
      const msg = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (msg == null || typeof msg !== 'object') return;

      const id = typeof msg.id === 'number' ? msg.id : 0;
      const method = typeof msg.method === 'string' ? msg.method : '';
      const params =
        msg.params != null && typeof msg.params === 'object'
          ? (msg.params as Record<string, unknown>)
          : {};
      thalexWsMockState.sentPayloads.push({ id, method, params });

      const result =
        method === 'public/login'
          ? thalexWsMockState.loginResult
          : method === 'private/subscribe'
            ? thalexWsMockState.subscribeResult
            : method === 'private/portfolio'
              ? thalexWsMockState.portfolioResult
              : null;

      this.options.onMessage?.(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, result })));
    }
  },
}));

import { ThalexPrivateClient } from './ws-client.js';

afterEach(() => {
  vi.restoreAllMocks();
  mintAuthTokenMock.mockClear();
  thalexWsMockState.sentPayloads.length = 0;
  thalexWsMockState.loginResult = { account_number: 'main' };
  thalexWsMockState.subscribeResult = ['account.portfolio', 'account.summary'];
  thalexWsMockState.portfolioResult = [
    {
      instrument_name: 'BTC-21APR26-75000-C',
      position: 2,
      average_price: 1850.5,
      mark_price: 1900,
    },
  ];
});

describe('ThalexPrivateClient', () => {
  it('bootstraps positions from private/portfolio after login and subscribe', async () => {
    const client = new ThalexPrivateClient({
      kid: 'kid-1',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
      account: 'main',
    });
    const listener = vi.fn();

    client.subscribe(listener);

    await client.start();

    expect(mintAuthTokenMock).toHaveBeenCalledWith({
      kid: 'kid-1',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    });
    expect(thalexWsMockState.sentPayloads.map((payload) => payload.method)).toEqual([
      'public/login',
      'private/subscribe',
      'private/portfolio',
    ]);
    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({
        legId: 'thalex|BTC|2026-04-21|75000|call',
        underlying: 'BTC',
        expiry: '2026-04-21',
        strike: 75000,
        optionRight: 'call',
        size: 2,
        entryPriceUsd: 1850.5,
        source: 'thalex',
      }),
    ]);
    expect(client.getLatestLegs()).toEqual([
      expect.objectContaining({
        legId: 'thalex|BTC|2026-04-21|75000|call',
        size: 2,
        entryPriceUsd: 1850.5,
      }),
    ]);
  });
});
