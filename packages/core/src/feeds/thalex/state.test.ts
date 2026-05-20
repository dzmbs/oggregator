import { describe, expect, it } from 'vitest';
import { EMPTY_GREEKS } from '../../core/types.js';
import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import { buildThalexInstrument, mergeThalexTicker } from './state.js';
import type { ThalexInstrument, ThalexTicker } from './types.js';

function emptyQuote(): LiveQuote {
  return {
    bidPrice: null,
    askPrice: null,
    bidSize: null,
    askSize: null,
    markPrice: null,
    lastPrice: null,
    underlyingPrice: null,
    indexPrice: null,
    volume24h: null,
    openInterest: null,
    openInterestUsd: null,
    volume24hUsd: null,
    greeks: { ...EMPTY_GREEKS },
    timestamp: 0,
  };
}

const deps = {
  buildCanonicalSymbol: (b: string, s: string, e: string, k: number, r: 'call' | 'put') =>
    `${b}/USD:${s}-${e.slice(2).replace(/-/g, '')}-${k}-${r === 'call' ? 'C' : 'P'}`,
  parseExpiry: (raw: string) => {
    const m = raw.match(/^(\d+)([A-Z]{3})(\d{2})$/);
    if (!m) return raw;
    const months: Record<string, string> = {
      JAN: '01',
      FEB: '02',
      MAR: '03',
      APR: '04',
      MAY: '05',
      JUN: '06',
      JUL: '07',
      AUG: '08',
      SEP: '09',
      OCT: '10',
      NOV: '11',
      DEC: '12',
    };
    return `20${m[3]!}-${months[m[2]!] ?? '01'}-${m[1]!.padStart(2, '0')}`;
  },
};

describe('buildThalexInstrument', () => {
  it('parses a BTC put option', () => {
    const row: ThalexInstrument = {
      instrument_name: 'BTC-21APR26-75000-P',
      underlying: 'BTCUSD',
      type: 'option',
      option_type: 'put',
      expiry_date: '2026-04-21',
      expiration_timestamp: 1776758400,
      strike_price: 75000,
      tick_size: 5,
      min_order_amount: 0.01,
    };
    const inst = buildThalexInstrument(row, deps);
    expect(inst).not.toBeNull();
    expect(inst).toMatchObject({
      exchangeSymbol: 'BTC-21APR26-75000-P',
      base: 'BTC',
      settle: 'USD',
      expiry: '2026-04-21',
      strike: 75000,
      right: 'put',
      inverse: false,
      contractSize: 1,
      // 1 contract = 1 BTC of underlying exposure; stablecoin settlement is
      // about premium currency, not contract sizing. Must match `base` so
      // normalizeOpenInterestUsd multiplies by underlyingPrice.
      contractValueCurrency: 'BTC',
      tickSize: 5,
      minQty: 0.01,
      makerFee: null,
      takerFee: null,
    });
    // seconds → ms
    expect(inst?.expirationTimestamp).toBe(1776758400 * 1000);
  });

  it('returns null for non-option types', () => {
    const row: ThalexInstrument = {
      instrument_name: 'BTC-PERPETUAL',
      underlying: 'BTCUSD',
      type: 'perpetual',
    };
    expect(buildThalexInstrument(row, deps)).toBeNull();
  });

  it('returns null when the symbol does not match the option regex', () => {
    const row: ThalexInstrument = {
      instrument_name: 'BTC-PERPETUAL',
      underlying: 'BTCUSD',
      type: 'option',
    };
    expect(buildThalexInstrument(row, deps)).toBeNull();
  });
});

