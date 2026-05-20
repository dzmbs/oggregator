import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

const disposedVenues: string[] = [];

function makeAdapterClass(venue: string) {
  return class {
    readonly venue = venue;

    async loadMarkets(): Promise<void> {}

    async listUnderlyings(): Promise<string[]> {
      return [];
    }

    async dispose(): Promise<void> {
      disposedVenues.push(venue);
    }
  };
}

const registerAdapter = vi.fn();

vi.mock('@oggregator/core', () => ({
  registerAdapter,
  DeribitWsAdapter: makeAdapterClass('deribit'),
  OkxWsAdapter: makeAdapterClass('okx'),
  BinanceWsAdapter: makeAdapterClass('binance'),
  BybitWsAdapter: makeAdapterClass('bybit'),
  DeriveWsAdapter: makeAdapterClass('derive'),
  CoincallWsAdapter: makeAdapterClass('coincall'),
  ThalexWsAdapter: makeAdapterClass('thalex'),
  GateioWsAdapter: makeAdapterClass('gateio'),
}));

describe('disposeAdapters', () => {
  beforeEach(() => {
    disposedVenues.length = 0;
    registerAdapter.mockClear();
  });

  it('disposes every venue adapter during shutdown', async () => {
    const { disposeAdapters } = await import('./adapters.js');

    await disposeAdapters({ info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger);

    expect(new Set(disposedVenues)).toEqual(
      new Set(['deribit', 'okx', 'binance', 'bybit', 'derive', 'coincall', 'thalex', 'gateio']),
    );
  });
});
