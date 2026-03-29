import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CachedInstrument } from '../shared/sdk-base.js';
import { BinanceWsAdapter } from './ws-client.js';

afterEach(() => {
  vi.restoreAllMocks();
});

type BinanceWsAdapterInternals = {
  wsClient: {
    send: (payload: unknown) => void;
    isConnected: boolean;
  };
  subscribeChain: (underlying: string, expiry: string, instruments: CachedInstrument[]) => Promise<void>;
  handleWsMessage: (msg: unknown) => void;
  subscriptions: {
    subscribedStreams: Set<string>;
    pendingSubscribeStreams: Set<string>;
  };
};

describe('BinanceWsAdapter', () => {
  it('rolls back pending streams when Binance rejects a subscribe request', async () => {
    const adapter = new BinanceWsAdapter();
    const internals = adapter as unknown as BinanceWsAdapterInternals;

    internals.wsClient = {
      send: vi.fn(),
      isConnected: true,
    };

    await internals.subscribeChain('BTC', '2026-03-27', [{
      symbol: 'BTC/USDT:USDT-BTC-260327-70000-C',
      exchangeSymbol: 'BTC-260327-70000-C',
      base: 'BTC',
      quote: 'USDT',
      settle: 'USDT',
      expiry: '2026-03-27',
      strike: 70_000,
      right: 'call',
      inverse: false,
      contractSize: 1,
      contractValueCurrency: 'BTC',
      tickSize: null,
      minQty: null,
      makerFee: null,
      takerFee: null,
    }]);

    expect([...internals.subscriptions.pendingSubscribeStreams]).toEqual([
      'btcusdt@optionMarkPrice',
      'btcusdt@openInterest@260327',
    ]);

    internals.handleWsMessage({ code: 2, msg: 'Invalid request: unknown stream' });

    expect(internals.subscriptions.pendingSubscribeStreams.size).toBe(0);
    expect(internals.subscriptions.subscribedStreams.size).toBe(0);
  });
});
