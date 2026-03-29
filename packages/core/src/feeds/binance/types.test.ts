/**
 * Binance EAPI feed adapter — doc-driven contract tests
 *
 * Fixtures are copied verbatim from the official Binance documentation:
 *   - rest-exchange-info.md
 *   - ws-mark-price.md
 *
 * Purpose: verify our Zod schemas accept the exact shapes the API returns.
 * A parse failure here means the schema diverges from the documented contract.
 */

import { describe, it, expect } from 'vitest';
import {
  BinanceMarkPriceSchema,
  BinanceCombinedStreamSchema,
  BinanceInstrumentSchema,
} from './types.js';

// ---------------------------------------------------------------------------
// Fixtures — exact JSON from Binance documentation
// ---------------------------------------------------------------------------

/**
 * Source: ws-mark-price.md — single item from the bulk optionMarkPrice stream.
 * All numeric values (mark price, index price, greeks) are transmitted as
 * STRINGS over the wire, not JavaScript numbers.
 */
const WS_MARK_PRICE_ITEM_DOC_FIXTURE = {
  e: 'markPrice',
  E: 1762867543321,
  s: 'BTC-251120-126000-C',
  mp: '770.543',
  i: '104334.60217391',
  P: '0.000',
  bo: '0.000',
  ao: '900.000',
  bq: '0.0000',
  aq: '0.2000',
  b: '-1.0',
  a: '0.98161161',
  hl: '924.652',
  ll: '616.435',
  vo: '0.9408058',
  rf: '0.0',
  d: '0.11111964',
  t: '-164.26702615',
  g: '0.00001245',
  v: '30.63855919',
} as const;

/**
 * Source: ws-mark-price.md — the stream delivers an ARRAY of mark price items
 * wrapped in the combined stream envelope.
 */
const WS_COMBINED_STREAM_DOC_FIXTURE = {
  stream: 'btcusdt@optionMarkPrice',
  data: [WS_MARK_PRICE_ITEM_DOC_FIXTURE],
} as const;

/**
 * Source: rest-exchange-info.md — single option symbol from optionSymbols[].
 * The REST endpoint returns a full exchange info object; our schema covers
 * the individual optionSymbols item.
 */
const REST_INSTRUMENT_DOC_FIXTURE = {
  symbol: 'BTC-220815-50000-C',
  side: 'CALL',
  strikePrice: '50000',
  underlying: 'BTCUSDT',
  unit: 1,
  expiryDate: 1660521600000,
  quoteAsset: 'USDT',
  status: 'TRADING',
  minQty: '0.01',
  maxQty: '100',
  priceScale: 2,
  quantityScale: 2,
  initialMargin: '0.15',
  maintenanceMargin: '0.075',
  filters: [
    { filterType: 'PRICE_FILTER', minPrice: '0.02', maxPrice: '80000.01', tickSize: '0.01' },
    { filterType: 'LOT_SIZE', minQty: '0.01', maxQty: '100', stepSize: '0.01' },
  ],
} as const;

// ---------------------------------------------------------------------------
// BinanceMarkPriceSchema
// ---------------------------------------------------------------------------

describe('BinanceMarkPriceSchema', () => {
  it('parses the documented optionMarkPrice WS item verbatim', () => {
    // Arrange
    const input = WS_MARK_PRICE_ITEM_DOC_FIXTURE;

    // Act
    const result = BinanceMarkPriceSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.e).toBe('markPrice');
      expect(result.data.s).toBe('BTC-251120-126000-C');
      expect(result.data.mp).toBe('770.543');
    }
  });

  it('confirms mark price mp is a string, not a number', () => {
    // Arrange — the docs unambiguously show mp as a quoted string
    const input = WS_MARK_PRICE_ITEM_DOC_FIXTURE;

    // Act
    const result = BinanceMarkPriceSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.mp).toBe('string');
    }
  });

  it('confirms event time E is a number as the docs show', () => {
    // Arrange — E is 1762867543321, an unquoted integer in the docs
    const input = WS_MARK_PRICE_ITEM_DOC_FIXTURE;

    // Act
    const result = BinanceMarkPriceSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.E).toBe('number');
      expect(result.data.E).toBe(1762867543321);
    }
  });

  it('parses all optional greek fields present in the documented fixture', () => {
    // Arrange
    const input = WS_MARK_PRICE_ITEM_DOC_FIXTURE;

    // Act
    const result = BinanceMarkPriceSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.d).toBe('0.11111964'); // delta
      expect(result.data.g).toBe('0.00001245'); // gamma
      expect(result.data.t).toBe('-164.26702615'); // theta
      expect(result.data.v).toBe('30.63855919'); // vega
      expect(result.data.vo).toBe('0.9408058'); // mark IV
      expect(result.data.b).toBe('-1.0'); // bid IV (-1 = no bid)
      expect(result.data.a).toBe('0.98161161'); // ask IV
    }
  });

  it('discriminates on e: "markPrice" literal — rejects a different event type', () => {
    // Arrange — change the event type to something other than markPrice
    const input = { ...WS_MARK_PRICE_ITEM_DOC_FIXTURE, e: 'trade' };

    // Act
    const result = BinanceMarkPriceSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects an item where mp is a number instead of the documented string', () => {
    // Arrange — Binance sends all price fields as quoted strings
    const input = { ...WS_MARK_PRICE_ITEM_DOC_FIXTURE, mp: 770.543 };

    // Act
    const result = BinanceMarkPriceSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects an item missing the required symbol field s', () => {
    // Arrange
    const { s: _removed, ...withoutSymbol } = WS_MARK_PRICE_ITEM_DOC_FIXTURE;

    // Act
    const result = BinanceMarkPriceSchema.safeParse(withoutSymbol);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects an item missing the required mark price field mp', () => {
    // Arrange
    const { mp: _removed, ...withoutMp } = WS_MARK_PRICE_ITEM_DOC_FIXTURE;

    // Act
    const result = BinanceMarkPriceSchema.safeParse(withoutMp);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    expect(BinanceMarkPriceSchema.safeParse(null).success).toBe(false);
  });

  it('accepts the documented bid IV value of "-1.0" indicating no active bid', () => {
    // Arrange — docs note: b = "-1" means no bid
    const input = { ...WS_MARK_PRICE_ITEM_DOC_FIXTURE, b: '-1.0' };

    // Act
    const result = BinanceMarkPriceSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.b).toBe('-1.0');
    }
  });
});

