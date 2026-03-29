import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CachedInstrument } from '../shared/sdk-base.js';
import { DeriveWsAdapter } from './ws-client.js';

afterEach(() => {
  vi.restoreAllMocks();
});

type DeriveWsAdapterInternals = {
  rpc: {
    call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
    subscribe: (batch: string[]) => Promise<void>;
  };
  parseInstrument: (item: unknown) => CachedInstrument | null;
  refreshInstruments: () => Promise<void>;
  subscriptions: { subscribedTickers: Set<string> };
  requestRefCounts: Map<string, number>;
};

describe('DeriveWsAdapter', () => {
  it('subscribes refreshed instruments for active requests', async () => {
    const adapter = new DeriveWsAdapter();
    const internals = adapter as unknown as DeriveWsAdapterInternals;
    const subscribe = vi.fn(async () => {});

    internals.rpc = {
      call: vi.fn(async (_method, params) => {
        if (params['expiry_date']) {
          return { tickers: {} };
        }
        return [{ instrument_name: 'BTC-20260327-70000-C', instrument_type: 'option' }];
      }),
      subscribe,
    };

    internals.parseInstrument = vi.fn(() => ({
      symbol: 'BTC/USDC:USDC-260327-70000-C',
      exchangeSymbol: 'BTC-20260327-70000-C',
      base: 'BTC',
      quote: 'USDC',
      settle: 'USDC',
      expiry: '2026-03-27',
      strike: 70_000,
      right: 'call' as const,
      inverse: false,
      contractSize: 1,
      contractValueCurrency: 'BTC',
      tickSize: null,
      minQty: null,
      makerFee: null,
      takerFee: null,
    }));
    internals.requestRefCounts.set('BTC:2026-03-27', 1);

    await internals.refreshInstruments();

    expect(subscribe).toHaveBeenCalledWith(['ticker_slim.BTC-20260327-70000-C.1000']);
    expect(internals.subscriptions.subscribedTickers.has('BTC-20260327-70000-C')).toBe(true);
  });
});
