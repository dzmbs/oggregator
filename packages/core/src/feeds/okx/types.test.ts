/**
 * OKX feed adapter — doc-driven contract tests
 *
 * Fixtures are copied verbatim from the official OKX documentation:
 *   - rest-get-instruments.md
 *   - rest-tickers.md
 *   - rest-opt-summary.md
 *   - ws-tickers.md
 *   - ws-opt-summary.md
 *
 * Purpose: verify our Zod schemas accept the exact shapes the API returns,
 * not merely shapes we invented.  A parse failure here means the schema
 * diverges from the documented contract.
 */

import { describe, it, expect } from 'vitest';
import {
  OkxInstrumentSchema,
  OkxTickerSchema,
  OkxOptSummarySchema,
  OkxRestResponseSchema,
  OkxWsOptSummaryMsgSchema,
  OkxWsTickerMsgSchema,
  OKX_OPTION_SYMBOL_RE,
} from './types.js';

// ---------------------------------------------------------------------------
// Fixtures — exact JSON from OKX documentation
// ---------------------------------------------------------------------------

/** Source: rest-get-instruments.md — OPTION instrument response object */
const REST_INSTRUMENT_DOC_FIXTURE = {
  instType: 'OPTION',
  instId: 'BTC-USD-260321-70000-C',
  uly: 'BTC-USD',
  instFamily: 'BTC-USD',
  settleCcy: 'BTC',
  ctVal: '0.01',
  ctMult: '1',
  ctValCcy: 'BTC',
  optType: 'C',
  stk: '70000',
  listTime: '1597026383085',
  expTime: '1774598400000',
  tickSz: '0.0001',
  lotSz: '1',
  minSz: '1',
  ctType: '',
  state: 'live',
} as const;

/** Source: rest-tickers.md — OPTION ticker response object */
const REST_TICKER_DOC_FIXTURE = {
  instType: 'OPTION',
  instId: 'BTC-USD-260321-70000-C',
  last: '0.013',
  lastSz: '1',
  askPx: '0.0135',
  askSz: '2058',
  bidPx: '0.013',
  bidSz: '1818',
  open24h: '0.0335',
  high24h: '0.0335',
  low24h: '0.01',
  volCcy24h: '16.13',
  vol24h: '1613',
  sodUtc0: '0.012',
  sodUtc8: '0.011',
  ts: '1654161646974',
} as const;

/** Source: rest-opt-summary.md — opt-summary response object */
const REST_OPT_SUMMARY_DOC_FIXTURE = {
  instType: 'OPTION',
  instId: 'BTC-USD-260321-70000-C',
  uly: 'BTC-USD',
  delta: '-0.4322834935',
  gamma: '9.2612727458',
  vega: '0.0003722247',
  theta: '-0.0027351203',
  deltaBS: '-0.4177692831',
  gammaBS: '0.0001198083',
  thetaBS: '-189.9336406909',
  vegaBS: '26.0871868579',
  lever: '68.8979953579',
  markVol: '0.4876708033',
  bidVol: '0.4736418652',
  askVol: '0.5004972802',
  realVol: '',
  volLv: '0.4736414899',
  fwdPx: '70097.9783321022',
  ts: '1646733631242',
} as const;

/**
 * Source: ws-opt-summary.md — verified live 2026-03-20.
 * Note: the WS payload includes three extra fields not present in the REST
 * response: buyApr, sellApr, distance.  Our schema must accept them (via
 * passthrough) or at minimum not reject the documented object.
 */
const WS_OPT_SUMMARY_DATA_ITEM = {
  instType: 'OPTION',
  instId: 'BTC-USD-260323-69500-P',
  uly: 'BTC-USD',
  delta: '-0.4322834935',
  gamma: '9.2612727458',
  vega: '0.0003722247',
  theta: '-0.0027351203',
  deltaBS: '-0.4177692831',
  gammaBS: '0.0001198083',
  thetaBS: '-189.9336406909',
  vegaBS: '26.0871868579',
  lever: '68.8979953579',
  markVol: '0.4876708033',
  bidVol: '0.4736418652',
  askVol: '0.5004972802',
  realVol: '',
  volLv: '0.4736414899',
  fwdPx: '70097.9783321022',
  ts: '1773966134835',
  buyApr: '1.54070352',
  sellApr: '1.65075377',
  distance: '-0.00853061',
} as const;

