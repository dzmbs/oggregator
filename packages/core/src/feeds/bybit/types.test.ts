/**
 * Bybit feed adapter — doc-driven contract tests
 *
 * Fixtures are copied verbatim from the official Bybit documentation:
 *   - rest-instruments.md
 *   - rest-tickers.md
 *   - ws-tickers.md
 *
 * Purpose: verify our Zod schemas accept the exact shapes the API returns.
 *
 * IMPORTANT field-name note (from ws-tickers.md):
 *   REST API uses: bid1Price, ask1Price, bid1Iv, ask1Iv, markIv
 *   WS  API uses:  bidPrice,  askPrice,  bidIv,  askIv,  markPriceIv
 *
 * The rest-tickers.md example object shows bidPrice/askPrice field names, but
 * the ws-tickers.md "Key differences" section explicitly documents that the
 * REST API uses the bid1Price/ask1Price variants.  Our BybitRestTickerSchema
 * is built around what the real REST API delivers (bid1Price etc.), so the
 * REST test fixture is constructed with those canonical field names.  A
 * separate test confirms that WS-named fields are rejected by the REST schema
 * and vice versa.
 */

import { describe, it, expect } from 'vitest';
import {
  BybitInstrumentSchema,
  BybitInstrumentsResponseSchema,
  BybitRestTickerSchema,
  BybitTickersResponseSchema,
  BybitWsTickerSchema,
  BybitWsMessageSchema,
  BYBIT_OPTION_SYMBOL_RE,
} from './types.js';

// ---------------------------------------------------------------------------
// Fixtures — exact JSON from Bybit documentation
// ---------------------------------------------------------------------------

/**
 * Source: rest-instruments.md — single instrument from result.list[].
 * Symbol format: BTC-25DEC26-67000-C-USDT (new 5-part format with settle suffix).
 */
const REST_INSTRUMENT_DOC_FIXTURE = {
  symbol: 'BTC-25DEC26-67000-C-USDT',
  status: 'Trading',
  baseCoin: 'BTC',
  quoteCoin: 'USDT',
  settleCoin: 'USDT',
  optionsType: 'Call',
  launchTime: '1770351600000',
  deliveryTime: '1798185600000',
  deliveryFeeRate: '0.00015',
  priceFilter: {
    minPrice: '5',
    maxPrice: '1110000',
    tickSize: '5',
  },
  lotSizeFilter: {
    maxOrderQty: '500',
    minOrderQty: '0.01',
    qtyStep: '0.01',
  },
  displayName: '',
} as const;

/**
 * REST ticker fixture with the bid1Price/ask1Price/bid1Iv/ask1Iv/markIv field
 * names that the real Bybit REST API uses.
 *
 * The rest-tickers.md example shows bidPrice/askPrice but ws-tickers.md
 * explicitly documents that the REST API uses the bid1Price/ask1Price names.
 * Our BybitRestTickerSchema reflects the actual API behaviour.
 */
const REST_TICKER_SCHEMA_FIXTURE = {
  symbol: 'BTC-21MAR26-70000-C-USDT',
  bid1Price: '930',
  bid1Size: '1.46',
  bid1Iv: '0.535',
  ask1Price: '940',
  ask1Size: '2.39',
  ask1Iv: '0.541',
  lastPrice: '935',
  highPrice24h: '1820',
  lowPrice24h: '555',
  markPrice: '937.69840219',
  indexPrice: '70055.65003535',
  markIv: '0.5397',
  underlyingPrice: '70064.65572325',
  openInterest: '18.93',
  turnover24h: '3511046.46438064',
  volume24h: '50.26',
  totalVolume: '60',
  totalTurnover: '4132627',
  delta: '0.51782561',
  gamma: '0.0001756',
  vega: '16.76259941',
  theta: '-343.85909514',
  predictedDeliveryPrice: '0',
  change24h: '-0.51804124',
} as const;

