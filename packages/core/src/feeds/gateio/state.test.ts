import { describe, expect, it } from 'vitest';
import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import {
  applyGateioVolume,
  buildGateioInstrument,
  createGateioVolumeWindow,
  gateioPruneVolumeWindow,
  gateioRecordTrade,
  mergeGateioRestTicker,
  mergeGateioTrade,
  mergeGateioUnderlyingTicker,
  mergeGateioWsContractTicker,
} from './state.js';
import { GateioContractSchema, GateioTickerSchema } from './types.js';

const sampleContract = GateioContractSchema.parse({
  name: 'BTC_USDT-20260626-70000-C',
  tag: 'month',
  underlying: 'BTC_USDT',
  is_call: true,
  is_active: true,
  multiplier: '0.01',
  strike_price: '70000',
  expiration_time: 1782460800,
  maker_fee_rate: '0.0003',
  taker_fee_rate: '0.0003',
  order_size_min: 1,
});

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
    greeks: {
      delta: null,
      gamma: null,
      vega: null,
      theta: null,
      rho: null,
      markIv: null,
      bidIv: null,
      askIv: null,
    },
    timestamp: 0,
  };
}

describe('buildGateioInstrument', () => {
  it('maps Gate contract to CachedInstrument', () => {
    const inst = buildGateioInstrument(sampleContract);
    const expected: CachedInstrument = {
      symbol: 'BTC/USD:USDT-260626-70000-C',
      exchangeSymbol: 'BTC_USDT-20260626-70000-C',
      base: 'BTC',
      quote: 'USDT',
      settle: 'USDT',
      expiry: '2026-06-26',
      expirationTimestamp: 1782460800 * 1000,
      strike: 70000,
      right: 'call',
      inverse: false,
      contractSize: 0.01,
      contractValueCurrency: 'BTC',
      tickSize: null,
      minQty: 1,
      makerFee: 0.0003,
      takerFee: 0.0003,
    };
    expect(inst).toMatchObject(expected);
  });

  it('throws on inactive contracts', () => {
    const inactive = { ...sampleContract, is_active: false };
    expect(() => buildGateioInstrument(inactive)).toThrow(/inactive/);
  });
});

describe('mergeGateioRestTicker', () => {
  it('reads bid/ask/mark/index/greeks/IV (fractions, no conversion)', () => {
    const ticker = GateioTickerSchema.parse({
      name: 'BTC_USDT-20260626-70000-C',
      last_price: '2717.04',
      mark_price: '2717.00',
      index_price: '80000.00',
      underlying_price: '80000.00',
      ask1_price: '2741.69',
      ask1_size: 5,
      bid1_price: '2677.10',
      bid1_size: 5,
      position_size: 12,
      mark_iv: '0.7132',
      bid_iv: '0.7000',
      ask_iv: '0.7250',
      delta: '0.334',
      gamma: '0.009',
      vega: '77.01',
      theta: '-26.77',
      rho: '3013.04',
    });
    const out = mergeGateioRestTicker(emptyQuote(), ticker, 1747008000_000);
    expect(out.markPrice).toBe(2717);
    expect(out.bidPrice).toBe(2677.1);
    expect(out.askSize).toBe(5);
    expect(out.underlyingPrice).toBe(80000);
    expect(out.indexPrice).toBe(80000);
    expect(out.openInterest).toBe(12);
    expect(out.greeks.markIv).toBeCloseTo(0.7132, 4);
    expect(out.greeks.delta).toBeCloseTo(0.334, 3);
    expect(out.timestamp).toBe(1747008000_000);
  });

  it('treats empty strings as null', () => {
    const ticker = GateioTickerSchema.parse({
      name: 'BTC_USDT-20260626-70000-C',
      mark_price: '',
      bid_iv: '',
    });
    const out = mergeGateioRestTicker(emptyQuote(), ticker, 0);
    expect(out.markPrice).toBeNull();
    expect(out.greeks.bidIv).toBeNull();
  });
});

describe('mergeGateioWsContractTicker', () => {
  it('overlays incremental updates without clobbering known fields', () => {
    const prev: LiveQuote = { ...emptyQuote(), markPrice: 100, underlyingPrice: 80000 };
    const update = GateioTickerSchema.parse({
      name: 'BTC_USDT-20260626-70000-C',
      ask1_price: '105.00',
      ask1_size: 3,
    });
    const out = mergeGateioWsContractTicker(prev, update, 1);
    expect(out.markPrice).toBe(100);
    expect(out.underlyingPrice).toBe(80000);
    expect(out.askPrice).toBe(105);
    expect(out.askSize).toBe(3);
  });
});

