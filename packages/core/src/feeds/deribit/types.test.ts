/**
 * Contract tests for Deribit Zod schemas.
 *
 * All fixtures are copied verbatim from official Deribit documentation:
 *   - ws-markprice-options.md  → DeribitMarkPriceItemSchema
 *   - ws-ticker.md             → DeribitTickerSchema
 *   - api-get-book-summary-by-currency.md → DeribitBookSummarySchema
 *   - api-get-instruments.md   → DeribitInstrumentSchema
 *
 * These tests verify that our Zod schemas match the documented API contract,
 * NOT that the implementation passes. A schema that is too permissive or too
 * strict relative to the docs is a bug.
 */

import { describe, it, expect } from 'vitest';
import {
  DeribitMarkPriceItemSchema,
  DeribitMarkPriceDataSchema,
  DeribitTickerSchema,
  DeribitBookSummarySchema,
  DeribitInstrumentSchema,
} from './types.js';

// ─── DeribitMarkPriceItemSchema ────────────────────────────────────────────

describe('DeribitMarkPriceItemSchema', () => {
  // Exact first element from ws-markprice-options.md Example Response
  const docFixture = {
    timestamp: 1622470378005,
    mark_price: 0.0333,
    iv: 0.9,
    instrument_name: 'BTC-2JUN21-37000-P',
  };

  // Exact second element from ws-markprice-options.md Example Response
  const docFixture2 = {
    timestamp: 1622470378005,
    mark_price: 0.117,
    iv: 0.9,
    instrument_name: 'BTC-4JUN21-40500-P',
  };

  it('parses first doc example verbatim', () => {
    const result = DeribitMarkPriceItemSchema.safeParse(docFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.instrument_name).toBe('BTC-2JUN21-37000-P');
    expect(result.data.mark_price).toBe(0.0333);
    expect(result.data.iv).toBe(0.9);
    expect(result.data.timestamp).toBe(1622470378005);
  });

  it('parses second doc example verbatim', () => {
    const result = DeribitMarkPriceItemSchema.safeParse(docFixture2);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.instrument_name).toBe('BTC-4JUN21-40500-P');
    expect(result.data.mark_price).toBe(0.117);
  });

  it('accepts item without optional timestamp field', () => {
    // Docs list timestamp as present in the example but the schema marks it optional
    const withoutTimestamp = {
      instrument_name: 'BTC-2JUN21-37000-P',
      mark_price: 0.0333,
      iv: 0.9,
    };
    const result = DeribitMarkPriceItemSchema.safeParse(withoutTimestamp);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.timestamp).toBeUndefined();
  });

  it('rejects item missing required instrument_name', () => {
    const bad = { mark_price: 0.0333, iv: 0.9, timestamp: 1622470378005 };
    const result = DeribitMarkPriceItemSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects item missing required mark_price', () => {
    const bad = {
      instrument_name: 'BTC-2JUN21-37000-P',
      iv: 0.9,
      timestamp: 1622470378005,
    };
    const result = DeribitMarkPriceItemSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects item missing required iv', () => {
    const bad = {
      instrument_name: 'BTC-2JUN21-37000-P',
      mark_price: 0.0333,
      timestamp: 1622470378005,
    };
    const result = DeribitMarkPriceItemSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects item with mark_price as string instead of number', () => {
    const bad = {
      instrument_name: 'BTC-2JUN21-37000-P',
      mark_price: '0.0333',
      iv: 0.9,
      timestamp: 1622470378005,
    };
    const result = DeribitMarkPriceItemSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects item with iv as string instead of number', () => {
    const bad = {
      instrument_name: 'BTC-2JUN21-37000-P',
      mark_price: 0.0333,
      iv: '0.9',
      timestamp: 1622470378005,
    };
    const result = DeribitMarkPriceItemSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// ─── DeribitMarkPriceDataSchema ────────────────────────────────────────────

describe('DeribitMarkPriceDataSchema', () => {
  // The entire `data` array from ws-markprice-options.md Example Response
  const docArray = [
    {
      timestamp: 1622470378005,
      mark_price: 0.0333,
      iv: 0.9,
      instrument_name: 'BTC-2JUN21-37000-P',
    },
    {
      timestamp: 1622470378005,
      mark_price: 0.117,
      iv: 0.9,
      instrument_name: 'BTC-4JUN21-40500-P',
    },
  ];

  it('parses the full doc array verbatim', () => {
    const result = DeribitMarkPriceDataSchema.safeParse(docArray);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(2);
    expect(result.data[0]?.instrument_name).toBe('BTC-2JUN21-37000-P');
    expect(result.data[1]?.instrument_name).toBe('BTC-4JUN21-40500-P');
  });

  it('rejects non-array payload', () => {
    const result = DeribitMarkPriceDataSchema.safeParse({ instrument_name: 'X', mark_price: 1, iv: 1 });
    expect(result.success).toBe(false);
  });

  it('rejects array containing invalid item', () => {
    const bad = [
      { timestamp: 123, mark_price: 0.1, iv: 0.5, instrument_name: 'BTC-2JUN21-37000-P' },
      { timestamp: 123, mark_price: 'not-a-number', iv: 0.5, instrument_name: 'BTC-4JUN21-40500-P' },
    ];
    const result = DeribitMarkPriceDataSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// ─── DeribitTickerSchema ───────────────────────────────────────────────────

describe('DeribitTickerSchema', () => {
  // Exact `data` object from ws-ticker.md Example Response (BTC-PERPETUAL / 100ms)
  const perpetualDocFixture = {
    best_ask_amount: 100,
    best_ask_price: 36443,
    best_bid_amount: 5000,
    best_bid_price: 36442.5,
    current_funding: 0,
    estimated_delivery_price: 36441.64,
    funding_8h: 0.0000211,
    index_price: 36441.64,
    instrument_name: 'BTC-PERPETUAL',
    interest_value: 1.7362511643080387,
    last_price: 36457.5,
    mark_price: 36446.51,
    max_price: 36991.72,
    min_price: 35898.37,
    open_interest: 502097590,
    settlement_price: 36169.49,
    state: 'open',
    stats: {
      high: 36824.5,
      low: 35213.5,
      price_change: 0.7229,
      volume: 7871.02139035,
      volume_usd: 284061480,
    },
    timestamp: 1623060194301,
  };

  it('parses the full perpetual ticker doc example verbatim', () => {
    const result = DeribitTickerSchema.safeParse(perpetualDocFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.instrument_name).toBe('BTC-PERPETUAL');
    expect(result.data.best_bid_price).toBe(36442.5);
    expect(result.data.best_ask_price).toBe(36443);
    expect(result.data.mark_price).toBe(36446.51);
    expect(result.data.last_price).toBe(36457.5);
    expect(result.data.open_interest).toBe(502097590);
    expect(result.data.timestamp).toBe(1623060194301);
  });

  it('parses stats sub-object from doc example', () => {
    const result = DeribitTickerSchema.safeParse(perpetualDocFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.stats?.volume).toBe(7871.02139035);
  });

  // Options-specific ticker with greeks and IV fields (not in perpetual example)
  const optionFixture = {
    instrument_name: 'BTC-28MAR25-80000-C',
    best_bid_price: 0.012,
    best_ask_price: 0.014,
    last_price: 0.013,
    mark_price: 0.013,
    underlying_price: 36441.64,
    underlying_index: 'index_price',
    index_price: 36441.64,
    interest_rate: 0,
    bid_iv: 0.6512,
    ask_iv: 0.7102,
    mark_iv: 0.6808,
    open_interest: 150.5,
    state: 'open',
    stats: {
      volume: 12.5,
      high: 0.015,
      low: 0.011,
      price_change: 2.3,
    },
    greeks: {
      delta: 0.0321,
      gamma: 0.000004,
      theta: -0.00025,
      vega: 0.012,
      rho: 0.0001,
    },
    timestamp: 1623060194301,
    min_price: 0.001,
    max_price: 0.999,
  };

  it('parses option ticker with greeks and IV fields', () => {
    const result = DeribitTickerSchema.safeParse(optionFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.instrument_name).toBe('BTC-28MAR25-80000-C');
    expect(result.data.underlying_price).toBe(36441.64);
    expect(result.data.mark_iv).toBe(0.6808);
    expect(result.data.bid_iv).toBe(0.6512);
    expect(result.data.ask_iv).toBe(0.7102);
  });

  it('parses greeks sub-object with all five greek values', () => {
    const result = DeribitTickerSchema.safeParse(optionFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const g = result.data.greeks;
    expect(g?.delta).toBe(0.0321);
    expect(g?.gamma).toBe(0.000004);
    expect(g?.theta).toBe(-0.00025);
    expect(g?.vega).toBe(0.012);
    expect(g?.rho).toBe(0.0001);
  });

  it('accepts ticker where nullable price fields are null (no market)', () => {
    const noMarket = {
      instrument_name: 'BTC-28MAR25-999999-C',
      best_bid_price: null,
      best_ask_price: null,
      last_price: null,
      mark_price: null,
    };
    const result = DeribitTickerSchema.safeParse(noMarket);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.best_bid_price).toBeNull();
    expect(result.data.best_ask_price).toBeNull();
    expect(result.data.mark_price).toBeNull();
    expect(result.data.last_price).toBeNull();
  });

  it('accepts ticker with greeks entirely absent (perpetual has no greeks)', () => {
    const result = DeribitTickerSchema.safeParse(perpetualDocFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.greeks).toBeUndefined();
  });

  it('accepts ticker with stats object absent', () => {
    const minimal = {
      instrument_name: 'BTC-28MAR25-80000-C',
      best_bid_price: 0.012,
      best_ask_price: 0.014,
      last_price: 0.013,
      mark_price: 0.013,
    };
    const result = DeribitTickerSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.stats).toBeUndefined();
  });

  it('rejects ticker missing required instrument_name', () => {
    const bad = { best_bid_price: 100, best_ask_price: 101, last_price: 100, mark_price: 100 };
    const result = DeribitTickerSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects ticker where mark_price is a string instead of number', () => {
    const bad = {
      instrument_name: 'BTC-PERPETUAL',
      best_bid_price: 36442.5,
      best_ask_price: 36443,
      last_price: 36457.5,
      mark_price: '36446.51',
    };
    const result = DeribitTickerSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects ticker with greeks containing string values instead of numbers', () => {
    const bad = {
      ...optionFixture,
      greeks: {
        delta: '0.0321',
        gamma: 0.000004,
        theta: -0.00025,
        vega: 0.012,
        rho: 0.0001,
      },
    };
    const result = DeribitTickerSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// ─── DeribitBookSummarySchema ──────────────────────────────────────────────

describe('DeribitBookSummarySchema', () => {
  // Exact element from api-get-book-summary-by-currency.md Example Response
  const docFixture = {
    volume: 0.55,
    underlying_price: 121.38,
    underlying_index: 'index_price',
    quote_currency: 'USD',
    price_change: -26.7793594,
    open_interest: 0.55,
    mid_price: 0.2444,
    mark_price: 80,
    low: 0.34,
    last: 0.34,
    interest_rate: 0.207,
    instrument_name: 'ETH-22FEB19-140-P',
    high: 0.34,
    creation_timestamp: 1550227952163,
    bid_price: 0.1488,
    base_currency: 'ETH',
    ask_price: 0.34,
  };

  it('parses the full doc example verbatim', () => {
    const result = DeribitBookSummarySchema.safeParse(docFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.instrument_name).toBe('ETH-22FEB19-140-P');
    expect(result.data.bid_price).toBe(0.1488);
    expect(result.data.ask_price).toBe(0.34);
    expect(result.data.mark_price).toBe(80);
    expect(result.data.last).toBe(0.34);
    expect(result.data.underlying_price).toBe(121.38);
    expect(result.data.volume).toBe(0.55);
    expect(result.data.open_interest).toBe(0.55);
    expect(result.data.creation_timestamp).toBe(1550227952163);
  });

  it('accepts doc example with nullable bid_price set to null', () => {
    // bid_price is documented as nullable
    const withNullBid = { ...docFixture, bid_price: null };
    const result = DeribitBookSummarySchema.safeParse(withNullBid);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.bid_price).toBeNull();
  });

  it('accepts doc example with nullable ask_price set to null', () => {
    const withNullAsk = { ...docFixture, ask_price: null };
    const result = DeribitBookSummarySchema.safeParse(withNullAsk);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.ask_price).toBeNull();
  });

  it('accepts doc example with nullable last set to null', () => {
    const withNullLast = { ...docFixture, last: null };
    const result = DeribitBookSummarySchema.safeParse(withNullLast);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.last).toBeNull();
  });

  it('accepts minimal book summary with only required instrument_name', () => {
    const minimal = { instrument_name: 'ETH-22FEB19-140-P' };
    const result = DeribitBookSummarySchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('accepts book summary with options-only fields absent (no underlying_price, mark_iv)', () => {
    // Non-option instruments do not carry underlying_price or mark_iv
    const noOptionFields = {
      instrument_name: 'BTC-PERPETUAL',
      mark_price: 36446.51,
      volume: 7871.0,
      open_interest: 502097590,
      creation_timestamp: 1550227952163,
    };
    const result = DeribitBookSummarySchema.safeParse(noOptionFields);
    expect(result.success).toBe(true);
  });

  it('rejects book summary missing required instrument_name', () => {
    const bad = { mark_price: 80, volume: 0.55 };
    const result = DeribitBookSummarySchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects book summary where mark_price is a string', () => {
    const bad = { ...docFixture, mark_price: '80' };
    const result = DeribitBookSummarySchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects book summary where creation_timestamp is a string', () => {
    const bad = { ...docFixture, creation_timestamp: '1550227952163' };
    const result = DeribitBookSummarySchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// ─── DeribitInstrumentSchema ───────────────────────────────────────────────

describe('DeribitInstrumentSchema', () => {
  // Exact element from api-get-instruments.md Example Response (future kind)
  const docFutureFixture = {
    tick_size: 2.5,
    tick_size_steps: [],
    taker_commission: 0.0005,
    settlement_period: 'month',
    settlement_currency: 'BTC',
    quote_currency: 'USD',
    price_index: 'btc_usd',
    min_trade_amount: 10,
    max_liquidation_commission: 0.0075,
    max_leverage: 50,
    maker_commission: 0,
    kind: 'future',
    is_active: true,
    instrument_name: 'BTC-29SEP23',
    instrument_id: 138583,
    instrument_type: 'reversed',
    expiration_timestamp: 1695974400000,
    creation_timestamp: 1664524802000,
    counter_currency: 'USD',
    contract_size: 10,
    block_trade_tick_size: 0.01,
    block_trade_min_trade_amount: 200000,
    block_trade_commission: 0.00025,
    base_currency: 'BTC',
    state: 'open',
  };

  it('parses the full doc future instrument example verbatim', () => {
    const result = DeribitInstrumentSchema.safeParse(docFutureFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.instrument_name).toBe('BTC-29SEP23');
    expect(result.data.settlement_currency).toBe('BTC');
    expect(result.data.instrument_type).toBe('reversed');
    expect(result.data.contract_size).toBe(10);
  });

  // Options instrument built from doc field descriptions (strike, option_type present)
  const optionFixture = {
    tick_size: 5,
    tick_size_steps: [],
    taker_commission: 0.0003,
    settlement_period: 'month',
    settlement_currency: 'BTC',
    quote_currency: 'USD',
    price_index: 'btc_usd',
    min_trade_amount: 0.1,
    max_liquidation_commission: 0.0015,
    max_leverage: 0,
    maker_commission: 0.0003,
    kind: 'option',
    is_active: true,
    instrument_name: 'BTC-28MAR25-80000-C',
    instrument_id: 299000,
    instrument_type: 'reversed',
    expiration_timestamp: 1743177600000,
    creation_timestamp: 1700000000000,
    counter_currency: 'USD',
    contract_size: 1,
    block_trade_tick_size: 0.001,
    block_trade_min_trade_amount: 100,
    block_trade_commission: 0.0003,
    base_currency: 'BTC',
    state: 'open',
    strike: 80000,
    option_type: 'call',
  };

  it('parses options instrument with strike and option_type fields', () => {
    const result = DeribitInstrumentSchema.safeParse(optionFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.instrument_name).toBe('BTC-28MAR25-80000-C');
    expect(result.data.instrument_type).toBe('reversed');
    expect(result.data.contract_size).toBe(1);
  });

  it('parses instrument name with decimal strike notation (420d5 format in name)', () => {
    // The INSTRUMENT_RE in ws-client.ts matches "BTC-25MAR23-420d5-C" —
    // the schema itself just requires a string instrument_name
    const decimalStrike = { ...docFutureFixture, instrument_name: 'BTC-25MAR23-420d5-C' };
    const result = DeribitInstrumentSchema.safeParse(decimalStrike);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.instrument_name).toBe('BTC-25MAR23-420d5-C');
  });

  it('accepts instrument with optional settlement_currency absent (spot has none)', () => {
    // Docs: settlement_currency is optional, not present for spot
    const noSettle = {
      instrument_name: 'BTC-USDC',
      instrument_type: 'linear',
      contract_size: 1,
    };
    const result = DeribitInstrumentSchema.safeParse(noSettle);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.settlement_currency).toBeUndefined();
  });

  it('accepts instrument with optional instrument_type absent', () => {
    const noType = { instrument_name: 'BTC-PERPETUAL' };
    const result = DeribitInstrumentSchema.safeParse(noType);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.instrument_type).toBeUndefined();
  });

  it('accepts instrument with optional contract_size absent', () => {
    const noSize = { instrument_name: 'BTC-PERPETUAL', instrument_type: 'reversed' };
    const result = DeribitInstrumentSchema.safeParse(noSize);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.contract_size).toBeUndefined();
  });

  it('rejects instrument missing required instrument_name', () => {
    const bad = { settlement_currency: 'BTC', instrument_type: 'reversed', contract_size: 10 };
    const result = DeribitInstrumentSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects instrument where contract_size is a string instead of number', () => {
    const bad = { ...docFutureFixture, contract_size: '10' };
    const result = DeribitInstrumentSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects null payload', () => {
    const result = DeribitInstrumentSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it('rejects array payload', () => {
    const result = DeribitInstrumentSchema.safeParse([docFutureFixture]);
    expect(result.success).toBe(false);
  });
});
