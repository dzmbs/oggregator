/**
 * Thalex feed — doc- and capture-driven contract tests.
 *
 * REST fixtures captured from live:
 *   references/options-docs/thalex/{instrument-sample,system-info,ticker-rest}.json
 * WS fixtures captured from live (2026-04-20):
 *   references/options-docs/thalex/{ticker-pushes,index-pushes,subscribe-acks}.json
 *
 * Purpose: every schema accepts the exact shapes Thalex sends.
 */

import { describe, expect, it } from 'vitest';
import { parseThalexWsMessage } from './codec.js';
import {
  THALEX_OPTION_SYMBOL_RE,
  ThalexIndexNotificationSchema,
  ThalexInstrumentSchema,
  ThalexInstrumentsResponseSchema,
  ThalexRpcErrorSchema,
  ThalexSubscribeAckSchema,
  ThalexSystemInfoSchema,
  ThalexTickerNotificationSchema,
  ThalexTickerSchema,
} from './types.js';

// ── REST: /public/instruments ──────────────────────────────────
// Source: live capture, 2026-04-20.
const INSTRUMENT_FIXTURE = {
  instrument_name: 'BTC-21APR26-75000-P',
  product: 'OBTCUSD',
  tick_size: 5,
  volume_tick_size: 0.01,
  min_order_amount: 0.01,
  underlying: 'BTCUSD',
  type: 'option',
  option_type: 'put',
  expiry_date: '2026-04-21',
  expiration_timestamp: 1776758400,
  strike_price: 75000,
  base_currency: 'USD',
  create_time: 1776585601.4549272,
};

// ── REST: /public/system_info ──────────────────────────────────
const SYSTEM_INFO_FIXTURE = {
  banners: [],
  environment: 'production',
  api_version: '2.59.0',
};

// ── WS: ticker.<instrument>.1000ms notification ────────────────
// Source: live capture, ticker-pushes.json[0].
const TICKER_NOTIFICATION_FIXTURE = {
  channel_name: 'ticker.BTC-21APR26-75000-P.1000ms',
  notification: {
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
    low_price_24h: 320,
    high_price_24h: 665,
    change_24h: -320,
    index: 76283.25916666667,
    forward: 76276.40187647431,
    collar_low: 39.91343582,
    collar_high: 66.52239304,
    open_interest: 0.18,
  },
};

// ── WS: price_index.<underlying> notification ──────────────────
// Source: live capture, index-pushes.json[0].
const INDEX_NOTIFICATION_FIXTURE = {
  channel_name: 'price_index.BTCUSD',
  notification: {
    index_name: 'BTCUSD',
    price: 76283.25916666667,
    timestamp: 1776715497.7188172,
    previous_settlement_price: 74945.7785774655,
  },
};

// ── WS: subscribe ack ──────────────────────────────────────────
const SUBSCRIBE_ACK_FIXTURE = {
  id: 1,
  result: ['ticker.BTC-21APR26-75000-P.1000ms'],
};

// ── WS: RPC error ──────────────────────────────────────────────
const RPC_ERROR_FIXTURE = {
  id: 99,
  error: { code: -32601, message: 'Method not found' },
};