// ---------------------------------------------------------------------------
// BinanceCombinedStreamSchema
// ---------------------------------------------------------------------------

describe('BinanceCombinedStreamSchema', () => {
  it('parses the documented combined stream envelope verbatim', () => {
    // Arrange
    const input = WS_COMBINED_STREAM_DOC_FIXTURE;

    // Act
    const result = BinanceCombinedStreamSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stream).toBe('btcusdt@optionMarkPrice');
      expect(result.data.data).toHaveLength(1);
    }
  });

  it('accepts an empty data array as a valid envelope shape', () => {
    // Arrange — an update with no items is structurally valid
    const input = { stream: 'btcusdt@optionMarkPrice', data: [] };

    // Act
    const result = BinanceCombinedStreamSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it('accepts multiple mark price items in a single stream envelope', () => {
    // Arrange — stream delivers an array; multiple items are expected
    const input = {
      stream: 'btcusdt@optionMarkPrice',
      data: [WS_MARK_PRICE_ITEM_DOC_FIXTURE, WS_MARK_PRICE_ITEM_DOC_FIXTURE],
    };

    // Act
    const result = BinanceCombinedStreamSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toHaveLength(2);
    }
  });

  it('rejects an envelope missing the stream name', () => {
    // Arrange
    const input = { data: [WS_MARK_PRICE_ITEM_DOC_FIXTURE] };

    // Act
    const result = BinanceCombinedStreamSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects an envelope where data is not an array', () => {
    // Arrange — data must be an array per the documented structure
    const input = { stream: 'btcusdt@optionMarkPrice', data: WS_MARK_PRICE_ITEM_DOC_FIXTURE };

    // Act
    const result = BinanceCombinedStreamSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    expect(BinanceCombinedStreamSchema.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BinanceInstrumentSchema
// ---------------------------------------------------------------------------

describe('BinanceInstrumentSchema', () => {
  it('parses the documented optionSymbols item verbatim', () => {
    // Arrange
    const input = REST_INSTRUMENT_DOC_FIXTURE;

    // Act
    const result = BinanceInstrumentSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.symbol).toBe('BTC-220815-50000-C');
      expect(result.data.quoteAsset).toBe('USDT');
      expect(result.data.unit).toBe(1);
    }
  });

  it('confirms unit is a number as the docs show (not a string)', () => {
    // Arrange — docs show unit: 1 (unquoted integer)
    const input = REST_INSTRUMENT_DOC_FIXTURE;

    // Act
    const result = BinanceInstrumentSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.unit).toBe('number');
    }
  });

  it('parses a minimal instrument with only the required symbol field', () => {
    // Arrange — only symbol is required; quoteAsset and unit are optional
    const input = { symbol: 'BTC-220815-50000-C' };

    // Act
    const result = BinanceInstrumentSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects an instrument missing the required symbol field', () => {
    // Arrange
    const { symbol: _removed, ...withoutSymbol } = REST_INSTRUMENT_DOC_FIXTURE;

    // Act
    const result = BinanceInstrumentSchema.safeParse(withoutSymbol);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects an instrument where unit is a string instead of the documented number', () => {
    // Arrange — unit: 1 is a number in the docs, not "1"
    const input = { ...REST_INSTRUMENT_DOC_FIXTURE, unit: '1' };

    // Act
    const result = BinanceInstrumentSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    expect(BinanceInstrumentSchema.safeParse(null).success).toBe(false);
  });
});
