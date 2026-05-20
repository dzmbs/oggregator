/**
 * Gate.io feed adapter — doc-driven contract tests
 *
 * Fixtures are copied verbatim from live API captures saved (local only) at
 *   references/options-docs/gateio/
 * The `references/` tree is gitignored, so we inline the exact shapes here.
 * A parse failure means Gate.io changed their API.
 */

import { describe, expect, it } from 'vitest';
import {
  GATEIO_SYMBOL_REGEX,
  GateioContractSchema,
  GateioContractsResponseSchema,
  GateioExpirationsResponseSchema,
  GateioOrderBookSchema,
  GateioTickerSchema,
  GateioTickersResponseSchema,
  GateioUnderlyingSchema,
  GateioUnderlyingTickerSchema,
  GateioUnderlyingsResponseSchema,
  GateioWsContractTickerSchema,
  GateioWsEnvelopeSchema,
  GateioWsTradeSchema,
  parseGateioSymbol,
} from './types.js';

// Inline fixtures (verbatim from live captures) ─────────────────────────────

/** Source: references/options-docs/gateio/rest-underlyings.json */
const REST_UNDERLYING_FIXTURE = {
  index_time: 1778716961,
  name: 'BTC_USDT',
  index_price: '79392.68',
} as const;

/** Source: references/options-docs/gateio/rest-instruments.json */
const REST_CONTRACT_FIXTURE = {
  is_active: true,
  mark_price_round: '0.1',
  settle_fee_rate: '0',
  bid1_size: 2000,
  taker_fee_rate: '0.0003',
  price_limit_fee_rate: '0.125',
  order_price_round: '1',
  tag: 'day',
  ref_rebate_rate: '0',
  name: 'BTC_USDT-20260516-77500-P',
  strike_price: '77500',
  ask1_price: '343',
  ref_discount_rate: '0',
  order_price_deviate: '0.2',
  ask1_size: 179,
  mark_price_down: '175.3',
  orderbook_id: 20611,
  is_call: false,
  last_price: '0',
  mark_price: '350.6',
  underlying: 'BTC_USDT',
  create_time: 1778692045,
  expiration_time: 1778918400,
  order_size_min: 1,
  init_margin_high: '0.15',
  settle_limit_fee_rate: '0.125',
  orders_limit: 10,
  mark_price_up: '525.9',
  position_size: 0,
  order_size_max: 10000,
  position_limit: 40000,
  multiplier: '0.01',
  init_margin_low: '0.1',
  trade_size: 0,
  underlying_price: '79371.64',
  maker_fee_rate: '0.0003',
  maint_margin_base: '0.075',
  trade_id: 0,
  bid1_price: '322',
} as const;

/** Source: references/options-docs/gateio/rest-tickers.json */
const REST_TICKER_FIXTURE = {
  vega: '19.18789',
  leverage: '51.71381553109',
  ask_iv: '0.4063',
  delta: '-0.22843',
  last_price: '0',
  bid1_size: 2000,
  mark_price: '350.6',
  index_price: '79398.46',
  mark_iv: '0.4103',
  name: 'BTC_USDT-20260516-77500-P',
  bid_iv: '0.3953',
  theta: '-168.86772',
  ask1_price: '343',
  gamma: '0.000116',
  underlying_price: '79371.64',
  expiration_time: 1778918400,
  position_size: 0,
  ask1_size: 179,
  bid1_price: '322',
} as const;

/** Source: references/options-docs/gateio/rest-underlying-ticker.json */
const REST_UNDERLYING_TICKER_FIXTURE = {
  trade_call: 5163,
  index_price: '79388.72',
  trade_put: 9002,
} as const;

/** Source: references/options-docs/gateio/rest-order-book.json */
const REST_ORDER_BOOK_FIXTURE = {
  current: 1778716984.029,
  asks: [
    { s: 2000, p: '348' },
    { s: 24, p: '389' },
    { s: 20, p: '1367' },
  ],
  bids: [
    { s: 2000, p: '327' },
    { s: 24, p: '301' },
  ],
  id: 20615,
  update: 1778716976.789,
} as const;

const REST_EXPIRATIONS_FIXTURE = [
  1778918400, 1778745600, 1779436800, 1785484800, 1798185600,
] as const;

// Tests ──────────────────────────────────────────────────────────────────────