describe('Thalex types', () => {
  it('accepts a /public/instruments row', () => {
    expect(ThalexInstrumentSchema.safeParse(INSTRUMENT_FIXTURE).success).toBe(true);
  });

  it('accepts an array of instruments', () => {
    const result = ThalexInstrumentsResponseSchema.safeParse([INSTRUMENT_FIXTURE]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]?.instrument_name).toBe('BTC-21APR26-75000-P');
      expect(result.data[0]?.strike_price).toBe(75000);
      expect(result.data[0]?.option_type).toBe('put');
    }
  });

  it('accepts a non-option instrument by leaving optional fields off', () => {
    const perp = {
      instrument_name: 'BTC-PERPETUAL',
      product: 'FBTCUSD',
      underlying: 'BTCUSD',
      type: 'perpetual',
    };
    expect(ThalexInstrumentSchema.safeParse(perp).success).toBe(true);
  });

  it('accepts a system_info payload', () => {
    expect(ThalexSystemInfoSchema.safeParse(SYSTEM_INFO_FIXTURE).success).toBe(true);
  });

  it('accepts a ticker notification', () => {
    const result = ThalexTickerNotificationSchema.safeParse(TICKER_NOTIFICATION_FIXTURE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel_name).toBe('ticker.BTC-21APR26-75000-P.1000ms');
      expect(result.data.notification.iv).toBeCloseTo(0.3692, 3);
      expect(result.data.notification.delta).toBeLessThan(0);
    }
  });

  it('tolerates a ticker missing optional greeks (gamma/theta/vega)', () => {
    // Thalex never sends gamma/theta/vega — schema must not require them.
    const t = { ...TICKER_NOTIFICATION_FIXTURE.notification };
    const keys = Object.keys(t) as (keyof typeof t)[];
    expect(keys).not.toContain('gamma');
    expect(keys).not.toContain('theta');
    expect(keys).not.toContain('vega');
    expect(ThalexTickerSchema.safeParse(t).success).toBe(true);
  });

  it('accepts an index notification', () => {
    const result = ThalexIndexNotificationSchema.safeParse(INDEX_NOTIFICATION_FIXTURE);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.notification.price).toBeGreaterThan(0);
  });

  it('accepts a subscribe ack', () => {
    expect(ThalexSubscribeAckSchema.safeParse(SUBSCRIBE_ACK_FIXTURE).success).toBe(true);
  });

  it('accepts an RPC error envelope', () => {
    expect(ThalexRpcErrorSchema.safeParse(RPC_ERROR_FIXTURE).success).toBe(true);
  });

  it('rejects a ticker notification with a bad channel prefix via dispatcher', () => {
    const bad = { ...TICKER_NOTIFICATION_FIXTURE, channel_name: 'something_else' };
    const d = parseThalexWsMessage(bad);
    expect(d.kind).toBe('unknown');
  });
});

describe('Thalex WS dispatcher', () => {
  it('routes ticker notifications', () => {
    const d = parseThalexWsMessage(TICKER_NOTIFICATION_FIXTURE);
    expect(d.kind).toBe('ticker');
  });
  it('routes price_index notifications', () => {
    const d = parseThalexWsMessage(INDEX_NOTIFICATION_FIXTURE);
    expect(d.kind).toBe('index');
  });
  it('routes subscribe acks', () => {
    const d = parseThalexWsMessage(SUBSCRIBE_ACK_FIXTURE);
    expect(d.kind).toBe('ack');
  });
  it('routes RPC errors', () => {
    const d = parseThalexWsMessage(RPC_ERROR_FIXTURE);
    expect(d.kind).toBe('error');
  });
  it('returns unknown for arbitrary JSON', () => {
    const d = parseThalexWsMessage({ hello: 'world' });
    expect(d.kind).toBe('unknown');
  });
});

describe('Thalex symbol regex', () => {
  it('matches a BTC put', () => {
    const m = THALEX_OPTION_SYMBOL_RE.exec('BTC-21APR26-75000-P');
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe('BTC');
    expect(m?.[2]).toBe('21APR26');
    expect(m?.[3]).toBe('75000');
    expect(m?.[4]).toBe('P');
  });

  it('matches an ETH call', () => {
    const m = THALEX_OPTION_SYMBOL_RE.exec('ETH-28MAR26-3000-C');
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe('ETH');
    expect(m?.[4]).toBe('C');
  });

  it('matches a single-digit day', () => {
    const m = THALEX_OPTION_SYMBOL_RE.exec('BTC-4JUL23-27000-C');
    expect(m).not.toBeNull();
    expect(m?.[2]).toBe('4JUL23');
  });

  it('rejects Coincall-style symbols with USD suffix', () => {
    expect(THALEX_OPTION_SYMBOL_RE.exec('BTCUSD-14SEP23-22500-C')).toBeNull();
  });

  it('rejects perpetuals', () => {
    expect(THALEX_OPTION_SYMBOL_RE.exec('BTC-PERPETUAL')).toBeNull();
  });

  it('rejects missing right suffix', () => {
    expect(THALEX_OPTION_SYMBOL_RE.exec('BTC-21APR26-75000')).toBeNull();
  });
});
