import { describe, expect, it } from 'vitest';
import { EMPTY_GREEKS } from '../../core/types.js';
import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import {
  buildCoincallInstrument,
  mergeCoincallBsInfo,
  mergeCoincallOrderBook,
  mergeCoincallTOption,
} from './state.js';
import type { CoincallInstrument, CoincallOptionConfigEntry } from './types.js';

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

function testInstrument(overrides: Partial<CachedInstrument> = {}): CachedInstrument {
  return {
    symbol: 'BTC/USD:USD-991231-30000-C',
    exchangeSymbol: 'BTCUSD-31DEC99-30000-C',
    base: 'BTC',
    quote: 'USD',
    settle: 'USD',
    expiry: '2099-12-31',
    expirationTimestamp: Date.parse('2099-12-31T08:00:00.000Z'),
    strike: 30000,
    right: 'call' as const,
    inverse: false,
    contractSize: 0.01,
    tickSize: 0.1,
    minQty: 0.01,
    makerFee: 0.0003,
    takerFee: 0.0004,
    ...overrides,
  };
}

function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function blackScholesCall(spot: number, strike: number, timeYears: number, volatility: number): number {
  const sqrtT = Math.sqrt(timeYears);
  const sigmaSqrtT = volatility * sqrtT;
  const d1 = (Math.log(spot / strike) + 0.5 * volatility * volatility * timeYears) / sigmaSqrtT;
  const d2 = d1 - sigmaSqrtT;
  return spot * normalCdf(d1) - strike * normalCdf(d2);
}

const BTC_CONFIG: Record<string, CoincallOptionConfigEntry> = {
  BTCUSD: {
    symbol: 'BTCUSD',
    base: 'BTC',
    settle: 'USD',
    takerFee: 0.0004,
    makerFee: 0.0003,
    multiplier: 0.01,
    tickSize: 0.1,
    priceDecimal: 2,
    qtyDecimal: 2,
  },
};

describe('buildCoincallInstrument', () => {
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

  it('parses a BTC call into a canonical instrument', () => {
    const row: CoincallInstrument = {
      baseCurrency: 'BTC',
      startTimestamp: 0,
      expirationTimestamp: 1694678400000,
      strike: 22500,
      symbolName: 'BTCUSD-14SEP23-22500-C',
      isActive: true,
      minQty: 0.01,
      tickSize: 1,
    };
    const inst = buildCoincallInstrument(row, BTC_CONFIG, deps);
    expect(inst).not.toBeNull();
    expect(inst).toMatchObject({
      exchangeSymbol: 'BTCUSD-14SEP23-22500-C',
      base: 'BTC',
      settle: 'USD',
      expiry: '2023-09-14',
      strike: 22500,
      right: 'call',
      inverse: false,
      contractSize: 0.01,
      contractValueCurrency: 'BTC',
      makerFee: 0.0003,
      takerFee: 0.0004,
    });
  });

  it('returns null for inactive instruments', () => {
    const row: CoincallInstrument = {
      baseCurrency: 'BTC',
      startTimestamp: 0,
      expirationTimestamp: 0,
      strike: 22500,
      symbolName: 'BTCUSD-14SEP23-22500-C',
      isActive: false,
      minQty: 0.01,
      tickSize: 1,
    };
    expect(buildCoincallInstrument(row, BTC_CONFIG, deps)).toBeNull();
  });

  it('returns null when the symbol does not match the regex', () => {
    const row: CoincallInstrument = {
      baseCurrency: 'BTC',
      startTimestamp: 0,
      expirationTimestamp: 0,
      strike: 22500,
      symbolName: 'weird-format',
      isActive: true,
      minQty: 0.01,
      tickSize: 1,
    };
    expect(buildCoincallInstrument(row, BTC_CONFIG, deps)).toBeNull();
  });

  it('falls back to USD settle when pair not in config', () => {
    const row: CoincallInstrument = {
      baseCurrency: 'DOGE',
      startTimestamp: 0,
      expirationTimestamp: 0,
      strike: 0.1,
      symbolName: 'DOGEUSD-14SEP23-0.1-P',
      isActive: true,
      minQty: 1,
      tickSize: 0.0001,
    };
    const inst = buildCoincallInstrument(row, {}, deps);
    expect(inst?.settle).toBe('USD');
    expect(inst?.makerFee).toBeNull();
  });
});