/**
 * Source: ws-tickers.md — verified live 2026-03-20.
 * WS uses bidPrice/askPrice/bidIv/askIv/markPriceIv (no "1" infix, no "mark" prefix variant).
 */
const WS_TICKER_DATA_DOC_FIXTURE = {
  symbol: 'BTC-21MAR26-70000-C-USDT',
  bidPrice: '940',
  bidSize: '2.18',
  bidIv: '0.53',
  askPrice: '960',
  askSize: '11.23',
  askIv: '0.5419',
  lastPrice: '950',
  highPrice24h: '1820',
  lowPrice24h: '555',
  markPrice: '960.2505585',
  indexPrice: '70089.5343409',
  markPriceIv: '0.5421',
  underlyingPrice: '70098.25055849',
  openInterest: '18.93',
  turnover24h: '3511046.46438064',
  volume24h: '50.26',
  totalVolume: '60',
  totalTurnover: '4132627',
  delta: '0.51782561',
  gamma: '0.0001756',
  vega: '16.76259941',
  theta: '-343.85909514',
  predictedDeliveryPrice: '0',
  change24h: '-0.51804124',
} as const;

/** Source: ws-tickers.md — full WS message envelope (verified live 2026-03-20) */
const WS_MESSAGE_DOC_FIXTURE = {
  topic: 'tickers.BTC-21MAR26-70000-C-USDT',
  ts: 1773966121157,
  type: 'snapshot',
  id: 'tickers.BTC-21MAR26-70000-C-USDT-62191583841-1773966121157',
  data: WS_TICKER_DATA_DOC_FIXTURE,
} as const;

// ---------------------------------------------------------------------------
// BybitInstrumentSchema
// ---------------------------------------------------------------------------