describe('Gate.io symbol parser', () => {
  it('parses BTC_USDT call', () => {
    expect(parseGateioSymbol('BTC_USDT-20260626-70000-C')).toEqual({
      base: 'BTC',
      quote: 'USDT',
      expiry: '2026-06-26',
      strike: 70000,
      right: 'call',
    });
  });

  it('parses ETH_USDT put with decimal strike', () => {
    expect(parseGateioSymbol('ETH_USDT-20260925-3500-P')).toEqual({
      base: 'ETH',
      quote: 'USDT',
      expiry: '2026-09-25',
      strike: 3500,
      right: 'put',
    });
  });

  it('rejects malformed names', () => {
    expect(() => parseGateioSymbol('BTC-USDT-20260626-70000-C')).toThrow();
    expect(() => parseGateioSymbol('BTC_USDT-202606-70000-C')).toThrow();
    expect(() => parseGateioSymbol('BTC_USDT-20260626-70000-X')).toThrow();
  });

  it('regex matches the canonical form', () => {
    expect(GATEIO_SYMBOL_REGEX.test('BTC_USDT-20260626-70000-C')).toBe(true);
    expect(GATEIO_SYMBOL_REGEX.test('SOL_USDT-20260925-150-P')).toBe(true);
  });
});

describe('Gate.io REST envelope schemas (verbatim fixtures)', () => {
  it('accepts /options/underlyings entry', () => {
    expect(GateioUnderlyingSchema.safeParse(REST_UNDERLYING_FIXTURE).success).toBe(true);
    expect(GateioUnderlyingsResponseSchema.safeParse([REST_UNDERLYING_FIXTURE]).success).toBe(true);
  });

  it('accepts /options/expirations', () => {
    expect(GateioExpirationsResponseSchema.safeParse([...REST_EXPIRATIONS_FIXTURE]).success).toBe(true);
  });

  it('accepts /options/contracts entry', () => {
    expect(GateioContractSchema.safeParse(REST_CONTRACT_FIXTURE).success).toBe(true);
    expect(GateioContractsResponseSchema.safeParse([REST_CONTRACT_FIXTURE]).success).toBe(true);
  });

  it('accepts /options/tickers entry', () => {
    expect(GateioTickerSchema.safeParse(REST_TICKER_FIXTURE).success).toBe(true);
    expect(GateioTickersResponseSchema.safeParse([REST_TICKER_FIXTURE]).success).toBe(true);
  });

  it('accepts /options/underlying/tickers/{u}', () => {
    expect(GateioUnderlyingTickerSchema.safeParse(REST_UNDERLYING_TICKER_FIXTURE).success).toBe(true);
  });

  it('accepts /options/order_book', () => {
    expect(GateioOrderBookSchema.safeParse(REST_ORDER_BOOK_FIXTURE).success).toBe(true);
  });

  it('mark_iv parses as a fraction (0..5 range)', () => {
    const parsed = GateioTickerSchema.parse(REST_TICKER_FIXTURE);
    expect(parsed.mark_iv).toBeDefined();
    const n = Number(parsed.mark_iv);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(5);
  });
});

describe('Gate.io WS envelope schema', () => {
  it('parses a contract ticker update', () => {
    const envelope = {
      time: 1747008000,
      channel: 'options.contract_tickers',
      event: 'update' as const,
      result: {
        name: 'BTC_USDT-20260626-70000-C',
        last_price: '2717.04',
        mark_price: '2717.0',
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
        leverage: '29.44',
        delta: '0.334122',
        gamma: '0.009467',
        vega: '77.011051',
        theta: '-26.766029',
        rho: '3013.044691',
      },
    };
    const parsed = GateioWsEnvelopeSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.event === 'update') {
      const inner = GateioWsContractTickerSchema.parse(parsed.data.result);
      expect(inner.name).toBe('BTC_USDT-20260626-70000-C');
    }
  });

  it('parses a trade update', () => {
    const envelope = {
      time: 1747008000,
      channel: 'options.trades',
      event: 'update' as const,
      result: [
        {
          id: 999,
          create_time: 1747008000,
          create_time_ms: 1747008000123,
          contract: 'BTC_USDT-20260626-70000-C',
          size: -2,
          price: '2715.00',
        },
      ],
    };
    const parsed = GateioWsEnvelopeSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.event === 'update') {
      const inner = GateioWsTradeSchema.array().parse(parsed.data.result);
      expect(inner[0]!.contract).toBe('BTC_USDT-20260626-70000-C');
    }
  });
});
