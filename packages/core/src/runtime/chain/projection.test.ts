import { describe, expect, it, vi } from 'vitest';
import { EMPTY_GREEKS, type VenueDelta, type VenueOptionChain } from '../../index.js';
import { ChainProjection } from './projection.js';

function buildChain(): VenueOptionChain {
  return {
    venue: 'deribit',
    underlying: 'BTC',
    expiry: '2026-03-27',
    asOf: Date.now(),
    contracts: {
      'BTC/USD:USDC-260327-70000-C': {
        venue: 'deribit',
        symbol: 'BTC/USD:USDC-260327-70000-C',
        exchangeSymbol: 'BTC-260327-70000-C',
        base: 'BTC',
        settle: 'USDC',
        expiry: '2026-03-27',
        expiryTs: null,
        strike: 70000,
        right: 'call',
        inverse: false,
        contractSize: 1,
        tickSize: 0.1,
        minQty: 0.1,
        makerFee: 0.0003,
        takerFee: 0.0003,
        greeks: { ...EMPTY_GREEKS, markIv: 0.5, delta: 0.5 },
        quote: {
          bid: { raw: 300, rawCurrency: 'USDC', usd: 300 },
          ask: { raw: 350, rawCurrency: 'USDC', usd: 350 },
          mark: { raw: 325, rawCurrency: 'USDC', usd: 325 },
          last: null,
          bidSize: 10,
          askSize: 20,
          underlyingPriceUsd: 70000,
          indexPriceUsd: 70000,
          volume24h: 100,
          openInterest: 500,
          openInterestUsd: null,
          volume24hUsd: null,
          estimatedFees: null,
          timestamp: 1000,
          source: 'ws',
        },
      },
    },
  };
}

describe('ChainProjection', () => {
  it('builds a snapshot from cached venue chains', () => {
    const projection = new ChainProjection('BTC', '2026-03-27');
    const snapshot = projection.loadSnapshot([buildChain()]);

    expect(snapshot.underlying).toBe('BTC');
    expect(snapshot.strikes).toHaveLength(1);
    expect(snapshot.strikes[0]?.strike).toBe(70000);
  });

  it('applies deltas and returns a patch for changed strikes', () => {
    const projection = new ChainProjection('BTC', '2026-03-27');
    projection.loadSnapshot([buildChain()]);

    const delta: VenueDelta = {
      venue: 'deribit',
      symbol: 'BTC/USD:USDC-260327-70000-C',
      ts: 2000,
      quote: {
        bid: { raw: 310, rawCurrency: 'USDC', usd: 310 },
      },
      greeks: {
        markIv: 0.51,
      },
    };

    const patch = projection.applyDeltas([delta]);

    expect(patch).not.toBeNull();
    expect(patch?.deltas).toHaveLength(1);
    expect(patch?.patch.strikes).toHaveLength(1);
    expect(patch?.patch.strikes[0]?.call.bestIv).toBe(0.51);
  });

  it('requests a resync when a delta references an unknown contract', () => {
    const projection = new ChainProjection('BTC', '2026-03-27');
    projection.loadSnapshot([buildChain()]);

    const patch = projection.applyDeltas([
      { venue: 'deribit', symbol: 'BTC/USD:USDC-260327-99999-C', ts: 2000 },
    ]);

    expect(patch).toBeNull();
  });

  it('computes staleMs from the oldest quote timestamp in the snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);

    const projection = new ChainProjection('BTC', '2026-03-27');
    projection.loadSnapshot([
      buildChain(),
      {
        ...buildChain(),
        venue: 'okx',
        contracts: {
          'BTC/USD:USDC-260327-70000-C': {
            ...buildChain().contracts['BTC/USD:USDC-260327-70000-C']!,
            venue: 'okx',
            quote: {
              ...buildChain().contracts['BTC/USD:USDC-260327-70000-C']!.quote,
              timestamp: 2_000,
            },
          },
        },
      },
    ]);

    const meta = projection.buildSnapshotMeta();

    expect(meta.maxQuoteTs).toBe(2_000);
    expect(meta.staleMs).toBe(4_000);

    vi.useRealTimers();
  });
});