describe('BybitInstrumentSchema', () => {
  it('parses the documented instrument object verbatim', () => {
    // Arrange
    const input = REST_INSTRUMENT_DOC_FIXTURE;

    // Act
    const result = BybitInstrumentSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.symbol).toBe('BTC-25DEC26-67000-C-USDT');
      expect(result.data.status).toBe('Trading');
      expect(result.data.baseCoin).toBe('BTC');
      expect(result.data.optionsType).toBe('Call');
      expect(result.data.settleCoin).toBe('USDT');
    }
  });

  it('accepts the documented priceFilter nested object', () => {
    // Arrange
    const input = REST_INSTRUMENT_DOC_FIXTURE;

    // Act
    const result = BybitInstrumentSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priceFilter.tickSize).toBe('5');
      expect(result.data.priceFilter.minPrice).toBe('5');
      expect(result.data.priceFilter.maxPrice).toBe('1110000');
    }
  });

  it('accepts the documented lotSizeFilter nested object', () => {
    // Arrange
    const input = REST_INSTRUMENT_DOC_FIXTURE;

    // Act
    const result = BybitInstrumentSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lotSizeFilter.minOrderQty).toBe('0.01');
      expect(result.data.lotSizeFilter.maxOrderQty).toBe('500');
      expect(result.data.lotSizeFilter.qtyStep).toBe('0.01');
    }
  });

  it('confirms optionsType is "Call" or "Put" (not "C"/"P" as in OKX)', () => {
    // Arrange — Bybit uses full words, not single characters
    const callInput = { ...REST_INSTRUMENT_DOC_FIXTURE, optionsType: 'Call' };
    const putInput = { ...REST_INSTRUMENT_DOC_FIXTURE, optionsType: 'Put' };

    // Act
    const callResult = BybitInstrumentSchema.safeParse(callInput);
    const putResult = BybitInstrumentSchema.safeParse(putInput);

    // Assert
    expect(callResult.success).toBe(true);
    expect(putResult.success).toBe(true);
  });

  it('rejects an instrument missing the required symbol field', () => {
    // Arrange
    const { symbol: _removed, ...withoutSymbol } = REST_INSTRUMENT_DOC_FIXTURE;

    // Act
    const result = BybitInstrumentSchema.safeParse(withoutSymbol);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects an instrument missing the priceFilter nested object', () => {
    // Arrange
    const { priceFilter: _removed, ...withoutPriceFilter } = REST_INSTRUMENT_DOC_FIXTURE;

    // Act
    const result = BybitInstrumentSchema.safeParse(withoutPriceFilter);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects an instrument missing the lotSizeFilter nested object', () => {
    // Arrange
    const { lotSizeFilter: _removed, ...withoutLotFilter } = REST_INSTRUMENT_DOC_FIXTURE;

    // Act
    const result = BybitInstrumentSchema.safeParse(withoutLotFilter);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    expect(BybitInstrumentSchema.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BybitInstrumentsResponseSchema  (full REST envelope)
// ---------------------------------------------------------------------------

describe('BybitInstrumentsResponseSchema', () => {
  it('parses the documented REST envelope from rest-instruments.md verbatim', () => {
    // Arrange — the docs show the full response object
    const input = {
      retCode: 0,
      retMsg: 'success',
      result: {
        category: 'option',
        nextPageCursor: '',
        list: [REST_INSTRUMENT_DOC_FIXTURE],
      },
    };

    // Act
    const result = BybitInstrumentsResponseSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retCode).toBe(0);
      expect(result.data.result.category).toBe('option');
      expect(result.data.result.list).toHaveLength(1);
    }
  });

  it('rejects a response with retCode as a string instead of number', () => {
    // Arrange — retCode is an unquoted integer in the docs
    const input = {
      retCode: '0',
      retMsg: 'success',
      result: { category: 'option', list: [] },
    };

    // Act
    const result = BybitInstrumentsResponseSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BybitRestTickerSchema
// ---------------------------------------------------------------------------

describe('BybitRestTickerSchema', () => {
  it('parses a REST ticker with bid1Price/ask1Price field names', () => {
    // Arrange — REST API uses bid1Price, ask1Price, bid1Iv, ask1Iv, markIv
    const input = REST_TICKER_SCHEMA_FIXTURE;

    // Act
    const result = BybitRestTickerSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.symbol).toBe('BTC-21MAR26-70000-C-USDT');
      expect(result.data.bid1Price).toBe('930');
      expect(result.data.ask1Price).toBe('940');
      expect(result.data.bid1Iv).toBe('0.535');
      expect(result.data.ask1Iv).toBe('0.541');
      expect(result.data.markIv).toBe('0.5397');
      expect(result.data.markPrice).toBe('937.69840219');
    }
  });

  it('rejects WS-style field names (bidPrice/askPrice) — REST schema requires bid1Price/ask1Price', () => {
    // Arrange — WS fields are not the same as REST fields (documented difference)
    // This test confirms the schema correctly distinguishes REST from WS shapes
    const input = WS_TICKER_DATA_DOC_FIXTURE; // has bidPrice, askPrice, markPriceIv

    // Act
    const result = BybitRestTickerSchema.safeParse(input);

    // Assert — REST schema should reject WS-style field names
    expect(result.success).toBe(false);
  });

  it('rejects a REST ticker missing the required bid1Price field', () => {
    // Arrange
    const { bid1Price: _removed, ...withoutBidPrice } = REST_TICKER_SCHEMA_FIXTURE;

    // Act
    const result = BybitRestTickerSchema.safeParse(withoutBidPrice);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects a REST ticker missing the required markIv field', () => {
    // Arrange
    const { markIv: _removed, ...withoutMarkIv } = REST_TICKER_SCHEMA_FIXTURE;

    // Act
    const result = BybitRestTickerSchema.safeParse(withoutMarkIv);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    expect(BybitRestTickerSchema.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BybitTickersResponseSchema  (full REST envelope)
// ---------------------------------------------------------------------------

describe('BybitTickersResponseSchema', () => {
  it('parses the documented REST tickers envelope from rest-tickers.md verbatim', () => {
    // Arrange
    const input = {
      retCode: 0,
      retMsg: 'SUCCESS',
      result: {
        category: 'option',
        list: [REST_TICKER_SCHEMA_FIXTURE],
      },
    };

    // Act
    const result = BybitTickersResponseSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retCode).toBe(0);
      expect(result.data.retMsg).toBe('SUCCESS');
      expect(result.data.result.list).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// BybitWsTickerSchema
// ---------------------------------------------------------------------------

describe('BybitWsTickerSchema', () => {
  it('parses the documented WS ticker data item verbatim', () => {
    // Arrange — WS uses bidPrice/askPrice/bidIv/askIv/markPriceIv
    const input = WS_TICKER_DATA_DOC_FIXTURE;

    // Act
    const result = BybitWsTickerSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.symbol).toBe('BTC-21MAR26-70000-C-USDT');
      expect(result.data.bidPrice).toBe('940');
      expect(result.data.askPrice).toBe('960');
      expect(result.data.bidIv).toBe('0.53');
      expect(result.data.askIv).toBe('0.5419');
      expect(result.data.markPriceIv).toBe('0.5421');
    }
  });

  it('parses all greek fields from the documented WS fixture', () => {
    // Arrange
    const input = WS_TICKER_DATA_DOC_FIXTURE;

    // Act
    const result = BybitWsTickerSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.delta).toBe('0.51782561');
      expect(result.data.gamma).toBe('0.0001756');
      expect(result.data.vega).toBe('16.76259941');
      expect(result.data.theta).toBe('-343.85909514');
    }
  });

  it('rejects REST-style field names (bid1Price/ask1Price) — WS schema requires bidPrice/askPrice', () => {
    // Arrange — REST fields must not be accepted by the WS schema
    const input = REST_TICKER_SCHEMA_FIXTURE; // has bid1Price, ask1Price, markIv

    // Act
    const result = BybitWsTickerSchema.safeParse(input);

    // Assert — WS schema should reject REST-style field names
    expect(result.success).toBe(false);
  });

  it('rejects a WS ticker missing the required bidPrice field', () => {
    // Arrange
    const { bidPrice: _removed, ...withoutBidPrice } = WS_TICKER_DATA_DOC_FIXTURE;

    // Act
    const result = BybitWsTickerSchema.safeParse(withoutBidPrice);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects a WS ticker missing the required markPriceIv field', () => {
    // Arrange
    const { markPriceIv: _removed, ...withoutMarkPriceIv } = WS_TICKER_DATA_DOC_FIXTURE;

    // Act
    const result = BybitWsTickerSchema.safeParse(withoutMarkPriceIv);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    expect(BybitWsTickerSchema.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BybitWsMessageSchema
// ---------------------------------------------------------------------------

describe('BybitWsMessageSchema', () => {
  it('parses the documented WS message envelope verbatim', () => {
    // Arrange
    const input = WS_MESSAGE_DOC_FIXTURE;

    // Act
    const result = BybitWsMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topic).toBe('tickers.BTC-21MAR26-70000-C-USDT');
      expect(result.data.ts).toBe(1773966121157);
      expect(result.data.type).toBe('snapshot');
      expect(result.data.data.symbol).toBe('BTC-21MAR26-70000-C-USDT');
    }
  });

  it('confirms ts is a number as the docs show (Unix ms integer)', () => {
    // Arrange — ts: 1773966121157 is an unquoted integer in the docs
    const input = WS_MESSAGE_DOC_FIXTURE;

    // Act
    const result = BybitWsMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.ts).toBe('number');
    }
  });

  it('rejects a message where ts is a string instead of the documented number', () => {
    // Arrange — ts must be a number, not a string
    const input = { ...WS_MESSAGE_DOC_FIXTURE, ts: '1773966121157' };

    // Act
    const result = BybitWsMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects a message missing the required topic field', () => {
    // Arrange
    const { topic: _removed, ...withoutTopic } = WS_MESSAGE_DOC_FIXTURE;

    // Act
    const result = BybitWsMessageSchema.safeParse(withoutTopic);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects a message missing the required ts field', () => {
    // Arrange
    const { ts: _removed, ...withoutTs } = WS_MESSAGE_DOC_FIXTURE;

    // Act
    const result = BybitWsMessageSchema.safeParse(withoutTs);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects a message where the nested data object has invalid ticker shape', () => {
    // Arrange — data must conform to BybitWsTickerSchema
    const input = { ...WS_MESSAGE_DOC_FIXTURE, data: { symbol: 'BTC-21MAR26-70000-C-USDT' } };

    // Act
    const result = BybitWsMessageSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    expect(BybitWsMessageSchema.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BYBIT_OPTION_SYMBOL_RE  (symbol regex)
// ---------------------------------------------------------------------------

describe('BYBIT_OPTION_SYMBOL_RE', () => {
  it('matches the new 5-part format with USDT settle suffix from rest-instruments.md', () => {
    // From rest-instruments.md: BTC-25DEC26-67000-C-USDT
    expect(BYBIT_OPTION_SYMBOL_RE.test('BTC-25DEC26-67000-C-USDT')).toBe(true);
  });

  it('matches a live WS symbol from ws-tickers.md', () => {
    // From ws-tickers.md: BTC-21MAR26-70000-C-USDT
    expect(BYBIT_OPTION_SYMBOL_RE.test('BTC-21MAR26-70000-C-USDT')).toBe(true);
  });

  it('matches a put option with the 5-part format', () => {
    expect(BYBIT_OPTION_SYMBOL_RE.test('BTC-25DEC26-67000-P-USDT')).toBe(true);
  });

  it('matches the legacy 4-part format without settle suffix', () => {
    // rest-instruments.md notes: Legacy format: BTC-28MAR26-60000-C (4 parts, no suffix)
    expect(BYBIT_OPTION_SYMBOL_RE.test('BTC-28MAR26-60000-C')).toBe(true);
  });

  it('matches a legacy put option symbol', () => {
    expect(BYBIT_OPTION_SYMBOL_RE.test('ETH-28MAR26-2500-P')).toBe(true);
  });

  it('rejects an OKX-style symbol that includes the uly segment', () => {
    // OKX format: BTC-USD-260328-60000-C — not valid for Bybit
    expect(BYBIT_OPTION_SYMBOL_RE.test('BTC-USD-260328-60000-C')).toBe(false);
  });

  it('rejects a symbol with an invalid option type character', () => {
    // Only C and P are valid
    expect(BYBIT_OPTION_SYMBOL_RE.test('BTC-25DEC26-67000-X-USDT')).toBe(false);
  });

  it('rejects a symbol missing the option type entirely', () => {
    expect(BYBIT_OPTION_SYMBOL_RE.test('BTC-25DEC26-67000-USDT')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(BYBIT_OPTION_SYMBOL_RE.test('')).toBe(false);
  });

  it('extracts the correct capture groups for the 5-part format', () => {
    const match = 'BTC-25DEC26-67000-C-USDT'.match(BYBIT_OPTION_SYMBOL_RE);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('BTC'); // base
    expect(match?.[2]).toBe('25DEC26'); // expiry code
    expect(match?.[3]).toBe('67000'); // strike
    expect(match?.[4]).toBe('C'); // option type
    expect(match?.[5]).toBe('USDT'); // settle coin (optional group)
  });

  it('extracts the correct capture groups for the legacy 4-part format', () => {
    const match = 'BTC-28MAR26-60000-C'.match(BYBIT_OPTION_SYMBOL_RE);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('BTC');
    expect(match?.[2]).toBe('28MAR26');
    expect(match?.[3]).toBe('60000');
    expect(match?.[4]).toBe('C');
    expect(match?.[5]).toBeUndefined(); // no settle suffix in legacy format
  });
});