describe('mergeThalexTicker', () => {
  it('fills bid/ask/mark/iv/delta and converts mark_timestamp s→ms', () => {
    const t: ThalexTicker = {
      mark_price: 53.21791443839902,
      mark_timestamp: 1776715497.7188172,
      best_bid_price: 40,
      best_bid_amount: 0.26,
      best_ask_price: 75,
      best_ask_amount: 0.25,
      last_price: 345,
      iv: 0.36920014956066893,
      delta: -0.10629456689577088,
      volume_24h: 0.28,
      value_24h: 121.5,
      index: 76283.25916666667,
      forward: 76276.40187647431,
      open_interest: 0.18,
    };
    const q = mergeThalexTicker(t, undefined, emptyQuote());
    expect(q.bidPrice).toBe(40);
    expect(q.askPrice).toBe(75);
    expect(q.bidSize).toBe(0.26);
    expect(q.askSize).toBe(0.25);
    expect(q.markPrice).toBeCloseTo(53.2179, 3);
    expect(q.lastPrice).toBe(345);
    expect(q.underlyingPrice).toBeCloseTo(76283.26, 1);
    expect(q.greeks.markIv).toBeCloseTo(0.3692, 3);
    expect(q.greeks.delta).toBeCloseTo(-0.1063, 3);
    expect(q.volume24h).toBe(0.28);
    // Thalex `value_24h` is premium-notional; intentionally dropped so the
    // enrichment layer computes underlying-notional via volume24h × spot
    // (matches OKX/Binance/Coincall/Deribit).
    expect(q.volume24hUsd).toBeNull();
    expect(q.openInterest).toBe(0.18);
    expect(q.timestamp).toBe(Math.round(1776715497.7188172 * 1000));
  });

  it('preserves gamma/theta/vega from previous (Thalex never sets them)', () => {
    const prev = emptyQuote();
    prev.greeks = { ...prev.greeks, gamma: 0.01, theta: -12.5, vega: 42 };
    const q = mergeThalexTicker(
      { mark_timestamp: 1, iv: 0.5, delta: 0.5 },
      prev,
      emptyQuote(),
    );
    expect(q.greeks.gamma).toBe(0.01);
    expect(q.greeks.theta).toBe(-12.5);
    expect(q.greeks.vega).toBe(42);
    expect(q.greeks.markIv).toBe(0.5);
  });

  it('inverts bidIv/askIv and derives theta from forward + bid/ask when instrument is supplied', () => {
    // Fixture values close to an ATM BTC weekly: F≈76_276, K=76_000, ~7d out,
    // markIv≈0.55. Newton from markIv seed should converge quickly.
    const now = 1_776_715_497_000;
    const instrument: CachedInstrument = {
      symbol: 'BTC/USD:USD-260428-76000-C',
      exchangeSymbol: 'BTC-28APR26-76000-C',
      base: 'BTC',
      quote: 'USD',
      settle: 'USD',
      expiry: '2026-04-28',
      expirationTimestamp: now + 7 * 24 * 3600 * 1000,
      strike: 76_000,
      right: 'call',
      inverse: false,
      contractSize: 1,
      contractValueCurrency: 'BTC',
      tickSize: 5,
      minQty: 0.01,
      makerFee: null,
      takerFee: null,
    };
    const t: ThalexTicker = {
      mark_price: 1_500,
      mark_timestamp: now / 1000,
      best_bid_price: 1_450,
      best_ask_price: 1_550,
      iv: 0.55,
      index: 76_283,
      forward: 76_276,
    };
    const q = mergeThalexTicker(t, undefined, emptyQuote(), instrument, now);

    expect(q.greeks.markIv).toBeCloseTo(0.55, 4);
    // Solved IVs must bracket the mark (bid cheaper → lower IV; ask richer → higher IV).
    expect(q.greeks.bidIv).not.toBeNull();
    expect(q.greeks.askIv).not.toBeNull();
    expect(q.greeks.bidIv!).toBeLessThan(q.greeks.askIv!);
    expect(q.greeks.bidIv!).toBeGreaterThan(0);
    expect(q.greeks.bidIv!).toBeLessThan(2);
    // Theta must be negative (USD/day decay).
    expect(q.greeks.theta).not.toBeNull();
    expect(q.greeks.theta!).toBeLessThan(0);
  });

  it('preserves bidIv/askIv/theta when instrument is omitted (back-compat)', () => {
    const prev = emptyQuote();
    prev.greeks = { ...prev.greeks, bidIv: 0.4, askIv: 0.5, theta: -12.5 };
    const q = mergeThalexTicker(
      { mark_timestamp: 1, iv: 0.45, best_bid_price: 10, best_ask_price: 12 },
      prev,
      emptyQuote(),
    );
    expect(q.greeks.bidIv).toBe(0.4);
    expect(q.greeks.askIv).toBe(0.5);
    expect(q.greeks.theta).toBe(-12.5);
  });

  it('preserves bid/ask on a partial update that omits them', () => {
    const prev = emptyQuote();
    prev.bidPrice = 10;
    prev.askPrice = 12;
    const q = mergeThalexTicker(
      { mark_timestamp: 2, mark_price: 11 },
      prev,
      emptyQuote(),
    );
    expect(q.bidPrice).toBe(10);
    expect(q.askPrice).toBe(12);
    expect(q.markPrice).toBe(11);
  });
});
