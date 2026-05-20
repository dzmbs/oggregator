import { describe, expect, it, vi } from 'vitest';
import { SdkBaseAdapter, type CachedInstrument, type LiveQuote } from './sdk-base.js';
import type { ChainRequest, VenueOptionChain } from '../../core/types.js';
import type { StreamHandlers, VenueCapabilities } from './types.js';
import type { VenueId } from '../../types/common.js';
import { EMPTY_GREEKS } from '../../core/types.js';

class TestSdkAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'binance';
  override readonly capabilities: VenueCapabilities = {
    optionChain: true,
    greeks: true,
    websocket: true,
  };

  protected initClients(): void {}
  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    return [];
  }
  protected async subscribeChain(): Promise<void> {}
  protected async unsubscribeAll(): Promise<void> {}

  addInstrument(instrument: CachedInstrument): void {
    this.instruments.push(instrument);
    this.instrumentMap.set(instrument.exchangeSymbol, instrument);
    this.symbolIndex.set(instrument.symbol, instrument.exchangeSymbol);
  }

  addHandler(handlers: StreamHandlers): void {
    this.deltaHandlers.add(handlers);
  }

  publish(updates: Array<{ exchangeSymbol: string; quote: LiveQuote }>): void {
    this.emitQuoteUpdates(updates);
  }

  normalize(raw: number | null, instrument: CachedInstrument) {
    return this.normPrice(raw, instrument);
  }

  sweep(now?: number): CachedInstrument[] {
    return this.sweepExpiredInstruments(now);
  }

  listCached(): CachedInstrument[] {
    return [...this.instruments];
  }

  override async fetchOptionChain(_request: ChainRequest): Promise<VenueOptionChain> {
    throw new Error('not implemented');
  }
}

function createInstrument(
  exchangeSymbol: string,
  strike: number,
  inverse = false,
): CachedInstrument {
  return {
    symbol: `BTC/USD:USDT-260327-${strike}-C`,
    exchangeSymbol,
    base: 'BTC',
    quote: 'USDT',
    settle: 'USDT',
    expiry: '2026-03-27',
    strike,
    right: 'call',
    inverse,
    contractSize: 1,
    tickSize: 0.1,
    minQty: 0.1,
    makerFee: 0.0002,
    takerFee: 0.0005,
  };
}

function createQuote(timestamp: number): LiveQuote {
  return {
    bidPrice: 100,
    askPrice: 110,
    bidSize: 1,
    askSize: 2,
    markPrice: 105,
    lastPrice: 106,
    underlyingPrice: 70_000,
    indexPrice: 69_900,
    volume24h: 5,
    openInterest: 10,
    openInterestUsd: 700_000,
    volume24hUsd: 350_000,
    greeks: { ...EMPTY_GREEKS, markIv: 0.5 },
    timestamp,
  };
}

describe('SdkBaseAdapter', () => {
  it('fans out one batched delta callback for multiple quote updates', () => {
    const adapter = new TestSdkAdapter();
    adapter.addInstrument(createInstrument('BTC-260327-70000-C', 70_000));
    adapter.addInstrument(createInstrument('BTC-260327-80000-C', 80_000));

    const onDelta = vi.fn<(deltas: unknown[]) => void>();
    adapter.addHandler({ onDelta, onStatus: vi.fn() });

    adapter.publish([
      { exchangeSymbol: 'BTC-260327-70000-C', quote: createQuote(1) },
      { exchangeSymbol: 'BTC-260327-80000-C', quote: createQuote(2) },
    ]);

    expect(onDelta).toHaveBeenCalledTimes(1);
    const [deltas] = onDelta.mock.calls[0] ?? [];
    expect(deltas).toHaveLength(2);
  });

  describe('sweepExpiredInstruments', () => {
    // 2026-04-24 08:00 UTC — canonical 0DTE cutoff for all venues.
    const EXPIRY_TS = Date.UTC(2026, 3, 24, 8, 0, 0);

    function createExpiring(exchangeSymbol: string, expirationTimestamp: number | null): CachedInstrument {
      return { ...createInstrument(exchangeSymbol, 70_000), expiry: '2026-04-24', expirationTimestamp };
    }

    it('removes an instrument whose expirationTimestamp has passed even when the UTC date is still today', () => {
      const adapter = new TestSdkAdapter();
      adapter.addInstrument(createExpiring('BTC-260424-70000-C', EXPIRY_TS));

      // One second after 08:00 UTC on the same UTC date.
      const removed = adapter.sweep(EXPIRY_TS + 1_000);

      expect(removed.map((i) => i.exchangeSymbol)).toEqual(['BTC-260424-70000-C']);
      expect(adapter.listCached()).toEqual([]);
    });

    it('keeps an instrument before its expirationTimestamp even on the expiry UTC date', () => {
      const adapter = new TestSdkAdapter();
      adapter.addInstrument(createExpiring('BTC-260424-70000-C', EXPIRY_TS));

      // 07:59 UTC on expiry date — not yet expired.
      const removed = adapter.sweep(EXPIRY_TS - 60_000);

      expect(removed).toEqual([]);
      expect(adapter.listCached()).toHaveLength(1);
    });

    it('falls back to date comparison when expirationTimestamp is missing', () => {
      const adapter = new TestSdkAdapter();
      adapter.addInstrument(createExpiring('BTC-260424-70000-C', null));

      // Still 2026-04-24 UTC — date-based sweep must not remove it.
      expect(adapter.sweep(EXPIRY_TS + 60_000)).toEqual([]);

      // 2026-04-25 UTC — date has rolled, date-based sweep removes it.
      const tomorrow = Date.UTC(2026, 3, 25, 0, 0, 1);
      expect(adapter.sweep(tomorrow).map((i) => i.exchangeSymbol)).toEqual(['BTC-260424-70000-C']);
    });
  });

  it('returns null USD for inverse prices until the underlying price is known', () => {
    const adapter = new TestSdkAdapter();
    const instrument = createInstrument('BTC-260327-70000-C', 70_000, true);

    adapter.addInstrument(instrument);

    expect(adapter.normalize(0.1, instrument)).toEqual({
      raw: 0.1,
      rawCurrency: 'BTC',
      usd: null,
    });

    adapter.publish([{ exchangeSymbol: instrument.exchangeSymbol, quote: createQuote(1) }]);

    expect(adapter.normalize(0.1, instrument)).toEqual({
      raw: 0.1,
      rawCurrency: 'BTC',
      usd: 7000,
    });
  });
});