describe('mergeCoincallBsInfo', () => {
  it('fills markPrice, markIv, greeks, underlyingPrice from a bsInfo push', () => {
    const inst = testInstrument();
    const q = mergeCoincallBsInfo(
      {
        s: 'BTCUSD-28JUL23-33000-C',
        mp: 834.28,
        iv: 0.4728,
        delta: 0.34898,
        gamma: 0.0001,
        theta: -29.145,
        vega: 29.7,
        oi: 1000,
        up: 31248.97,
        ts: 1688449285840,
      },
      inst,
      undefined,
      emptyQuote(),
    );
    expect(q.markPrice).toBe(834.28);
    expect(q.greeks.markIv).toBe(0.4728);
    expect(q.greeks.delta).toBe(0.34898);
    expect(q.underlyingPrice).toBe(31248.97);
    expect(q.openInterest).toBe(1000);
    expect(q.timestamp).toBe(1688449285840);
    // bsInfo does not push bid/ask — they stay null on a fresh quote.
    expect(q.bidPrice).toBeNull();
    expect(q.askPrice).toBeNull();
  });

  it('preserves previous bid/ask fields on a bsInfo-only update', () => {
    const inst = testInstrument();
    const prev = emptyQuote();
    prev.bidPrice = 1;
    prev.askPrice = 2;
    prev.bidSize = 0.2;
    prev.askSize = 0.1;
    prev.greeks = { ...prev.greeks, bidIv: 0.4, askIv: 0.5 };
    const q = mergeCoincallBsInfo(
      { s: 'X', mp: 3, ts: 1 },
      inst,
      prev,
      emptyQuote(),
    );
    expect(q.bidPrice).toBe(1);
    expect(q.askPrice).toBe(2);
    expect(q.bidSize).toBe(0.2);
    expect(q.askSize).toBe(0.1);
    expect(q.greeks.bidIv).toBe(0.4);
    expect(q.greeks.askIv).toBe(0.5);
    expect(q.markPrice).toBe(3);
  });
});

describe('mergeCoincallTOption', () => {
  it('fills bid/ask/bs/as/biv/aiv from a tOption entry', () => {
    const inst = testInstrument();
    const q = mergeCoincallTOption(
      {
        s: 'BTCUSD-4JUL23-27000-C',
        mp: 4038.58,
        lp: 4038.58,
        bid: 1,
        ask: 0,
        bs: 0.2,
        as: 0,
        biv: 0.01,
        aiv: 0.01,
        delta: 1.0,
        theta: 0.0,
        gamma: 0.0,
        vega: 0.0,
        oi: 1.0,
        v24: 1.0,
        up: 31038.58,
        ts: 1688452774463,
      },
      inst,
      undefined,
      emptyQuote(),
    );
    expect(q.bidPrice).toBe(1);
    expect(q.askPrice).toBe(0);
    expect(q.bidSize).toBe(0.2);
    expect(q.askSize).toBe(0);
    expect(q.greeks.bidIv).toBe(0.01);
    expect(q.greeks.askIv).toBe(0.01);
    expect(q.markPrice).toBe(4038.58);
    expect(q.underlyingPrice).toBe(31038.58);
    expect(q.timestamp).toBe(1688452774463);
    // tOption does not push markIv — stays on the previous value (null here).
    expect(q.greeks.markIv).toBeNull();
  });

  it('preserves markIv across a tOption update', () => {
    const inst = testInstrument();
    const prev = emptyQuote();
    prev.greeks = { ...prev.greeks, markIv: 0.5, delta: 0.5 };
    const q = mergeCoincallTOption(
      { s: 'X', bid: 1, ask: 2, ts: 5 },
      inst,
      prev,
      emptyQuote(),
    );
    expect(q.greeks.markIv).toBe(0.5);
    // delta is overwritten only when the push provides it; here it stays.
    expect(q.greeks.delta).toBe(0.5);
    expect(q.bidPrice).toBe(1);
  });

  it('derives missing side IVs from best bid/ask prices on orderBook fallback', () => {
    const inst = testInstrument();
    const bidSigma = 0.55;
    const askSigma = 0.6;
    const timestamp = Date.parse('2099-06-01T00:00:00.000Z');
    const timeYears = (inst.expirationTimestamp! - timestamp) / (365 * 24 * 60 * 60 * 1000);
    const bid = blackScholesCall(30000, inst.strike, timeYears, bidSigma);
    const ask = blackScholesCall(30000, inst.strike, timeYears, askSigma);

    const prev = emptyQuote();
    prev.underlyingPrice = 30000;
    prev.greeks = { ...prev.greeks, markIv: 0.5 };

    const q = mergeCoincallOrderBook(
      {
        s: inst.exchangeSymbol,
        bids: [{ pr: bid, sz: 1 }],
        asks: [{ pr: ask, sz: 1 }],
        ts: timestamp,
      },
      inst,
      prev,
      emptyQuote(),
    );

    expect(q.bidPrice).toBeCloseTo(bid, 6);
    expect(q.askPrice).toBeCloseTo(ask, 6);
    expect(q.greeks.bidIv).toBeCloseTo(bidSigma, 3);
    expect(q.greeks.askIv).toBeCloseTo(askSigma, 3);
  });
});