describe('mergeGateioTrade', () => {
  it('takes lastPrice + bumps timestamp', () => {
    const out = mergeGateioTrade(emptyQuote(), { price: '2715.00', timestampMs: 1747000000_000 });
    expect(out.lastPrice).toBe(2715);
    expect(out.timestamp).toBe(1747000000_000);
  });

  it('applies volume24h = contracts × multiplier and volume24hUsd × underlyingPrice', () => {
    const prev: LiveQuote = { ...emptyQuote(), underlyingPrice: 80_000 };
    const out = mergeGateioTrade(
      prev,
      { price: '2715.00', timestampMs: 1747000000_000 },
      { volumeContracts: 150, contractSize: 0.01 },
    );
    expect(out.volume24h).toBeCloseTo(1.5, 8);
    expect(out.volume24hUsd).toBeCloseTo(120_000, 4);
  });

  it('leaves volume24hUsd null when underlyingPrice unknown', () => {
    const out = mergeGateioTrade(
      emptyQuote(),
      { price: '2715.00', timestampMs: 1747000000_000 },
      { volumeContracts: 150, contractSize: 0.01 },
    );
    expect(out.volume24h).toBeCloseTo(1.5, 8);
    expect(out.volume24hUsd).toBeNull();
  });

  it('preserves prior volume when contractSize is null', () => {
    const prev: LiveQuote = { ...emptyQuote(), volume24h: 0.7, volume24hUsd: 56_000 };
    const out = mergeGateioTrade(
      prev,
      { price: '2715.00', timestampMs: 1 },
      { volumeContracts: 100, contractSize: null },
    );
    expect(out.volume24h).toBe(0.7);
    expect(out.volume24hUsd).toBe(56_000);
  });
});

describe('mergeGateioUnderlyingTicker', () => {
  it('updates indexPrice + underlyingPrice', () => {
    const out = mergeGateioUnderlyingTicker(emptyQuote(), '79555.55', 1);
    expect(out.indexPrice).toBe(79555.55);
    expect(out.underlyingPrice).toBe(79555.55);
  });

  it('recomputes volume24hUsd from new indexPrice when volume24h is known', () => {
    const prev: LiveQuote = { ...emptyQuote(), volume24h: 2.5, volume24hUsd: 200_000 };
    const out = mergeGateioUnderlyingTicker(prev, '90000.00', 1);
    expect(out.volume24hUsd).toBeCloseTo(225_000, 4);
  });

  it('leaves volume24hUsd unchanged when volume24h is null', () => {
    const prev: LiveQuote = { ...emptyQuote(), volume24hUsd: 123 };
    const out = mergeGateioUnderlyingTicker(prev, '90000.00', 1);
    expect(out.volume24hUsd).toBe(123);
  });
});

describe('gateio 24h volume window', () => {
  const ONE_DAY = 24 * 60 * 60 * 1000;

  it('starts empty', () => {
    const w = createGateioVolumeWindow();
    expect(w.totalContracts).toBe(0);
    expect(w.trades).toEqual([]);
  });

  it('accumulates sizes while within 24h', () => {
    const w = createGateioVolumeWindow();
    const now = 1747000000_000;
    gateioRecordTrade(w, { tsMs: now - 60_000, size: 10 }, now);
    gateioRecordTrade(w, { tsMs: now - 30_000, size: 25 }, now);
    expect(w.totalContracts).toBe(35);
  });

  it('drops trades older than 24h when a new trade lands', () => {
    const w = createGateioVolumeWindow();
    const now = 1747000000_000;
    gateioRecordTrade(w, { tsMs: now - ONE_DAY - 1_000, size: 100 }, now - ONE_DAY - 1_000);
    gateioRecordTrade(w, { tsMs: now, size: 7 }, now);
    expect(w.totalContracts).toBe(7);
  });

  it('prunes to zero when pruning past the window with no new trade', () => {
    const w = createGateioVolumeWindow();
    const t0 = 1747000000_000;
    gateioRecordTrade(w, { tsMs: t0, size: 42 }, t0);
    expect(w.totalContracts).toBe(42);
    const total = gateioPruneVolumeWindow(w, t0 + ONE_DAY + 1);
    expect(total).toBe(0);
    expect(w.trades).toEqual([]);
  });

  it('ignores zero-size or zero-timestamp trades', () => {
    const w = createGateioVolumeWindow();
    const now = 1747000000_000;
    gateioRecordTrade(w, { tsMs: now, size: 0 }, now);
    gateioRecordTrade(w, { tsMs: 0, size: 5 }, now);
    expect(w.totalContracts).toBe(0);
  });
});

describe('applyGateioVolume', () => {
  it('writes volume24h and volume24hUsd when contractSize + underlyingPrice known', () => {
    const prev: LiveQuote = { ...emptyQuote(), underlyingPrice: 80_000 };
    const out = applyGateioVolume(prev, 150, 0.01);
    expect(out.volume24h).toBeCloseTo(1.5, 8);
    expect(out.volume24hUsd).toBeCloseTo(120_000, 4);
  });

  it('is a no-op when contractSize is null', () => {
    const prev: LiveQuote = { ...emptyQuote(), volume24h: 0.5, volume24hUsd: 40_000 };
    const out = applyGateioVolume(prev, 999, null);
    expect(out).toBe(prev);
  });
});