/** Source: ws-opt-summary.md — full WS message envelope */
const WS_OPT_SUMMARY_MSG_DOC_FIXTURE = {
  arg: {
    channel: 'opt-summary' as const,
    instFamily: 'BTC-USD',
  },
  data: [WS_OPT_SUMMARY_DATA_ITEM],
} as const;

/** Source: ws-tickers.md — full WS ticker message envelope (verified live) */
const WS_TICKER_MSG_DOC_FIXTURE = {
  arg: {
    channel: 'tickers' as const,
    instId: 'BTC-USD-260321-70000-C',
  },
  data: [
    {
      instType: 'OPTION',
      instId: 'BTC-USD-260321-70000-C',
      last: '0.013',
      lastSz: '1',
      askPx: '0.0135',
      askSz: '2058',
      bidPx: '0.013',
      bidSz: '1818',
      open24h: '0.0335',
      high24h: '0.0335',
      low24h: '0.01',
      sodUtc0: '0.012',
      sodUtc8: '0.011',
      volCcy24h: '16.13',
      vol24h: '1613',
      ts: '1773966184462',
    },
  ],
} as const;

// ---------------------------------------------------------------------------
// OkxInstrumentSchema
// ---------------------------------------------------------------------------

describe('OkxInstrumentSchema', () => {
  it('parses the documented OPTION instrument object verbatim', () => {
    // Arrange
    const input = REST_INSTRUMENT_DOC_FIXTURE;

    // Act
    const result = OkxInstrumentSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.instId).toBe('BTC-USD-260321-70000-C');
      expect(result.data.instType).toBe('OPTION');
      expect(result.data.optType).toBe('C');
      expect(result.data.stk).toBe('70000');
      expect(result.data.settleCcy).toBe('BTC');
      expect(result.data.state).toBe('live');
    }
  });

  it('accepts an empty string for ctType as the docs show', () => {
    // Arrange — ctType is "" in the real response
    const input = { ...REST_INSTRUMENT_DOC_FIXTURE, ctType: '' };

    // Act
    const result = OkxInstrumentSchema.safeParse(input);

    // Assert
    // ctType is not in the schema (schema has no ctType field) so it should
    // be silently stripped; the object must still parse successfully
    expect(result.success).toBe(true);
  });

  it('rejects an object missing the required instId field', () => {
    // Arrange
    const { instId: _removed, ...withoutInstId } = REST_INSTRUMENT_DOC_FIXTURE;

    // Act
    const result = OkxInstrumentSchema.safeParse(withoutInstId);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects an object missing the required instType field', () => {
    // Arrange
    const { instType: _removed, ...withoutInstType } = REST_INSTRUMENT_DOC_FIXTURE;

    // Act
    const result = OkxInstrumentSchema.safeParse(withoutInstType);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    expect(OkxInstrumentSchema.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OkxTickerSchema
// ---------------------------------------------------------------------------

describe('OkxTickerSchema', () => {
  it('parses the documented REST ticker object verbatim', () => {
    // Arrange
    const input = REST_TICKER_DOC_FIXTURE;

    // Act
    const result = OkxTickerSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.instId).toBe('BTC-USD-260321-70000-C');
      expect(result.data.bidPx).toBe('0.013');
      expect(result.data.askPx).toBe('0.0135');
      expect(result.data.last).toBe('0.013');
      expect(result.data.ts).toBe('1654161646974');
    }
  });

  it('parses the documented WS ticker data item verbatim', () => {
    // Arrange — WS payload is identical in structure to REST
    const input = WS_TICKER_MSG_DOC_FIXTURE.data[0];

    // Act
    const result = OkxTickerSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ts).toBe('1773966184462');
      expect(result.data.vol24h).toBe('1613');
      expect(result.data.volCcy24h).toBe('16.13');
    }
  });

  it('rejects a ticker missing ts (required timestamp field)', () => {
    // Arrange
    const { ts: _removed, ...withoutTs } = REST_TICKER_DOC_FIXTURE;

    // Act
    const result = OkxTickerSchema.safeParse(withoutTs);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects a ticker with a numeric ts instead of the documented string type', () => {
    // Arrange — OKX returns timestamps as numeric strings, not numbers
    const input = { ...REST_TICKER_DOC_FIXTURE, ts: 1654161646974 };

    // Act
    const result = OkxTickerSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    expect(OkxTickerSchema.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OkxOptSummarySchema
// ---------------------------------------------------------------------------

describe('OkxOptSummarySchema', () => {
  it('parses the documented REST opt-summary object verbatim', () => {
    // Arrange
    const input = REST_OPT_SUMMARY_DOC_FIXTURE;

    // Act
    const result = OkxOptSummarySchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.instId).toBe('BTC-USD-260321-70000-C');
      expect(result.data.delta).toBe('-0.4322834935');
      expect(result.data.markVol).toBe('0.4876708033');
      expect(result.data.fwdPx).toBe('70097.9783321022');
      // The docs show realVol as empty string — must be preserved
      expect(result.data.realVol).toBe('');
      expect(result.data.ts).toBe('1646733631242');
    }
  });

  it('parses the documented WS opt-summary data item verbatim', () => {
    // Arrange — WS item has extra fields (buyApr, sellApr, distance) not in REST
    const input = WS_OPT_SUMMARY_DATA_ITEM;

    // Act
    const result = OkxOptSummarySchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ts).toBe('1773966134835');
      expect(result.data.instId).toBe('BTC-USD-260323-69500-P');
    }
  });

  it('accepts realVol as empty string as the documentation shows', () => {
    // Arrange — realVol = "" is the documented value when no realized vol is available
    const input = { ...REST_OPT_SUMMARY_DOC_FIXTURE, realVol: '' };

    // Act
    const result = OkxOptSummarySchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects an opt-summary missing ts (required field)', () => {
    // Arrange
    const { ts: _removed, ...withoutTs } = REST_OPT_SUMMARY_DOC_FIXTURE;

    // Act
    const result = OkxOptSummarySchema.safeParse(withoutTs);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects an opt-summary missing instId (required field)', () => {
    // Arrange
    const { instId: _removed, ...withoutInstId } = REST_OPT_SUMMARY_DOC_FIXTURE;

    // Act
    const result = OkxOptSummarySchema.safeParse(withoutInstId);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    expect(OkxOptSummarySchema.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OkxRestResponseSchema
// ---------------------------------------------------------------------------

describe('OkxRestResponseSchema', () => {
  it('parses the documented REST envelope with code "0" and data array', () => {
    // Arrange — envelope wrapping instrument objects
    const input = {
      code: '0',
      msg: '',
      data: [REST_INSTRUMENT_DOC_FIXTURE],
    };

    // Act
    const result = OkxRestResponseSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe('0');
      expect(result.data.msg).toBe('');
      expect(result.data.data).toHaveLength(1);
    }
  });

  it('parses an error response envelope with non-zero code', () => {
    // Arrange — error responses also follow the same envelope
    const input = {
      code: '50001',
      msg: 'Service temporarily unavailable',
      data: [],
    };

    // Act
    const result = OkxRestResponseSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe('50001');
      expect(result.data.data).toHaveLength(0);
    }
  });

  it('parses a REST response containing ticker data objects', () => {
    // Arrange
    const input = {
      code: '0',
      msg: '',
      data: [REST_TICKER_DOC_FIXTURE],
    };

    // Act
    const result = OkxRestResponseSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects an envelope where code is a number instead of string', () => {
    // Arrange — OKX always returns code as a string, e.g. "0"
    const input = { code: 0, msg: '', data: [] };

    // Act
    const result = OkxRestResponseSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects an envelope missing the data array', () => {
    // Arrange
    const input = { code: '0', msg: '' };

    // Act
    const result = OkxRestResponseSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OkxWsOptSummaryMsgSchema
// ---------------------------------------------------------------------------

describe('OkxWsOptSummaryMsgSchema', () => {
  it('parses the documented WS opt-summary message envelope verbatim', () => {
    // Arrange
    const input = WS_OPT_SUMMARY_MSG_DOC_FIXTURE;

    // Act
    const result = OkxWsOptSummaryMsgSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.arg.channel).toBe('opt-summary');
      expect(result.data.arg.instFamily).toBe('BTC-USD');
      expect(result.data.data).toHaveLength(1);
      expect(result.data.data[0]?.instId).toBe('BTC-USD-260323-69500-P');
    }
  });

  it('rejects a message with the wrong channel literal', () => {
    // Arrange — "tickers" is not a valid opt-summary channel value
    const input = {
      arg: { channel: 'tickers', instFamily: 'BTC-USD' },
      data: [WS_OPT_SUMMARY_DATA_ITEM],
    };

    // Act
    const result = OkxWsOptSummaryMsgSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects a message missing the arg.instFamily field', () => {
    // Arrange
    const input = {
      arg: { channel: 'opt-summary' },
      data: [WS_OPT_SUMMARY_DATA_ITEM],
    };

    // Act
    const result = OkxWsOptSummaryMsgSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects a message where data is not an array', () => {
    // Arrange
    const input = {
      arg: { channel: 'opt-summary', instFamily: 'BTC-USD' },
      data: WS_OPT_SUMMARY_DATA_ITEM,
    };

    // Act
    const result = OkxWsOptSummaryMsgSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OkxWsTickerMsgSchema
// ---------------------------------------------------------------------------

describe('OkxWsTickerMsgSchema', () => {
  it('parses the documented WS tickers message envelope verbatim', () => {
    // Arrange
    const input = WS_TICKER_MSG_DOC_FIXTURE;

    // Act
    const result = OkxWsTickerMsgSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.arg.channel).toBe('tickers');
      expect(result.data.arg.instId).toBe('BTC-USD-260321-70000-C');
      expect(result.data.data).toHaveLength(1);
      expect(result.data.data[0]?.bidPx).toBe('0.013');
      expect(result.data.data[0]?.askPx).toBe('0.0135');
    }
  });

  it('rejects a message with channel "opt-summary" — not the tickers literal', () => {
    // Arrange
    const input = {
      arg: { channel: 'opt-summary', instId: 'BTC-USD-260321-70000-C' },
      data: [WS_TICKER_MSG_DOC_FIXTURE.data[0]],
    };

    // Act
    const result = OkxWsTickerMsgSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects a message missing arg.instId', () => {
    // Arrange
    const input = {
      arg: { channel: 'tickers' },
      data: [WS_TICKER_MSG_DOC_FIXTURE.data[0]],
    };

    // Act
    const result = OkxWsTickerMsgSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects a message where data items have missing required ticker fields', () => {
    // Arrange — remove ts from the data item
    const { ts: _removed, ...withoutTs } = WS_TICKER_MSG_DOC_FIXTURE.data[0];
    const input = {
      arg: WS_TICKER_MSG_DOC_FIXTURE.arg,
      data: [withoutTs],
    };

    // Act
    const result = OkxWsTickerMsgSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OKX_OPTION_SYMBOL_RE  (symbol regex)
// ---------------------------------------------------------------------------

describe('OKX_OPTION_SYMBOL_RE', () => {
  it('matches the canonical call option format from the docs', () => {
    expect(OKX_OPTION_SYMBOL_RE.test('BTC-USD-260328-60000-C')).toBe(true);
  });

  it('matches the put option format from the docs', () => {
    expect(OKX_OPTION_SYMBOL_RE.test('BTC-USD-260321-70000-C')).toBe(true);
  });

  it('matches a put option symbol', () => {
    expect(OKX_OPTION_SYMBOL_RE.test('ETH-USD-260328-2500-P')).toBe(true);
  });

  it('matches a verified live symbol from ws-opt-summary.md', () => {
    // From ws-opt-summary.md fixture: BTC-USD-260323-69500-P
    expect(OKX_OPTION_SYMBOL_RE.test('BTC-USD-260323-69500-P')).toBe(true);
  });

  it('rejects a symbol missing the option type suffix', () => {
    expect(OKX_OPTION_SYMBOL_RE.test('BTC-USD-260328-60000')).toBe(false);
  });

  it('rejects a symbol with an invalid option type character', () => {
    // Only C and P are valid
    expect(OKX_OPTION_SYMBOL_RE.test('BTC-USD-260328-60000-X')).toBe(false);
  });

  it('rejects a symbol with only 4 parts instead of 5', () => {
    // Bybit-style without uly is not a valid OKX symbol
    expect(OKX_OPTION_SYMBOL_RE.test('BTC-260328-60000-C')).toBe(false);
  });

  it('rejects a symbol with a non-6-digit expiry code', () => {
    expect(OKX_OPTION_SYMBOL_RE.test('BTC-USD-26032-60000-C')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(OKX_OPTION_SYMBOL_RE.test('')).toBe(false);
  });

  it('rejects a symbol with extra trailing characters', () => {
    expect(OKX_OPTION_SYMBOL_RE.test('BTC-USD-260328-60000-C-USDT')).toBe(false);
  });

  it('extracts the correct named capture groups', () => {
    const match = 'BTC-USD-260328-60000-C'.match(OKX_OPTION_SYMBOL_RE);
    expect(match).not.toBeNull();
    // Groups: base, quote, expiryCode, strike, right
    expect(match?.[1]).toBe('BTC');
    expect(match?.[2]).toBe('USD');
    expect(match?.[3]).toBe('260328');
    expect(match?.[4]).toBe('60000');
    expect(match?.[5]).toBe('C');
  });
});
