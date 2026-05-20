import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_GREEKS, type VenueOptionChain, type WsSubscriptionRequest } from '../../index.js';
import { ChainRuntime } from './chain-runtime.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const fetchOptionChainMock = vi.fn();
const getRegisteredVenuesMock = vi.fn(() => ['okx']);

vi.mock('../../core/registry.js', () => ({
  getAdapter: (venue: string) => ({
    venue,
    fetchOptionChain: fetchOptionChainMock,
  }),
  getRegisteredVenues: () => getRegisteredVenuesMock(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  fetchOptionChainMock.mockReset();
  getRegisteredVenuesMock.mockReset();
  getRegisteredVenuesMock.mockReturnValue(['okx']);
});

function request(): WsSubscriptionRequest {
  return {
    underlying: 'BTC',
    expiry: '2026-03-27',
    venues: ['okx'],
  };
}

function makeChain(timestamp: number, bidUsd: number): VenueOptionChain {
  return {
    venue: 'okx',
    underlying: 'BTC',
    expiry: '2026-03-27',
    asOf: timestamp,
    contracts: {
      'BTC/USD:BTC-260327-70000-C': {
        venue: 'okx',
        symbol: 'BTC/USD:BTC-260327-70000-C',
        exchangeSymbol: 'BTC-USD-260327-70000-C',
        base: 'BTC',
        settle: 'BTC',
        expiry: '2026-03-27',
        expiryTs: null,
        strike: 70_000,
        right: 'call',
        inverse: true,
        contractSize: 0.01,
        tickSize: null,
        minQty: null,
        makerFee: null,
        takerFee: null,
        greeks: { ...EMPTY_GREEKS, delta: 0.5, gamma: 0.01, markIv: 0.5 },
        quote: {
          bid: { raw: 0.1, rawCurrency: 'BTC', usd: bidUsd },
          ask: { raw: 0.11, rawCurrency: 'BTC', usd: bidUsd + 100 },
          mark: { raw: 0.105, rawCurrency: 'BTC', usd: bidUsd + 50 },
          last: null,
          bidSize: null,
          askSize: null,
          underlyingPriceUsd: 67_000,
          indexPriceUsd: 67_000,
          volume24h: null,
          openInterest: 100,
          openInterestUsd: 67_000,
          volume24hUsd: null,
          estimatedFees: null,
          timestamp,
          source: 'ws',
        },
      },
    },
  };
}

type ChainRuntimeInternals = {
  buildSnapshot: () => Promise<void>;
  venueListener: {
    onDelta: (
      deltas: Array<{
        venue: 'okx';
        symbol: string;
        ts: number;
        quote?: { bid?: { raw: number; rawCurrency: 'BTC'; usd: number } };
      }>,
    ) => void;
  };
  pendingBySymbol: Map<string, { version: number }>;
};

describe('ChainRuntime', () => {
  it('releases handles that resolve after runtime disposal', async () => {
    const acquireGate = deferred<{ release: () => Promise<void> }>();
    const release = vi.fn(async () => {});
    const coordinator = {
      acquire: vi.fn(async () => acquireGate.promise),
    };

    const runtime = new ChainRuntime('test', request(), {
      coordinator: coordinator as never,
    });

    const readyPromise = runtime.ready();
    await Promise.resolve();
    await runtime.dispose();

    acquireGate.resolve({ release });
    await readyPromise;

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('keeps the newest snapshot when rebuilds finish out of order', async () => {
    const first = deferred<VenueOptionChain>();
    const second = deferred<VenueOptionChain>();
    fetchOptionChainMock
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);

    const runtime = new ChainRuntime('test', request(), {
      coordinator: { acquire: vi.fn() } as never,
    });
    const internals = runtime as unknown as ChainRuntimeInternals;

    const firstBuild = internals.buildSnapshot();
    const secondBuild = internals.buildSnapshot();

    second.resolve(makeChain(2_000, 200));
    await secondBuild;
    first.resolve(makeChain(1_000, 100));
    await firstBuild;

    expect(runtime.getSnapshot()?.data.strikes[0]?.call.venues.okx?.bid).toBe(200);
  });

  it('preserves deltas that arrive while a snapshot rebuild is in flight', async () => {
    const snapshotGate = deferred<VenueOptionChain>();
    fetchOptionChainMock.mockImplementationOnce(async () => snapshotGate.promise);

    const runtime = new ChainRuntime('test', request(), {
      coordinator: { acquire: vi.fn() } as never,
    });
    const internals = runtime as unknown as ChainRuntimeInternals & {
      venueListener: {
        onDelta: (
          deltas: Array<{
            venue: 'okx';
            symbol: string;
            ts: number;
            quote?: { bid?: { raw: number; rawCurrency: 'BTC'; usd: number } };
          }>,
        ) => void;
      };
    };

    const build = internals.buildSnapshot();
    internals.venueListener.onDelta([
      {
        venue: 'okx',
        symbol: 'BTC/USD:BTC-260327-70000-C',
        ts: 3_000,
        quote: { bid: { raw: 0.2, rawCurrency: 'BTC', usd: 300 } },
      },
    ]);

    expect(internals.pendingBySymbol.size).toBe(1);
    snapshotGate.resolve(makeChain(1_000, 100));
    await build;

    expect(internals.pendingBySymbol.size).toBe(1);
  });
});
