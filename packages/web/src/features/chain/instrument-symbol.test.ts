import { describe, it, expect } from 'vitest';
import { toVenueSymbol, NotSupportedVenueError } from './instrument-symbol.js';

describe('toVenueSymbol', () => {
  it('formats Deribit BTC call', () => {
    expect(toVenueSymbol({
      venue: 'deribit', underlying: 'BTC', expiry: '2026-06-27',
      strike: 70000, type: 'call',
    })).toBe('BTC-27JUN26-70000-C');
  });

  it('formats Deribit ETH put', () => {
    expect(toVenueSymbol({
      venue: 'deribit', underlying: 'ETH', expiry: '2026-09-26',
      strike: 3000, type: 'put',
    })).toBe('ETH-26SEP26-3000-P');
  });

  it('formats Deribit SOL call with fractional strike', () => {
    expect(toVenueSymbol({
      venue: 'deribit', underlying: 'SOL', expiry: '2026-05-30',
      strike: 1.14, type: 'call',
    })).toBe('SOL-30MAY26-1.14-C');
  });

  it('formats Binance BTC call', () => {
    expect(toVenueSymbol({
      venue: 'binance', underlying: 'BTC', expiry: '2026-06-26',
      strike: 80000, type: 'call',
    })).toBe('BTC-260626-80000-C');
  });

  it('formats Binance ETH put with single-digit day', () => {
    expect(toVenueSymbol({
      venue: 'binance', underlying: 'ETH', expiry: '2026-09-05',
      strike: 3000, type: 'put',
    })).toBe('ETH-260905-3000-P');
  });

  it('formats OKX BTC call (inverse)', () => {
    expect(toVenueSymbol({
      venue: 'okx', underlying: 'BTC', expiry: '2026-06-26',
      strike: 80000, type: 'call',
    })).toBe('BTC-USD-260626-80000-C');
  });

  it('formats Gate.io BTC call', () => {
    expect(toVenueSymbol({
      venue: 'gateio', underlying: 'BTC', expiry: '2026-06-26',
      strike: 80000, type: 'call',
    })).toBe('BTC_USDT-20260626-80000-C');
  });

  it('formats Bybit BTC call with USDT settlement suffix', () => {
    expect(toVenueSymbol({
      venue: 'bybit', underlying: 'BTC', expiry: '2026-06-26',
      strike: 80000, type: 'call',
    })).toBe('BTC-26JUN26-80000-C-USDT');
  });

  it('formats Derive BTC call', () => {
    expect(toVenueSymbol({
      venue: 'derive', underlying: 'BTC', expiry: '2026-09-25',
      strike: 80000, type: 'call',
    })).toBe('BTC-20260925-80000-C');
  });

  it('formats Thalex BTC call (Deribit-style DDMONYY)', () => {
    expect(toVenueSymbol({
      venue: 'thalex', underlying: 'BTC', expiry: '2026-06-26',
      strike: 80000, type: 'call',
    })).toBe('BTC-26JUN26-80000-C');
  });

  it('throws NotSupportedVenueError for unsupported venues', () => {
    expect(() =>
      toVenueSymbol({ venue: 'coincall', underlying: 'BTC', expiry: '2026-06-27', strike: 70000, type: 'call' }),
    ).toThrow(NotSupportedVenueError);
  });

  it('throws on invalid expiry', () => {
    expect(() =>
      toVenueSymbol({ venue: 'deribit', underlying: 'BTC', expiry: 'not-a-date', strike: 70000, type: 'call' }),
    ).toThrow(/invalid expiry/);
  });
});
