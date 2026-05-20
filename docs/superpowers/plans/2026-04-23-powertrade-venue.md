# PowerTrade Venue Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PowerTrade as the 8th option venue, exposing instrument discovery, live order book / trades / mark / index / settlement / greeks data through the same `OptionVenueAdapter` contract every other venue uses.

**Architecture:** A new `feeds/powertrade/` module mirroring the Thalex layout. Single feeds WebSocket (`wss://api.wss.prod.power.trade/v1/feeds`) carries both reference data (`deliverable<option>`, `deliverable<exchange_token>`, `deliverable<stable_token>`) and live market data (`top_of_book`, `rte_trade`, `reference_price`, `settlement_price`, `risk_snapshot`). Reference data is hydrated once at boot, then live channels stream by `symbol_prefix` per `(underlying, expiry)`. RTE message variants are preferred so prices arrive pre-decimalised — no integer-scaling math in the hot path. Greeks + IV come from `risk_snapshot` (mid/bid/ask), the richest source we have across venues.

**Tech Stack:** TypeScript 2026 (strict), Zod for I/O validation, native `ws` client, Fastify (server), Vite/React (web). No PowerTrade SDK — raw protocol per project rule.

---

## Pre-flight

- **API enablement:** PowerTrade's overview page warns "API USE IS CURRENTLY DISABLED — get in touch." Public market-data feeds historically work without IP whitelisting; the user will request enablement only if anonymous WS connect returns 403/451 from `api.wss.prod.power.trade`. Tasks below assume the public endpoint accepts our connections; an explicit live-probe step (Task 4) verifies this before we wire the rest.
- **Fee cap:** placeholder `0.125` (12.5%, matches Deribit/OKX/Bybit/Derive/Coincall/Thalex defaults). User will supply real cap; replace the constant in `sdk-base.ts` when delivered. Maker/taker stay `null` (Coincall pattern) so the per-account tiering doesn't pollute estimates.
- **No live capture available yet:** WS-frame fixtures (Tasks 7–9) will be paraphrased from the official spec at https://power-trade.github.io/api-docs-source/ws_feeds.html. As soon as the live WS accepts a connection, capture real frames and replace fixtures verbatim. Doc-only fixtures are still doc-driven (acceptable per `core/CLAUDE.md`).
- **Today's date:** 2026-04-23. Sample expiries used in tests are `2026-06-26` and `2026-12-25` (clear of the current date).

## File Structure

**New files (all under `packages/core/src/feeds/powertrade/`):**

| File | LOC budget | Responsibility |
|---|---|---|
| `types.ts` | ~180 | Zod schemas for every WS frame + REST envelope; native symbol regex |
| `codec.ts` | ~110 | Parser wrappers + `parsePowertradeWsMessage` dispatcher |
| `state.ts` | ~140 | `buildPowertradeInstrument` + `mergePowertradeQuote` helpers (top-of-book / trade / reference / risk merge into `LiveQuote`) |
| `planner.ts` | ~130 | Subscription state, `subscribe`/`unsubscribe` JSON builders, `symbol_prefix` derivation per `(underlying, expiry)`, channel batching |
| `health.ts` | ~45 | REST `/v1/market_data/currency/all/summary` probe → `connected | degraded` |
| `ws-client.ts` | ~330 | `PowertradeWsAdapter` extends `SdkBaseAdapter`; orchestration only |
| `index.ts` | 1 | Barrel export of adapter class |
| `types.test.ts` | ~250 | Doc-driven Zod contract tests + symbol-regex tests |
| `state.test.ts` | ~200 | Instrument build + quote-merge tests |
| `planner.test.ts` | ~120 | Subscription state machine tests |
| `health.test.ts` | ~50 | Health derivation tests |

**Modified files:**

- `packages/protocol/src/ws.ts:5` — append `'powertrade'` to `VENUE_IDS` tuple
- `packages/core/src/feeds/shared/sdk-base.ts:19-27` — add `powertrade: 0.125` entry to `FEE_CAP`
- `packages/core/src/feeds/shared/endpoints.ts` — append PowerTrade WS + REST URL constants
- `packages/core/src/index.ts:153` — export `PowertradeWsAdapter`
- `packages/server/src/adapters.ts` — import + instantiate + register
- `packages/web/src/lib/venue-meta.ts` — add `powertrade` entry; import logo asset
- `packages/web/src/assets/venues/powertrade.svg` — new logo file (placeholder path; user supplies SVG content)

**Reference docs (under `references/options-docs/powertrade/`):**

- `ws_feeds.html` — saved copy of official WS spec
- `rest_api.html` — saved copy of official REST spec
- `instrument-sample.json` — sample `deliverable<option>` envelope (from spec)
- `top-of-book-pushes.json` — sample top-of-book frames
- `trade-pushes.json` — sample `rte_trade` frames
- `reference-price-pushes.json` — sample mark-price frames
- `risk-snapshot-pushes.json` — sample greeks frames
- `subscribe-acks.json` — sample subscribe/error envelopes
- `currency-summary.json` — sample REST health-probe response
- `summary.json` — adapter-author metadata (sample symbol, WS URL tested, captured-at date, notes)

---

## Task 1 — Save reference docs and protocol-level VenueId

**Files:**
- Create: `references/options-docs/powertrade/ws_feeds.html`
- Create: `references/options-docs/powertrade/rest_api.html`
- Create: `references/options-docs/powertrade/summary.json`
- Modify: `packages/protocol/src/ws.ts:5`

- [ ] **Step 1: Pull official spec pages**

```bash
curl -fsSL https://power-trade.github.io/api-docs-source/ws_feeds.html \
  -o references/options-docs/powertrade/ws_feeds.html
curl -fsSL https://power-trade.github.io/api-docs-source/rest_api.html \
  -o references/options-docs/powertrade/rest_api.html
```

Expected: two HTML files exist, each > 50KB.

- [ ] **Step 2: Write `summary.json`**

```json
{
  "venue": "powertrade",
  "wsUrl": "wss://api.wss.prod.power.trade/v1/feeds",
  "restBase": "https://api.rest.prod.power.trade",
  "spec": {
    "ws": "https://power-trade.github.io/api-docs-source/ws_feeds.html",
    "rest": "https://power-trade.github.io/api-docs-source/rest_api.html"
  },
  "sampleSymbol": "BTC-20260626-70000C",
  "symbolFormat": "{BASE}-{YYYYMMDD}-{STRIKE}{C|P}",
  "settle": "USDC",
  "linear": true,
  "ivUnit": "fraction",
  "greeksSource": "risk_snapshot (mid/bid/ask)",
  "auth": "none for public/* feeds",
  "capturedAt": "2026-04-23",
  "notes": "RTE message variants used so prices arrive decimalised. Reference data hydrated at boot from same WS connection."
}
```

- [ ] **Step 3: Add `'powertrade'` to VENUE_IDS**

In `packages/protocol/src/ws.ts:5` change:

```ts
export const VENUE_IDS = ['deribit', 'okx', 'bybit', 'binance', 'derive', 'coincall', 'thalex'] as const;
```

to:

```ts
export const VENUE_IDS = ['deribit', 'okx', 'bybit', 'binance', 'derive', 'coincall', 'thalex', 'powertrade'] as const;
```

- [ ] **Step 4: Verify protocol still builds**

Run: `pnpm --filter @oggregator/protocol typecheck && pnpm --filter @oggregator/protocol test`
Expected: PASS, zero errors.

- [ ] **Step 5: Verify core typechecks (so FEE_CAP map break is visible)**

Run: `pnpm --filter @oggregator/core typecheck`
Expected: **FAIL** with "Property 'powertrade' is missing in type ... but required in type 'Record<VenueId, number>'" pointing at `feeds/shared/sdk-base.ts:19`. This is the failing test that motivates Step 6.

- [ ] **Step 6: Add `powertrade` to FEE_CAP**

In `packages/core/src/feeds/shared/sdk-base.ts:19-27` change the `FEE_CAP` literal to include:

```ts
const FEE_CAP: Record<VenueId, number> = {
  deribit: 0.125,
  okx: 0.125,
  bybit: 0.125,
  binance: 0.1,
  derive: 0.125,
  coincall: 0.125,
  thalex: 0.125,
  powertrade: 0.125, // placeholder — user to confirm PowerTrade fee schedule
};
```

- [ ] **Step 7: Re-run typecheck**

Run: `pnpm --filter @oggregator/core typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add references/options-docs/powertrade/ws_feeds.html \
        references/options-docs/powertrade/rest_api.html \
        references/options-docs/powertrade/summary.json \
        packages/protocol/src/ws.ts \
        packages/core/src/feeds/shared/sdk-base.ts
git commit -m "chore(core,protocol): register powertrade venue id"
```

---

## Task 2 — Endpoints + WS URL constants

**Files:**
- Modify: `packages/core/src/feeds/shared/endpoints.ts`

- [ ] **Step 1: Append PowerTrade endpoint block**

At the end of `packages/core/src/feeds/shared/endpoints.ts` add:

```ts
// ── PowerTrade ─────────────────────────────────────────────────────
// Public market data requires no auth. Test/Dev environments swap in
// `test`/`dev` for `prod` in both WS and REST hostnames.
//   WS spec:   https://power-trade.github.io/api-docs-source/ws_feeds.html
//   REST spec: https://power-trade.github.io/api-docs-source/rest_api.html
export const POWERTRADE_FEEDS_WS_URL = 'wss://api.wss.prod.power.trade/v1/feeds';
export const POWERTRADE_REST_BASE_URL = 'https://api.rest.prod.power.trade';
export const POWERTRADE_CURRENCY_ALL_SUMMARY = '/v1/market_data/currency/all/summary';
export const POWERTRADE_TRADEABLE_ENTITY_ALL_SUMMARY = '/v1/market_data/tradeable_entity/all/summary';
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @oggregator/core typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/feeds/shared/endpoints.ts
git commit -m "feat(core): add powertrade feed endpoint constants"
```

---

## Task 3 — Zod schemas + native symbol regex (TDD)

**Files:**
- Create: `packages/core/src/feeds/powertrade/types.ts`
- Create: `packages/core/src/feeds/powertrade/types.test.ts`
- Create: `references/options-docs/powertrade/instrument-sample.json`
- Create: `references/options-docs/powertrade/top-of-book-pushes.json`
- Create: `references/options-docs/powertrade/trade-pushes.json`
- Create: `references/options-docs/powertrade/reference-price-pushes.json`
- Create: `references/options-docs/powertrade/risk-snapshot-pushes.json`
- Create: `references/options-docs/powertrade/subscribe-acks.json`

- [ ] **Step 1: Save the doc fixtures verbatim from the WS spec**

Each JSON file holds a single object copied from the spec's example payloads. Exact contents:

`references/options-docs/powertrade/instrument-sample.json`:
```json
{
  "deliverable": {
    "deliverable_id": "92",
    "symbol": "BTC-20260626-70000C",
    "tags": ["BTC", "option", "month"],
    "decimal_places": "4",
    "listing_status": "active",
    "details": {
      "option": {
        "expiry": {
          "datetime": {
            "date": { "year": "2026", "month": "6", "day": "26" },
            "time": { "hours": "8", "minutes": "0", "seconds": "0", "nanoseconds": "0" }
          },
          "timezone": "UTC"
        },
        "strike_price": "70000000000",
        "option_type": "call",
        "exercise_style": "european",
        "valuation_approach": "vanilla",
        "delivery_style": "cash",
        "underlying_deliverable_id": "3",
        "contract_size_deliverable_id": "3",
        "contract_size": "100000000",
        "settlement_deliverable_id": "2",
        "utc_creation_time": "1745366400000000000",
        "creation_source_id": "0",
        "margin_spec_id": "1",
        "strikes_spec_id": "1"
      }
    }
  }
}
```

`references/options-docs/powertrade/top-of-book-pushes.json`:
```json
{
  "top_of_book": {
    "timestamp": "1745366400000000000",
    "tradeable_entity_id": "10835",
    "market_id": "0",
    "symbol": "BTC-20260626-70000C",
    "best_bid_price": "2677.10",
    "best_bid_quantity": "0.5",
    "best_ask_price": "2741.69",
    "best_ask_quantity": "0.5"
  }
}
```

`references/options-docs/powertrade/trade-pushes.json`:
```json
{
  "rte_trade": {
    "timestamp": "1745366400000000000",
    "symbol": "BTC-20260626-70000C",
    "tradeable_entity_id": "10835",
    "market_id": "0",
    "trade_id": "1234567",
    "price": "2717.04",
    "price_type": "passive",
    "quantity": "0.06",
    "quantity_in_underlying": "0.06",
    "buy_display_order_id": "777",
    "sell_display_order_id": "777"
  }
}
```

`references/options-docs/powertrade/reference-price-pushes.json`:
```json
{
  "reference_price": {
    "timestamp": "1745366400000000000",
    "tradeable_entity_id": "10835",
    "market_id": "0",
    "symbol": "BTC-20260626-70000C",
    "price": "2717.04",
    "price_type": "reference"
  }
}
```

`references/options-docs/powertrade/risk-snapshot-pushes.json`:
```json
{
  "risk_snapshot": {
    "symbol": "BTC-20260626-70000C",
    "tradeable_entity_id": "10835",
    "market_id": "0",
    "timestamp": "1745366400000000000",
    "time_to_expire": "0.179",
    "theoretical": null,
    "mid": {
      "price": "2717.04",
      "volatility": "0.7132",
      "greeks": {
        "delta": "0.334122",
        "vega": "77.011051",
        "theta": "-26.766029",
        "rho": "3013.044691",
        "gamma": "0.009467"
      }
    },
    "bid": {
      "price": "2677.10",
      "volatility": "0.7089",
      "greeks": {
        "delta": "0.331613",
        "vega": "76.753915",
        "theta": "-26.454029",
        "rho": "2996.165119",
        "gamma": "0.009492"
      }
    },
    "ask": {
      "price": "2741.69",
      "volatility": "0.7165",
      "greeks": {
        "delta": "0.335436",
        "vega": "77.128658",
        "theta": "-26.920926",
        "rho": "3020.792592",
        "gamma": "0.009437"
      }
    }
  }
}
```

`references/options-docs/powertrade/subscribe-acks.json`:
```json
[
  { "subscribed": { "tradeable_entity_id": "10835", "symbol": "BTC-20260626-70000C" } },
  { "subscribe_error": { "message": "Already subscribed" } },
  { "unsubscribed": { "tradeable_entity_id": "10835" } }
]
```

- [ ] **Step 2: Write the failing schema tests**

Create `packages/core/src/feeds/powertrade/types.test.ts`:

```ts
/**
 * PowerTrade feed — doc-driven contract tests.
 *
 * Fixtures copied verbatim from the official WS spec:
 *   https://power-trade.github.io/api-docs-source/ws_feeds.html
 *
 * Captured into:
 *   references/options-docs/powertrade/{instrument-sample,top-of-book-pushes,
 *     trade-pushes,reference-price-pushes,risk-snapshot-pushes,subscribe-acks}.json
 *
 * Replace with live captures when the live feed is reachable.
 */
import { describe, expect, it } from 'vitest';
import { parsePowertradeWsMessage } from './codec.js';
import {
  POWERTRADE_OPTION_SYMBOL_RE,
  PowertradeDeliverableOptionEnvelopeSchema,
  PowertradeReferencePriceEnvelopeSchema,
  PowertradeRiskSnapshotEnvelopeSchema,
  PowertradeRteTradeEnvelopeSchema,
  PowertradeSubscribeAckSchema,
  PowertradeSubscribeErrorSchema,
  PowertradeTopOfBookEnvelopeSchema,
  PowertradeUnsubscribeAckSchema,
} from './types.js';

const INSTRUMENT_FIXTURE = {
  deliverable: {
    deliverable_id: '92',
    symbol: 'BTC-20260626-70000C',
    tags: ['BTC', 'option', 'month'],
    decimal_places: '4',
    listing_status: 'active',
    details: {
      option: {
        expiry: {
          datetime: {
            date: { year: '2026', month: '6', day: '26' },
            time: { hours: '8', minutes: '0', seconds: '0', nanoseconds: '0' },
          },
          timezone: 'UTC',
        },
        strike_price: '70000000000',
        option_type: 'call',
        exercise_style: 'european',
        valuation_approach: 'vanilla',
        delivery_style: 'cash',
        underlying_deliverable_id: '3',
        contract_size_deliverable_id: '3',
        contract_size: '100000000',
        settlement_deliverable_id: '2',
        utc_creation_time: '1745366400000000000',
        creation_source_id: '0',
        margin_spec_id: '1',
        strikes_spec_id: '1',
      },
    },
  },
};

const TOP_OF_BOOK_FIXTURE = {
  top_of_book: {
    timestamp: '1745366400000000000',
    tradeable_entity_id: '10835',
    market_id: '0',
    symbol: 'BTC-20260626-70000C',
    best_bid_price: '2677.10',
    best_bid_quantity: '0.5',
    best_ask_price: '2741.69',
    best_ask_quantity: '0.5',
  },
};

const RTE_TRADE_FIXTURE = {
  rte_trade: {
    timestamp: '1745366400000000000',
    symbol: 'BTC-20260626-70000C',
    tradeable_entity_id: '10835',
    market_id: '0',
    trade_id: '1234567',
    price: '2717.04',
    price_type: 'passive',
    quantity: '0.06',
    quantity_in_underlying: '0.06',
    buy_display_order_id: '777',
    sell_display_order_id: '777',
  },
};

const REFERENCE_PRICE_FIXTURE = {
  reference_price: {
    timestamp: '1745366400000000000',
    tradeable_entity_id: '10835',
    market_id: '0',
    symbol: 'BTC-20260626-70000C',
    price: '2717.04',
    price_type: 'reference',
  },
};

const RISK_SNAPSHOT_FIXTURE = {
  risk_snapshot: {
    symbol: 'BTC-20260626-70000C',
    tradeable_entity_id: '10835',
    market_id: '0',
    timestamp: '1745366400000000000',
    time_to_expire: '0.179',
    theoretical: null,
    mid: {
      price: '2717.04',
      volatility: '0.7132',
      greeks: {
        delta: '0.334122',
        vega: '77.011051',
        theta: '-26.766029',
        rho: '3013.044691',
        gamma: '0.009467',
      },
    },
    bid: {
      price: '2677.10',
      volatility: '0.7089',
      greeks: {
        delta: '0.331613',
        vega: '76.753915',
        theta: '-26.454029',
        rho: '2996.165119',
        gamma: '0.009492',
      },
    },
    ask: {
      price: '2741.69',
      volatility: '0.7165',
      greeks: {
        delta: '0.335436',
        vega: '77.128658',
        theta: '-26.920926',
        rho: '3020.792592',
        gamma: '0.009437',
      },
    },
  },
};

const SUBSCRIBE_ACK_FIXTURE = {
  subscribed: { tradeable_entity_id: '10835', symbol: 'BTC-20260626-70000C' },
};
const SUBSCRIBE_ERROR_FIXTURE = { subscribe_error: { message: 'Already subscribed' } };
const UNSUBSCRIBE_ACK_FIXTURE = { unsubscribed: { tradeable_entity_id: '10835' } };

describe('PowerTrade types', () => {
  it('accepts a deliverable<option> envelope', () => {
    const r = PowertradeDeliverableOptionEnvelopeSchema.safeParse(INSTRUMENT_FIXTURE);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.deliverable.symbol).toBe('BTC-20260626-70000C');
      expect(r.data.deliverable.details.option.option_type).toBe('call');
      expect(r.data.deliverable.details.option.exercise_style).toBe('european');
    }
  });

  it('accepts top_of_book', () => {
    expect(PowertradeTopOfBookEnvelopeSchema.safeParse(TOP_OF_BOOK_FIXTURE).success).toBe(true);
  });

  it('accepts rte_trade', () => {
    expect(PowertradeRteTradeEnvelopeSchema.safeParse(RTE_TRADE_FIXTURE).success).toBe(true);
  });

  it('accepts reference_price', () => {
    expect(PowertradeReferencePriceEnvelopeSchema.safeParse(REFERENCE_PRICE_FIXTURE).success).toBe(true);
  });

  it('accepts risk_snapshot with greeks at bid/mid/ask', () => {
    const r = PowertradeRiskSnapshotEnvelopeSchema.safeParse(RISK_SNAPSHOT_FIXTURE);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.risk_snapshot.mid?.greeks.delta).toBe('0.334122');
      expect(r.data.risk_snapshot.bid?.volatility).toBe('0.7089');
    }
  });

  it('accepts a subscribe ack and an unsubscribe ack', () => {
    expect(PowertradeSubscribeAckSchema.safeParse(SUBSCRIBE_ACK_FIXTURE).success).toBe(true);
    expect(PowertradeUnsubscribeAckSchema.safeParse(UNSUBSCRIBE_ACK_FIXTURE).success).toBe(true);
  });

  it('accepts a subscribe_error envelope', () => {
    expect(PowertradeSubscribeErrorSchema.safeParse(SUBSCRIBE_ERROR_FIXTURE).success).toBe(true);
  });
});

describe('PowerTrade WS dispatcher', () => {
  it('routes deliverable<option>', () => {
    expect(parsePowertradeWsMessage(INSTRUMENT_FIXTURE).kind).toBe('option');
  });
  it('routes top_of_book', () => {
    expect(parsePowertradeWsMessage(TOP_OF_BOOK_FIXTURE).kind).toBe('top_of_book');
  });
  it('routes rte_trade', () => {
    expect(parsePowertradeWsMessage(RTE_TRADE_FIXTURE).kind).toBe('trade');
  });
  it('routes reference_price', () => {
    expect(parsePowertradeWsMessage(REFERENCE_PRICE_FIXTURE).kind).toBe('reference_price');
  });
  it('routes risk_snapshot', () => {
    expect(parsePowertradeWsMessage(RISK_SNAPSHOT_FIXTURE).kind).toBe('risk');
  });
  it('routes subscribe ack', () => {
    expect(parsePowertradeWsMessage(SUBSCRIBE_ACK_FIXTURE).kind).toBe('subscribed');
  });
  it('routes subscribe_error', () => {
    expect(parsePowertradeWsMessage(SUBSCRIBE_ERROR_FIXTURE).kind).toBe('subscribe_error');
  });
  it('returns unknown for arbitrary JSON', () => {
    expect(parsePowertradeWsMessage({ hello: 'world' }).kind).toBe('unknown');
  });
});

describe('PowerTrade symbol regex', () => {
  it('matches a BTC call', () => {
    const m = POWERTRADE_OPTION_SYMBOL_RE.exec('BTC-20260626-70000C');
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe('BTC');
    expect(m?.[2]).toBe('20260626');
    expect(m?.[3]).toBe('70000');
    expect(m?.[4]).toBe('C');
  });

  it('matches an ETH put', () => {
    const m = POWERTRADE_OPTION_SYMBOL_RE.exec('ETH-20221230-2200P');
    expect(m).not.toBeNull();
    expect(m?.[4]).toBe('P');
  });

  it('matches a SOL strike with decimals encoded as integer', () => {
    const m = POWERTRADE_OPTION_SYMBOL_RE.exec('SOL-20260925-150C');
    expect(m).not.toBeNull();
    expect(m?.[3]).toBe('150');
  });

  it('rejects perpetuals or futures', () => {
    expect(POWERTRADE_OPTION_SYMBOL_RE.exec('BTC-PERPETUAL')).toBeNull();
    expect(POWERTRADE_OPTION_SYMBOL_RE.exec('BTC-20260626')).toBeNull();
  });

  it('rejects Deribit/Thalex-style with dash before C/P', () => {
    expect(POWERTRADE_OPTION_SYMBOL_RE.exec('BTC-20260626-70000-C')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test — confirm it fails**

Run: `pnpm --filter @oggregator/core test -- powertrade/types`
Expected: FAIL with "Cannot find module './types.js'" or "./codec.js".

- [ ] **Step 4: Implement `types.ts`**

Create `packages/core/src/feeds/powertrade/types.ts`:

```ts
import { z } from 'zod';

// ── Common primitives ─────────────────────────────────────────────
// PowerTrade encodes nanoseconds, prices, sizes, ids and decimal counts as
// strings. RTE message variants additionally include `symbol` and provide
// human-readable decimal numbers (still wrapped in strings).
const NumericString = z.string();

const PowertradeExpiryDate = z.object({
  year: z.string(),
  month: z.string(),
  day: z.string(),
});
const PowertradeExpiryTime = z.object({
  hours: z.string(),
  minutes: z.string(),
  seconds: z.string(),
  nanoseconds: z.string().optional(),
});
const PowertradeExpiryDatetime = z.object({
  date: PowertradeExpiryDate,
  time: PowertradeExpiryTime,
});
const PowertradeExpirySchema = z.object({
  datetime: PowertradeExpiryDatetime,
  timezone: z.string().optional(),
});

// ── Reference data: deliverable<option> ───────────────────────────
// Source: ws_feeds.html "Reference Data".
// strike_price arrives as integer-scaled by underlying decimals (typically 6
// for BTC → multiply by 10^-6 to get the human value). RTE messages use
// the human-decimal price, but reference data does not. state.ts handles
// scaling using `decimal_places` on the deliverable.

export const PowertradeOptionDetailsSchema = z.object({
  expiry: PowertradeExpirySchema,
  strike_price: NumericString,
  option_type: z.enum(['call', 'put']),
  exercise_style: z.string().optional(),
  valuation_approach: z.string().optional(),
  delivery_style: z.string().optional(),
  underlying_deliverable_id: NumericString,
  contract_size_deliverable_id: NumericString.optional(),
  contract_size: NumericString.optional(),
  settlement_deliverable_id: NumericString.optional(),
  utc_creation_time: NumericString.optional(),
  creation_source_id: NumericString.optional(),
  margin_spec_id: NumericString.optional(),
  strikes_spec_id: NumericString.optional(),
});

export const PowertradeDeliverableOptionSchema = z.object({
  deliverable_id: NumericString,
  symbol: z.string(),
  tags: z.array(z.string()).optional(),
  decimal_places: NumericString.optional(),
  listing_status: z.string().optional(),
  details: z.object({ option: PowertradeOptionDetailsSchema }),
});

export const PowertradeDeliverableOptionEnvelopeSchema = z.object({
  deliverable: PowertradeDeliverableOptionSchema,
});
export type PowertradeDeliverableOption = z.infer<typeof PowertradeDeliverableOptionSchema>;

// ── Live: top_of_book ─────────────────────────────────────────────
// Per-symbol best bid/ask. `symbol` field appears on both raw + RTE for
// top_of_book — verified against the spec's example envelope.

export const PowertradeTopOfBookSchema = z.object({
  timestamp: NumericString,
  tradeable_entity_id: NumericString,
  market_id: NumericString,
  symbol: z.string(),
  best_bid_price: NumericString.nullable().optional(),
  best_bid_quantity: NumericString.nullable().optional(),
  best_ask_price: NumericString.nullable().optional(),
  best_ask_quantity: NumericString.nullable().optional(),
});
export const PowertradeTopOfBookEnvelopeSchema = z.object({ top_of_book: PowertradeTopOfBookSchema });
export type PowertradeTopOfBook = z.infer<typeof PowertradeTopOfBookSchema>;

// ── Live: rte_trade ───────────────────────────────────────────────
// RTE variant — decimalised numbers, includes symbol. The non-RTE variant
// uses integer-scaled fields; we never subscribe to it.

export const PowertradeRteTradeSchema = z.object({
  timestamp: NumericString,
  symbol: z.string(),
  tradeable_entity_id: NumericString,
  market_id: NumericString,
  trade_id: NumericString,
  price: NumericString,
  price_type: z.string().optional(),
  quantity: NumericString,
  quantity_in_underlying: NumericString.optional(),
  buy_display_order_id: NumericString.optional(),
  sell_display_order_id: NumericString.optional(),
});
export const PowertradeRteTradeEnvelopeSchema = z.object({ rte_trade: PowertradeRteTradeSchema });
export type PowertradeRteTrade = z.infer<typeof PowertradeRteTradeSchema>;

// ── Live: reference_price ─────────────────────────────────────────
// Mark price. PowerTrade calls it `reference_price`. The non-RTE variant
// is integer-scaled — we use the decimalised RTE channel where available;
// the schema below tolerates both since the field shape is identical.

export const PowertradeReferencePriceSchema = z.object({
  timestamp: NumericString,
  tradeable_entity_id: NumericString,
  market_id: NumericString.optional(),
  symbol: z.string().optional(),
  price: NumericString,
  price_type: z.string().optional(),
});
export const PowertradeReferencePriceEnvelopeSchema = z.object({
  reference_price: PowertradeReferencePriceSchema,
});
export type PowertradeReferencePrice = z.infer<typeof PowertradeReferencePriceSchema>;

// ── Live: risk_snapshot ───────────────────────────────────────────
// Greeks + IV at mid/bid/ask. Best greeks fidelity in the project.

const PowertradeGreeksSchema = z.object({
  delta: NumericString.nullable().optional(),
  vega: NumericString.nullable().optional(),
  theta: NumericString.nullable().optional(),
  rho: NumericString.nullable().optional(),
  gamma: NumericString.nullable().optional(),
});
const PowertradeRiskLegSchema = z.object({
  price: NumericString.nullable().optional(),
  volatility: NumericString.nullable().optional(),
  greeks: PowertradeGreeksSchema,
});
export const PowertradeRiskSnapshotSchema = z.object({
  symbol: z.string(),
  tradeable_entity_id: NumericString,
  market_id: NumericString.optional(),
  timestamp: NumericString,
  time_to_expire: NumericString.optional(),
  theoretical: PowertradeRiskLegSchema.nullable().optional(),
  mid: PowertradeRiskLegSchema.nullable().optional(),
  bid: PowertradeRiskLegSchema.nullable().optional(),
  ask: PowertradeRiskLegSchema.nullable().optional(),
});
export const PowertradeRiskSnapshotEnvelopeSchema = z.object({
  risk_snapshot: PowertradeRiskSnapshotSchema,
});
export type PowertradeRiskSnapshot = z.infer<typeof PowertradeRiskSnapshotSchema>;

// ── Subscribe / unsubscribe envelopes ─────────────────────────────

export const PowertradeSubscribeAckSchema = z.object({
  subscribed: z.object({
    tradeable_entity_id: NumericString.optional(),
    symbol: z.string().optional(),
  }),
});
export type PowertradeSubscribeAck = z.infer<typeof PowertradeSubscribeAckSchema>;

export const PowertradeUnsubscribeAckSchema = z.object({
  unsubscribed: z.object({
    tradeable_entity_id: NumericString.optional(),
    symbol: z.string().optional(),
  }),
});
export type PowertradeUnsubscribeAck = z.infer<typeof PowertradeUnsubscribeAckSchema>;

export const PowertradeSubscribeErrorSchema = z.object({
  subscribe_error: z.object({ message: z.string() }),
});
export type PowertradeSubscribeError = z.infer<typeof PowertradeSubscribeErrorSchema>;

// ── REST: /v1/market_data/currency/all/summary (health probe) ─────

export const PowertradeCurrencySummaryRowSchema = z.object({
  symbol: z.string().optional(),
  id: NumericString.optional(),
  volume: NumericString.optional(),
  open_interest: NumericString.optional(),
  index_price: NumericString.optional(),
});
export const PowertradeCurrencyAllSummarySchema = z.array(PowertradeCurrencySummaryRowSchema);
export type PowertradeCurrencyAllSummary = z.infer<typeof PowertradeCurrencyAllSummarySchema>;

// ── Native option symbol regex ────────────────────────────────────
// Format: {BASE}-{YYYYMMDD}-{STRIKE}{C|P}.
//   - No dash between strike and right (unlike Deribit/Thalex).
//   - YYYY-only date prefix (8 digits, distinguishes from Coincall DDMMMYY).
//   - Strike is digits + optional decimal point. PowerTrade typically uses
//     integer strikes; the regex tolerates `1500.5` for safety.
//   - Base capped at 6 chars to allow longer-named altcoins (e.g. SHIB).
export const POWERTRADE_OPTION_SYMBOL_RE = /^([A-Z]{2,6})-(\d{8})-([\d.]+)([CP])$/;
```

- [ ] **Step 5: Add a stub `codec.ts` so the dispatcher import resolves**

Create `packages/core/src/feeds/powertrade/codec.ts`:

```ts
// stub — full implementation in Task 4
import {
  PowertradeDeliverableOptionEnvelopeSchema,
  PowertradeReferencePriceEnvelopeSchema,
  PowertradeRiskSnapshotEnvelopeSchema,
  PowertradeRteTradeEnvelopeSchema,
  PowertradeSubscribeAckSchema,
  PowertradeSubscribeErrorSchema,
  PowertradeTopOfBookEnvelopeSchema,
  PowertradeUnsubscribeAckSchema,
  type PowertradeDeliverableOption,
  type PowertradeReferencePrice,
  type PowertradeRiskSnapshot,
  type PowertradeRteTrade,
  type PowertradeSubscribeAck,
  type PowertradeSubscribeError,
  type PowertradeTopOfBook,
  type PowertradeUnsubscribeAck,
} from './types.js';

export type PowertradeWsDispatch =
  | { kind: 'option'; message: PowertradeDeliverableOption }
  | { kind: 'top_of_book'; message: PowertradeTopOfBook }
  | { kind: 'trade'; message: PowertradeRteTrade }
  | { kind: 'reference_price'; message: PowertradeReferencePrice }
  | { kind: 'risk'; message: PowertradeRiskSnapshot }
  | { kind: 'subscribed'; message: PowertradeSubscribeAck }
  | { kind: 'unsubscribed'; message: PowertradeUnsubscribeAck }
  | { kind: 'subscribe_error'; message: PowertradeSubscribeError }
  | { kind: 'unknown'; raw: unknown };

export function parsePowertradeWsMessage(input: unknown): PowertradeWsDispatch {
  if (input == null || typeof input !== 'object') return { kind: 'unknown', raw: input };
  const obj = input as Record<string, unknown>;

  if ('deliverable' in obj) {
    const r = PowertradeDeliverableOptionEnvelopeSchema.safeParse(input);
    if (r.success) return { kind: 'option', message: r.data.deliverable };
  }
  if ('top_of_book' in obj) {
    const r = PowertradeTopOfBookEnvelopeSchema.safeParse(input);
    if (r.success) return { kind: 'top_of_book', message: r.data.top_of_book };
  }
  if ('rte_trade' in obj) {
    const r = PowertradeRteTradeEnvelopeSchema.safeParse(input);
    if (r.success) return { kind: 'trade', message: r.data.rte_trade };
  }
  if ('reference_price' in obj) {
    const r = PowertradeReferencePriceEnvelopeSchema.safeParse(input);
    if (r.success) return { kind: 'reference_price', message: r.data.reference_price };
  }
  if ('risk_snapshot' in obj) {
    const r = PowertradeRiskSnapshotEnvelopeSchema.safeParse(input);
    if (r.success) return { kind: 'risk', message: r.data.risk_snapshot };
  }
  if ('subscribed' in obj) {
    const r = PowertradeSubscribeAckSchema.safeParse(input);
    if (r.success) return { kind: 'subscribed', message: r.data };
  }
  if ('unsubscribed' in obj) {
    const r = PowertradeUnsubscribeAckSchema.safeParse(input);
    if (r.success) return { kind: 'unsubscribed', message: r.data };
  }
  if ('subscribe_error' in obj) {
    const r = PowertradeSubscribeErrorSchema.safeParse(input);
    if (r.success) return { kind: 'subscribe_error', message: r.data };
  }
  return { kind: 'unknown', raw: input };
}
```

- [ ] **Step 6: Re-run the test — confirm it passes**

Run: `pnpm --filter @oggregator/core test -- powertrade/types`
Expected: PASS, all 19 tests green.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/feeds/powertrade/types.ts \
        packages/core/src/feeds/powertrade/codec.ts \
        packages/core/src/feeds/powertrade/types.test.ts \
        references/options-docs/powertrade/instrument-sample.json \
        references/options-docs/powertrade/top-of-book-pushes.json \
        references/options-docs/powertrade/trade-pushes.json \
        references/options-docs/powertrade/reference-price-pushes.json \
        references/options-docs/powertrade/risk-snapshot-pushes.json \
        references/options-docs/powertrade/subscribe-acks.json
git commit -m "feat(core/powertrade): zod schemas, dispatcher, native symbol regex"
```

---

## Task 4 — Live WS connectivity probe (smoke check)

**Files:**
- Create: `packages/core/src/feeds/powertrade/__probes__/ws-probe.ts` (gitignored — local only)

This task is a one-off check, NOT a unit test. The goal is to confirm the public WS accepts our connection BEFORE we wire dependencies on top.

- [ ] **Step 1: Write the probe**

Create `packages/core/src/feeds/powertrade/__probes__/ws-probe.ts`:

```ts
import WebSocket from 'ws';

const URL =
  'wss://api.wss.prod.power.trade/v1/feeds' +
  '?type[]=all_rte&type[]=risk&type[]=subscriptions_status' +
  '&tradeable_type[]=option&snapshot_depth=5';

const ws = new WebSocket(URL);
let messageCount = 0;
const start = Date.now();

ws.on('open', () => {
  console.log('connected, sending subscribe BTC');
  ws.send(JSON.stringify({ subscribe: { symbol_prefix: 'BTC-2026' } }));
});

ws.on('message', (data) => {
  messageCount++;
  if (messageCount <= 3) {
    console.log('frame', messageCount, String(data).slice(0, 400));
  }
  if (messageCount >= 50 || Date.now() - start > 15_000) {
    console.log(`probe done — ${messageCount} frames in ${Date.now() - start}ms`);
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (err) => {
  console.error('probe failed:', err.message);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  console.log('closed', code, reason.toString());
  process.exit(messageCount === 0 ? 1 : 0);
});
```

- [ ] **Step 2: Add to .gitignore**

Run: `echo 'packages/core/src/feeds/powertrade/__probes__/' >> .gitignore`

- [ ] **Step 3: Run the probe**

Run: `node --experimental-strip-types packages/core/src/feeds/powertrade/__probes__/ws-probe.ts`
Expected: at least one `top_of_book` frame within 15s. Capture the raw frames into the corresponding `references/options-docs/powertrade/*.json` fixture files (overwriting the doc-only fixtures from Task 3).

- [ ] **Step 4 (only if probe fails with 401/403/451):** stop and ask the user to email support@power.trade for IP enablement. Do NOT proceed to Task 5.

- [ ] **Step 5 (only if probe succeeds):** if real frames arrived, re-run Task 3 tests to make sure the fixtures from live still parse — they should, but if any field type drifted (e.g. nullability), update the schema and commit:

```bash
pnpm --filter @oggregator/core test -- powertrade/types
git add references/options-docs/powertrade/ packages/core/src/feeds/powertrade/types.ts
git commit -m "chore(core/powertrade): refresh fixtures from live capture"
```

---

## Task 5 — Instrument builder + quote merger (TDD)

**Files:**
- Create: `packages/core/src/feeds/powertrade/state.ts`
- Create: `packages/core/src/feeds/powertrade/state.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/feeds/powertrade/state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EMPTY_GREEKS } from '../../core/types.js';
import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import {
  buildPowertradeInstrument,
  decodeStrikeFromInteger,
  mergePowertradeReferencePrice,
  mergePowertradeRiskSnapshot,
  mergePowertradeTopOfBook,
  mergePowertradeTrade,
} from './state.js';

const INSTRUMENT_FIXTURE = {
  deliverable_id: '92',
  symbol: 'BTC-20260626-70000C',
  tags: ['BTC', 'option'],
  decimal_places: '4',
  listing_status: 'active',
  details: {
    option: {
      expiry: {
        datetime: {
          date: { year: '2026', month: '6', day: '26' },
          time: { hours: '8', minutes: '0', seconds: '0', nanoseconds: '0' },
        },
        timezone: 'UTC',
      },
      strike_price: '70000000000',
      option_type: 'call' as const,
      exercise_style: 'european',
      delivery_style: 'cash',
      underlying_deliverable_id: '3',
      contract_size_deliverable_id: '3',
      contract_size: '100000000',
      settlement_deliverable_id: '2',
    },
  },
};

const DEPS = {
  buildCanonicalSymbol: (b: string, s: string, e: string, k: number, r: 'call' | 'put') => {
    const yy = e.slice(2, 4);
    const mm = e.slice(5, 7);
    const dd = e.slice(8, 10);
    return `${b}/USD:${s}-${yy}${mm}${dd}-${k}-${r === 'call' ? 'C' : 'P'}`;
  },
  // PowerTrade scaling: BTC underlying decimal_places = 6 (1 BTC = 100_000_000 sats / 100). Tests use 6.
  underlyingDecimals: (id: string) => (id === '3' ? 6 : 8),
};

function emptyQuote(): LiveQuote {
  return {
    bidPrice: null, askPrice: null, bidSize: null, askSize: null,
    markPrice: null, lastPrice: null, underlyingPrice: null, indexPrice: null,
    volume24h: null, openInterest: null, openInterestUsd: null, volume24hUsd: null,
    greeks: { ...EMPTY_GREEKS }, timestamp: 0,
  };
}

describe('decodeStrikeFromInteger', () => {
  it('divides by 10^underlyingDecimals', () => {
    expect(decodeStrikeFromInteger('70000000000', 6)).toBe(70000);
  });
  it('handles missing decimals by returning the raw float', () => {
    expect(decodeStrikeFromInteger('70000', 0)).toBe(70000);
  });
  it('returns null for non-numeric strings', () => {
    expect(decodeStrikeFromInteger('abc', 6)).toBeNull();
  });
});

describe('buildPowertradeInstrument', () => {
  it('produces a CachedInstrument from a deliverable<option>', () => {
    const inst = buildPowertradeInstrument(INSTRUMENT_FIXTURE, DEPS);
    expect(inst).not.toBeNull();
    expect(inst!.exchangeSymbol).toBe('BTC-20260626-70000C');
    expect(inst!.symbol).toBe('BTC/USD:USDC-260626-70000-C');
    expect(inst!.base).toBe('BTC');
    expect(inst!.quote).toBe('USD');
    expect(inst!.settle).toBe('USDC');
    expect(inst!.expiry).toBe('2026-06-26');
    expect(inst!.strike).toBe(70000);
    expect(inst!.right).toBe('call');
    expect(inst!.inverse).toBe(false);
    expect(inst!.contractSize).toBe(1);
    expect(inst!.contractValueCurrency).toBe('BTC');
    expect(inst!.makerFee).toBeNull();
    expect(inst!.takerFee).toBeNull();
  });

  it('parses expirationTimestamp from the structured datetime (UTC)', () => {
    const inst = buildPowertradeInstrument(INSTRUMENT_FIXTURE, DEPS);
    expect(inst!.expirationTimestamp).toBe(Date.UTC(2026, 5, 26, 8, 0, 0));
  });

  it('returns null when symbol regex does not match', () => {
    const bad = { ...INSTRUMENT_FIXTURE, symbol: 'BTC-PERPETUAL' };
    expect(buildPowertradeInstrument(bad, DEPS)).toBeNull();
  });
});

describe('mergePowertradeTopOfBook', () => {
  it('writes bid/ask price+size and timestamp', () => {
    const next = mergePowertradeTopOfBook(
      {
        timestamp: '1745366400000000000',
        tradeable_entity_id: '10835',
        market_id: '0',
        symbol: 'BTC-20260626-70000C',
        best_bid_price: '2677.10',
        best_bid_quantity: '0.5',
        best_ask_price: '2741.69',
        best_ask_quantity: '0.5',
      },
      undefined,
      emptyQuote(),
    );
    expect(next.bidPrice).toBe(2677.10);
    expect(next.askSize).toBe(0.5);
    expect(next.timestamp).toBe(1745366400000); // ns → ms
  });
});

describe('mergePowertradeTrade', () => {
  it('writes lastPrice and adds to volume24h', () => {
    const prev: LiveQuote = { ...emptyQuote(), volume24h: 0.1 };
    const next = mergePowertradeTrade(
      {
        timestamp: '1745366400000000000',
        symbol: 'BTC-20260626-70000C',
        tradeable_entity_id: '10835',
        market_id: '0',
        trade_id: '1',
        price: '2717.04',
        quantity: '0.06',
      },
      prev,
      emptyQuote(),
    );
    expect(next.lastPrice).toBe(2717.04);
    // Volume is left to the venue's 24h summary REST refresh; per-trade
    // accumulation is intentionally NOT done here (matches Coincall).
    expect(next.volume24h).toBe(0.1);
  });
});

describe('mergePowertradeReferencePrice', () => {
  it('writes markPrice', () => {
    const next = mergePowertradeReferencePrice(
      {
        timestamp: '1745366400000000000',
        tradeable_entity_id: '10835',
        price: '2717.04',
        price_type: 'reference',
      },
      undefined,
      emptyQuote(),
    );
    expect(next.markPrice).toBe(2717.04);
  });
});

describe('mergePowertradeRiskSnapshot', () => {
  it('writes greeks at mid plus bidIv/askIv', () => {
    const next = mergePowertradeRiskSnapshot(
      {
        symbol: 'BTC-20260626-70000C',
        tradeable_entity_id: '10835',
        timestamp: '1745366400000000000',
        time_to_expire: '0.179',
        theoretical: null,
        mid: {
          price: '2717.04', volatility: '0.7132',
          greeks: { delta: '0.334', gamma: '0.009', vega: '77.0', theta: '-26.7', rho: '3013.0' },
        },
        bid: {
          price: '2677.10', volatility: '0.7089',
          greeks: { delta: '0.331', gamma: '0.009', vega: '76.7', theta: '-26.4', rho: '2996.0' },
        },
        ask: {
          price: '2741.69', volatility: '0.7165',
          greeks: { delta: '0.335', gamma: '0.009', vega: '77.1', theta: '-26.9', rho: '3020.0' },
        },
      },
      undefined,
      emptyQuote(),
    );
    expect(next.greeks.delta).toBeCloseTo(0.334, 3);
    expect(next.greeks.markIv).toBeCloseTo(0.7132, 4);
    expect(next.greeks.bidIv).toBeCloseTo(0.7089, 4);
    expect(next.greeks.askIv).toBeCloseTo(0.7165, 4);
  });

  it('falls back to previous values when a leg is null', () => {
    const prev: LiveQuote = {
      ...emptyQuote(),
      greeks: { ...EMPTY_GREEKS, delta: 0.3, markIv: 0.5 },
    };
    const next = mergePowertradeRiskSnapshot(
      {
        symbol: 'BTC-20260626-70000C',
        tradeable_entity_id: '10835',
        timestamp: '1745366400000000000',
        mid: null,
        bid: null,
        ask: null,
      },
      prev,
      emptyQuote(),
    );
    expect(next.greeks.delta).toBe(0.3);
    expect(next.greeks.markIv).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `pnpm --filter @oggregator/core test -- powertrade/state`
Expected: FAIL with "Cannot find module './state.js'".

- [ ] **Step 3: Implement `state.ts`**

Create `packages/core/src/feeds/powertrade/state.ts`:

```ts
import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import type { OptionRight } from '../../types/common.js';
import {
  POWERTRADE_OPTION_SYMBOL_RE,
  type PowertradeDeliverableOption,
  type PowertradeReferencePrice,
  type PowertradeRiskSnapshot,
  type PowertradeRteTrade,
  type PowertradeTopOfBook,
} from './types.js';

function num(s: string | null | undefined): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function nsToMs(ns: string | null | undefined): number {
  const n = num(ns);
  return n != null ? Math.floor(n / 1_000_000) : Date.now();
}

/**
 * PowerTrade encodes strikes (and most other reference-data prices) as
 * integers scaled by the underlying deliverable's `decimal_places`. For BTC
 * (decimal_places = 6), 70000 is sent as "70000000000".
 */
export function decodeStrikeFromInteger(raw: string, decimals: number): number | null {
  const n = num(raw);
  if (n == null) return null;
  return n / Math.pow(10, decimals);
}

export interface PowertradeInstrumentDeps {
  buildCanonicalSymbol: (
    base: string,
    settle: string,
    expiry: string,
    strike: number,
    right: OptionRight,
  ) => string;
  /**
   * Resolve underlying-asset decimal_places by deliverable_id. The adapter
   * maintains this map from the `deliverable<exchange_token>` /
   * `deliverable<stable_token>` reference frames captured at boot.
   */
  underlyingDecimals: (deliverableId: string) => number;
}

/**
 * Translate a PowerTrade `deliverable<option>` into CachedInstrument.
 *
 * Symbol shape: {BASE}-{YYYYMMDD}-{STRIKE}{C|P} (no dash before C/P).
 * Settlement is always USDC (cash, linear) — the spec's
 * `delivery_style: cash` + `settlement_deliverable_id` pointing at the USDC
 * deliverable. Inverse pricing is never used.
 *
 * Returns null for non-options or malformed symbols.
 */
export function buildPowertradeInstrument(
  d: PowertradeDeliverableOption,
  deps: PowertradeInstrumentDeps,
): CachedInstrument | null {
  const m = POWERTRADE_OPTION_SYMBOL_RE.exec(d.symbol);
  if (!m) return null;

  const base = m[1]!;
  const right: OptionRight = m[4] === 'C' ? 'call' : 'put';

  const decimals = deps.underlyingDecimals(d.details.option.underlying_deliverable_id);
  const strike = decodeStrikeFromInteger(d.details.option.strike_price, decimals);
  if (strike == null || strike <= 0) return null;

  // Compose UTC ms from the structured datetime — PowerTrade does NOT send
  // a unix timestamp on the option deliverable.
  const dt = d.details.option.expiry.datetime;
  const expiryDate = `${dt.date.year}-${dt.date.month.padStart(2, '0')}-${dt.date.day.padStart(2, '0')}`;
  const expirationTimestamp = Date.UTC(
    Number(dt.date.year),
    Number(dt.date.month) - 1,
    Number(dt.date.day),
    Number(dt.time.hours ?? '0'),
    Number(dt.time.minutes ?? '0'),
    Number(dt.time.seconds ?? '0'),
  );

  const settle = 'USDC';
  const symbol = deps.buildCanonicalSymbol(base, settle, expiryDate, strike, right);

  return {
    symbol,
    exchangeSymbol: d.symbol,
    base,
    quote: 'USD',
    settle,
    expiry: expiryDate,
    expirationTimestamp,
    strike,
    right,
    inverse: false,
    contractSize: 1,
    // Contract is sized in base currency (BTC/ETH/SOL units), premium settles
    // in USDC. Same shape as Thalex — see normalizeOpenInterestUsd in sdk-base.
    contractValueCurrency: base,
    tickSize: null,
    minQty: null,
    // PowerTrade fees are tiered per account — FEE_CAP guards downstream.
    makerFee: null,
    takerFee: null,
  };
}

// ── Live quote merges ─────────────────────────────────────────────

export function mergePowertradeTopOfBook(
  t: PowertradeTopOfBook,
  previous: LiveQuote | undefined,
  empty: LiveQuote,
): LiveQuote {
  const base = previous ?? empty;
  return {
    ...base,
    bidPrice: num(t.best_bid_price ?? null) ?? base.bidPrice,
    bidSize: num(t.best_bid_quantity ?? null) ?? base.bidSize,
    askPrice: num(t.best_ask_price ?? null) ?? base.askPrice,
    askSize: num(t.best_ask_quantity ?? null) ?? base.askSize,
    timestamp: nsToMs(t.timestamp),
  };
}

export function mergePowertradeTrade(
  t: PowertradeRteTrade,
  previous: LiveQuote | undefined,
  empty: LiveQuote,
): LiveQuote {
  const base = previous ?? empty;
  return {
    ...base,
    lastPrice: num(t.price) ?? base.lastPrice,
    timestamp: nsToMs(t.timestamp),
  };
}

export function mergePowertradeReferencePrice(
  p: PowertradeReferencePrice,
  previous: LiveQuote | undefined,
  empty: LiveQuote,
): LiveQuote {
  const base = previous ?? empty;
  return {
    ...base,
    markPrice: num(p.price) ?? base.markPrice,
    timestamp: nsToMs(p.timestamp),
  };
}

/**
 * PowerTrade `risk_snapshot` carries greeks + IV at three legs (mid/bid/ask).
 * We mirror Thalex/Deribit conventions: mid greeks → primary greeks; bid IV →
 * greeks.bidIv; ask IV → greeks.askIv. When a leg is null we keep the
 * previous-quote value (don't blank existing data).
 */
export function mergePowertradeRiskSnapshot(
  r: PowertradeRiskSnapshot,
  previous: LiveQuote | undefined,
  empty: LiveQuote,
): LiveQuote {
  const base = previous ?? empty;

  const mid = r.mid;
  const bid = r.bid;
  const ask = r.ask;

  return {
    ...base,
    greeks: {
      delta: num(mid?.greeks.delta ?? null) ?? base.greeks.delta,
      gamma: num(mid?.greeks.gamma ?? null) ?? base.greeks.gamma,
      theta: num(mid?.greeks.theta ?? null) ?? base.greeks.theta,
      vega: num(mid?.greeks.vega ?? null) ?? base.greeks.vega,
      rho: num(mid?.greeks.rho ?? null) ?? base.greeks.rho,
      markIv: num(mid?.volatility ?? null) ?? base.greeks.markIv,
      bidIv: num(bid?.volatility ?? null) ?? base.greeks.bidIv,
      askIv: num(ask?.volatility ?? null) ?? base.greeks.askIv,
    },
    timestamp: nsToMs(r.timestamp),
  };
}
```

- [ ] **Step 4: Re-run tests — confirm they pass**

Run: `pnpm --filter @oggregator/core test -- powertrade/state`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/feeds/powertrade/state.ts \
        packages/core/src/feeds/powertrade/state.test.ts
git commit -m "feat(core/powertrade): instrument builder + quote mergers"
```

---

## Task 6 — Subscription planner (TDD)

**Files:**
- Create: `packages/core/src/feeds/powertrade/planner.ts`
- Create: `packages/core/src/feeds/powertrade/planner.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/feeds/powertrade/planner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildPowertradeSubscribeMessage,
  buildPowertradeUnsubscribeMessage,
  createPowertradeSubscriptionState,
  ensurePowertradeChainSub,
  releasePowertradeChainSub,
  resetPowertradeSubscriptionState,
  symbolPrefixFor,
} from './planner.js';

describe('symbolPrefixFor', () => {
  it('joins base and YYYYMMDD expiry with a dash', () => {
    expect(symbolPrefixFor('BTC', '2026-06-26')).toBe('BTC-20260626');
  });
});

describe('PowerTrade subscription state', () => {
  it('only emits a subscribe the first time a chain is requested', () => {
    const s = createPowertradeSubscriptionState();
    const first = ensurePowertradeChainSub(s, 'BTC', '2026-06-26');
    const second = ensurePowertradeChainSub(s, 'BTC', '2026-06-26');
    expect(first).toBe('BTC-20260626');
    expect(second).toBeNull();
    expect(s.refCounts.get('BTC-20260626')).toBe(2);
  });

  it('only emits an unsubscribe when refcount hits zero', () => {
    const s = createPowertradeSubscriptionState();
    ensurePowertradeChainSub(s, 'BTC', '2026-06-26');
    ensurePowertradeChainSub(s, 'BTC', '2026-06-26');
    expect(releasePowertradeChainSub(s, 'BTC', '2026-06-26')).toBeNull();
    expect(releasePowertradeChainSub(s, 'BTC', '2026-06-26')).toBe('BTC-20260626');
    expect(s.refCounts.has('BTC-20260626')).toBe(false);
  });

  it('builds a {subscribe: {symbol_prefix}} JSON envelope', () => {
    expect(buildPowertradeSubscribeMessage('BTC-20260626')).toEqual({
      subscribe: { symbol_prefix: 'BTC-20260626' },
    });
    expect(buildPowertradeUnsubscribeMessage('BTC-20260626')).toEqual({
      unsubscribe: { symbol_prefix: 'BTC-20260626' },
    });
  });

  it('reset clears all refcounts', () => {
    const s = createPowertradeSubscriptionState();
    ensurePowertradeChainSub(s, 'BTC', '2026-06-26');
    ensurePowertradeChainSub(s, 'ETH', '2026-12-25');
    resetPowertradeSubscriptionState(s);
    expect(s.refCounts.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `pnpm --filter @oggregator/core test -- powertrade/planner`
Expected: FAIL with "Cannot find module './planner.js'".

- [ ] **Step 3: Implement `planner.ts`**

Create `packages/core/src/feeds/powertrade/planner.ts`:

```ts
/**
 * PowerTrade subscriptions are coarse: one `symbol_prefix` covers an entire
 * (underlying, expiry) tuple at once — no per-instrument fan-out is needed.
 * Refcounting on the prefix mirrors the SdkBaseAdapter request refcounting
 * so multiple browser sessions sharing a chain don't double-subscribe.
 */
export interface PowertradeSubscriptionState {
  refCounts: Map<string, number>;
}

export function createPowertradeSubscriptionState(): PowertradeSubscriptionState {
  return { refCounts: new Map<string, number>() };
}

export function symbolPrefixFor(underlying: string, expiry: string): string {
  // expiry is YYYY-MM-DD canonical → strip dashes for PowerTrade's YYYYMMDD.
  return `${underlying.toUpperCase()}-${expiry.replace(/-/g, '')}`;
}

/**
 * Increment the refcount and return the prefix only if this is the first
 * caller (so the adapter knows to send a subscribe over the wire).
 */
export function ensurePowertradeChainSub(
  state: PowertradeSubscriptionState,
  underlying: string,
  expiry: string,
): string | null {
  const prefix = symbolPrefixFor(underlying, expiry);
  const next = (state.refCounts.get(prefix) ?? 0) + 1;
  state.refCounts.set(prefix, next);
  return next === 1 ? prefix : null;
}

/**
 * Decrement and return the prefix only if the refcount has fallen to zero
 * (so the adapter knows to send an unsubscribe).
 */
export function releasePowertradeChainSub(
  state: PowertradeSubscriptionState,
  underlying: string,
  expiry: string,
): string | null {
  const prefix = symbolPrefixFor(underlying, expiry);
  const current = state.refCounts.get(prefix);
  if (current == null) return null;
  if (current <= 1) {
    state.refCounts.delete(prefix);
    return prefix;
  }
  state.refCounts.set(prefix, current - 1);
  return null;
}

export function buildPowertradeSubscribeMessage(prefix: string): Record<string, unknown> {
  return { subscribe: { symbol_prefix: prefix } };
}

export function buildPowertradeUnsubscribeMessage(prefix: string): Record<string, unknown> {
  return { unsubscribe: { symbol_prefix: prefix } };
}

export function resetPowertradeSubscriptionState(state: PowertradeSubscriptionState): void {
  state.refCounts.clear();
}
```

- [ ] **Step 4: Re-run — confirm passing**

Run: `pnpm --filter @oggregator/core test -- powertrade/planner`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/feeds/powertrade/planner.ts \
        packages/core/src/feeds/powertrade/planner.test.ts
git commit -m "feat(core/powertrade): subscription planner with prefix refcounting"
```

---

## Task 7 — Health probe (TDD)

**Files:**
- Create: `packages/core/src/feeds/powertrade/health.ts`
- Create: `packages/core/src/feeds/powertrade/health.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { derivePowertradeHealth } from './health.js';

describe('derivePowertradeHealth', () => {
  it('reports degraded on probe error', () => {
    const r = derivePowertradeHealth(null, 0, new Error('boom'));
    expect(r.status).toBe('degraded');
    expect(r.message).toContain('boom');
  });

  it('reports degraded when summary parse failed', () => {
    const r = derivePowertradeHealth(null, 100);
    expect(r.status).toBe('degraded');
  });

  it('reports degraded when no instruments are loaded', () => {
    const r = derivePowertradeHealth([{ symbol: 'BTC' }], 0);
    expect(r.status).toBe('degraded');
  });

  it('reports connected with summary + instruments', () => {
    const r = derivePowertradeHealth([{ symbol: 'BTC' }, { symbol: 'ETH' }], 250);
    expect(r.status).toBe('connected');
    expect(r.message).toContain('250');
  });
});
```

- [ ] **Step 2: Run — confirm fails**

Run: `pnpm --filter @oggregator/core test -- powertrade/health`
Expected: FAIL.

- [ ] **Step 3: Implement `health.ts`**

```ts
import type { PowertradeCurrencyAllSummary } from './types.js';

export function derivePowertradeHealth(
  summary: PowertradeCurrencyAllSummary | null,
  instrumentCount: number,
  error?: unknown,
): { status: 'connected' | 'degraded'; message: string } {
  if (error != null) {
    return { status: 'degraded', message: `rest probe failed: ${String(error)}` };
  }
  if (summary == null) {
    return { status: 'degraded', message: 'currency summary parse failed' };
  }
  if (instrumentCount <= 0) {
    return { status: 'degraded', message: 'no active option instruments' };
  }
  return {
    status: 'connected',
    message: `${instrumentCount} options across ${summary.length} currencies`,
  };
}
```

- [ ] **Step 4: Confirm tests pass**

Run: `pnpm --filter @oggregator/core test -- powertrade/health`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/feeds/powertrade/health.ts \
        packages/core/src/feeds/powertrade/health.test.ts
git commit -m "feat(core/powertrade): rest health probe"
```

---

## Task 8 — Reference-data bootstrap (deliverables map)

**Files:**
- Modify: `packages/core/src/feeds/powertrade/state.ts` (add `buildUnderlyingDecimalsMap`)
- Modify: `packages/core/src/feeds/powertrade/state.test.ts` (extra cases)
- Modify: `packages/core/src/feeds/powertrade/types.ts` (add `deliverable<exchange_token|stable_token>` schemas)

This task adds the small set of helpers the adapter needs to translate `underlying_deliverable_id` (e.g. `"3"`) into a decimal-place count. PowerTrade returns `deliverable<exchange_token>` and `deliverable<stable_token>` reference frames during the same WS handshake the option deliverables come from. We harvest `decimal_places` from those frames at boot.

- [ ] **Step 1: Add token-deliverable schemas to `types.ts`**

Append to `packages/core/src/feeds/powertrade/types.ts`:

```ts
// ── Reference data: deliverable<exchange_token|stable_token|fiat_currency> ──
// Only `decimal_places` is load-bearing for our purposes; the rest are
// captured loosely so future fields don't break the adapter.

export const PowertradeDeliverableTokenSchema = z.object({
  deliverable_id: NumericString,
  symbol: z.string(),
  decimal_places: NumericString.optional(),
  details: z.unknown(),
});

export const PowertradeDeliverableExchangeTokenEnvelopeSchema = z.object({
  deliverable: PowertradeDeliverableTokenSchema.extend({
    details: z.object({ exchange_token: z.unknown() }),
  }),
});
export const PowertradeDeliverableStableTokenEnvelopeSchema = z.object({
  deliverable: PowertradeDeliverableTokenSchema.extend({
    details: z.object({ stable_token: z.unknown() }),
  }),
});
export type PowertradeDeliverableToken = z.infer<typeof PowertradeDeliverableTokenSchema>;
```

- [ ] **Step 2: Extend the dispatcher in `codec.ts`**

Insert before the `'option'` branch in `parsePowertradeWsMessage`:

```ts
import {
  PowertradeDeliverableExchangeTokenEnvelopeSchema,
  PowertradeDeliverableStableTokenEnvelopeSchema,
  // ...existing imports
  type PowertradeDeliverableToken,
} from './types.js';

// inside PowertradeWsDispatch union, add:
//   | { kind: 'token'; message: PowertradeDeliverableToken }

// inside parsePowertradeWsMessage, after the 'deliverable' check, branch by details key:
if ('deliverable' in obj) {
  const ex = PowertradeDeliverableExchangeTokenEnvelopeSchema.safeParse(input);
  if (ex.success) return { kind: 'token', message: ex.data.deliverable };
  const st = PowertradeDeliverableStableTokenEnvelopeSchema.safeParse(input);
  if (st.success) return { kind: 'token', message: st.data.deliverable };
  const opt = PowertradeDeliverableOptionEnvelopeSchema.safeParse(input);
  if (opt.success) return { kind: 'option', message: opt.data.deliverable };
}
```

- [ ] **Step 3: Add `buildUnderlyingDecimalsMap` to `state.ts`**

```ts
import type { PowertradeDeliverableToken } from './types.js';

/**
 * Aggregate `decimal_places` for every token deliverable seen during the WS
 * handshake. Used to decode integer-scaled strikes back into human values.
 * Falls back to 6 for unknown ids — that's the dominant case for BTC and ETH
 * on PowerTrade and limits damage if a new token appears mid-flight.
 */
export class PowertradeDecimalsMap {
  private map = new Map<string, number>();

  set(token: PowertradeDeliverableToken): void {
    if (token.decimal_places == null) return;
    const n = Number(token.decimal_places);
    if (Number.isFinite(n)) this.map.set(token.deliverable_id, n);
  }

  get(deliverableId: string): number {
    return this.map.get(deliverableId) ?? 6;
  }

  size(): number {
    return this.map.size;
  }
}
```

- [ ] **Step 4: Add tests for `PowertradeDecimalsMap`**

Append to `state.test.ts`:

```ts
import { PowertradeDecimalsMap } from './state.js';

describe('PowertradeDecimalsMap', () => {
  it('records and retrieves decimal_places by deliverable_id', () => {
    const m = new PowertradeDecimalsMap();
    m.set({ deliverable_id: '3', symbol: 'BTC', decimal_places: '6', details: {} });
    expect(m.get('3')).toBe(6);
  });

  it('defaults to 6 for unknown ids', () => {
    const m = new PowertradeDecimalsMap();
    expect(m.get('999')).toBe(6);
  });

  it('skips entries without decimal_places', () => {
    const m = new PowertradeDecimalsMap();
    m.set({ deliverable_id: '7', symbol: 'X', details: {} });
    expect(m.size()).toBe(0);
  });
});
```

- [ ] **Step 5: Verify all powertrade tests pass**

Run: `pnpm --filter @oggregator/core test -- powertrade`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/feeds/powertrade/types.ts \
        packages/core/src/feeds/powertrade/codec.ts \
        packages/core/src/feeds/powertrade/state.ts \
        packages/core/src/feeds/powertrade/state.test.ts
git commit -m "feat(core/powertrade): token-deliverable parsing for strike decimals"
```

---

## Task 9 — Adapter orchestrator (`ws-client.ts`)

**Files:**
- Create: `packages/core/src/feeds/powertrade/ws-client.ts`
- Create: `packages/core/src/feeds/powertrade/index.ts`

This task wires everything together. There's no unit test — the orchestrator is exercised end-to-end in Task 10. We do, however, run typecheck after each major chunk to keep the loop tight.

- [ ] **Step 1: Create the index barrel**

`packages/core/src/feeds/powertrade/index.ts`:

```ts
export { PowertradeWsAdapter } from './ws-client.js';
```

- [ ] **Step 2: Create the adapter class**

`packages/core/src/feeds/powertrade/ws-client.ts`:

```ts
import type WebSocket from 'ws';
import {
  POWERTRADE_CURRENCY_ALL_SUMMARY,
  POWERTRADE_FEEDS_WS_URL,
  POWERTRADE_REST_BASE_URL,
} from '../shared/endpoints.js';
import { SdkBaseAdapter, type CachedInstrument } from '../shared/sdk-base.js';
import { TopicWsClient } from '../shared/topic-ws-client.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import { parsePowertradeWsMessage } from './codec.js';
import { derivePowertradeHealth } from './health.js';
import {
  buildPowertradeSubscribeMessage,
  buildPowertradeUnsubscribeMessage,
  createPowertradeSubscriptionState,
  ensurePowertradeChainSub,
  releasePowertradeChainSub,
  resetPowertradeSubscriptionState,
} from './planner.js';
import {
  PowertradeDecimalsMap,
  buildPowertradeInstrument,
  mergePowertradeReferencePrice,
  mergePowertradeRiskSnapshot,
  mergePowertradeTopOfBook,
  mergePowertradeTrade,
} from './state.js';
import { PowertradeCurrencyAllSummarySchema } from './types.js';

const log = feedLogger('powertrade');

const HEALTH_CHECK_INTERVAL_MS = 60 * 1000;
// PowerTrade's spec doesn't require app-level heartbeats — server pings, the
// `ws` library auto-pongs. No keep-alive timer here.

// Connection params — RTE channels for decimalised numbers, risk for greeks,
// subscriptions_status for ack visibility, and `since_timestamp=0` so the
// server replays the full reference universe at connect.
const WS_QUERY =
  '?type[]=all_rte&type[]=risk&type[]=subscriptions_status' +
  '&tradeable_type[]=option&tradeable_type[]=exchange_token&tradeable_type[]=stable_token' +
  '&snapshot_depth=25&mbp_period=1s&since_timestamp=0';

const SUPPORTED_UNDERLYINGS_FALLBACK = ['BTC', 'ETH', 'SOL'] as const;

interface PendingChainSub {
  underlying: string;
  expiry: string;
}

/**
 * PowerTrade options adapter. Public market data only — no auth.
 *
 * Single WS:
 *   wss://api.wss.prod.power.trade/v1/feeds?type[]=all_rte&type[]=risk&...
 *
 * Reference data (`deliverable<option>`, `deliverable<exchange_token>`,
 * `deliverable<stable_token>`) is replayed on connect via since_timestamp=0.
 * Live channels (`top_of_book`, `rte_trade`, `reference_price`,
 * `risk_snapshot`) flow once we send `{ subscribe: { symbol_prefix } }` for
 * each (underlying, expiry) the chain runtime asks for.
 *
 * Symbol scaling: strikes arrive integer-scaled by the underlying token's
 * decimal_places. The PowertradeDecimalsMap is hydrated from token frames
 * and consulted by buildPowertradeInstrument.
 *
 * No app-level heartbeat. PowerTrade pings the socket; ws auto-pongs.
 */
export class PowertradeWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'powertrade';

  private wsClient: TopicWsClient | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private connectPromise: Promise<void> | null = null;
  private bootstrapDeferred: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  private bootstrapPromise: Promise<void> | null = null;
  private readonly decimals = new PowertradeDecimalsMap();
  private readonly subscriptions = createPowertradeSubscriptionState();
  private readonly pendingChainSubs: PendingChainSub[] = [];

  protected initClients(): void {}

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    // PowerTrade has no REST endpoint that returns option metadata in a usable
    // shape — instrument discovery is the WS reference-data replay. Open the
    // socket, await the bootstrap window, then snapshot what we collected.
    await this.ensureConnected();
    await this.awaitReferenceDataBootstrap();

    log.info({ count: this.instruments.length }, 'loaded option instruments');
    this.healthTimer = setInterval(() => {
      void this.refreshHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
    void this.refreshHealth();
    return this.instruments;
  }

  // ── reference-data bootstrap window ──────────────────────────
  // PowerTrade sends `cycle_ended` after the historical replay completes.
  // Until we see it (or we hit a 10s safety timeout), accumulate option
  // deliverables into the cache. Tokens are accumulated continuously.

  private awaitReferenceDataBootstrap(): Promise<void> {
    if (this.bootstrapPromise != null) return this.bootstrapPromise;
    this.bootstrapPromise = new Promise<void>((resolve, reject) => {
      this.bootstrapDeferred = { resolve, reject };
      const safety = setTimeout(() => {
        if (this.bootstrapDeferred != null) {
          log.warn(
            { instruments: this.instruments.length },
            'bootstrap window timed out, proceeding with what we have',
          );
          const d = this.bootstrapDeferred;
          this.bootstrapDeferred = null;
          d.resolve();
        }
      }, 15_000);
      // unref so a stuck bootstrap doesn't block process exit
      safety.unref?.();
    });
    return this.bootstrapPromise;
  }

  private completeBootstrap(): void {
    const d = this.bootstrapDeferred;
    if (d == null) return;
    this.bootstrapDeferred = null;
    d.resolve();
  }

  // ── subscribe / unsubscribe ──────────────────────────────────

  protected async subscribeChain(
    underlying: string,
    expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    if (instruments.length === 0) return;
    await this.ensureConnected();
    const prefix = ensurePowertradeChainSub(this.subscriptions, underlying, expiry);
    if (prefix == null) return; // already subscribed
    this.wsClient?.send(buildPowertradeSubscribeMessage(prefix));
    this.pendingChainSubs.push({ underlying, expiry });
    log.info({ underlying, expiry, prefix, contracts: instruments.length }, 'subscribed to chain');
  }

  protected override async unsubscribeChain(
    underlying: string,
    expiry: string,
    _instruments: CachedInstrument[],
  ): Promise<void> {
    if (!this.wsClient?.isConnected) return;
    if (this.activeRequestsForUnderlying(underlying) > 0) return;
    const prefix = releasePowertradeChainSub(this.subscriptions, underlying, expiry);
    if (prefix == null) return;
    this.wsClient.send(buildPowertradeUnsubscribeMessage(prefix));
  }

  protected async unsubscribeAll(): Promise<void> {
    if (!this.wsClient?.isConnected) {
      resetPowertradeSubscriptionState(this.subscriptions);
      return;
    }
    for (const prefix of this.subscriptions.refCounts.keys()) {
      this.wsClient.send(buildPowertradeUnsubscribeMessage(prefix));
    }
    resetPowertradeSubscriptionState(this.subscriptions);
  }

  // ── WS connect ───────────────────────────────────────────────

  private ensureConnected(): Promise<void> {
    if (this.wsClient?.isConnected) return Promise.resolve();
    if (this.connectPromise != null) return this.connectPromise;
    this.connectPromise = this.connectWs().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async connectWs(): Promise<void> {
    if (this.wsClient == null) {
      this.wsClient = new TopicWsClient(POWERTRADE_FEEDS_WS_URL + WS_QUERY, 'powertrade-ws', {
        onStatusChange: (state) => {
          this.emitStatus(
            state === 'connected' ? 'connected' : state === 'down' ? 'down' : 'reconnecting',
          );
        },
        getReplayMessages: () => {
          // Re-subscribe to every active prefix on reconnect.
          const messages: Array<Record<string, unknown>> = [];
          for (const prefix of this.subscriptions.refCounts.keys()) {
            messages.push(buildPowertradeSubscribeMessage(prefix));
          }
          return messages;
        },
        onMessage: (raw) => {
          this.handleRawMessage(raw);
        },
      });
    }
    await this.wsClient.connect();
  }

  // ── WS message handling ──────────────────────────────────────

  private handleRawMessage(raw: WebSocket.RawData): void {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString());
    } catch (err: unknown) {
      log.debug({ err: String(err) }, 'malformed WS frame');
      return;
    }

    // PowerTrade can pack frames into JSON arrays when join_json is set —
    // we don't set it, but the spec lists it. Tolerate both shapes.
    if (Array.isArray(json)) {
      for (const item of json) this.dispatch(item);
      return;
    }
    this.dispatch(json);
  }

  private dispatch(input: unknown): void {
    const m = parsePowertradeWsMessage(input);
    switch (m.kind) {
      case 'token': {
        this.decimals.set(m.message);
        return;
      }
      case 'option': {
        const inst = buildPowertradeInstrument(m.message, {
          buildCanonicalSymbol: (b, s, e, k, r) => this.buildCanonicalSymbol(b, s, e, k, r),
          underlyingDecimals: (id) => this.decimals.get(id),
        });
        if (inst == null) return;
        if (this.instrumentMap.has(inst.exchangeSymbol)) return;
        this.instruments.push(inst);
        this.instrumentMap.set(inst.exchangeSymbol, inst);
        this.symbolIndex.set(inst.symbol, inst.exchangeSymbol);
        return;
      }
      case 'top_of_book': {
        const inst = this.instrumentMap.get(m.message.symbol);
        if (inst == null) return;
        const previous = this.quoteStore.get(m.message.symbol);
        const quote = mergePowertradeTopOfBook(m.message, previous, this.emptyQuote());
        this.emitQuoteUpdate(m.message.symbol, quote);
        return;
      }
      case 'trade': {
        const inst = this.instrumentMap.get(m.message.symbol);
        if (inst == null) return;
        const previous = this.quoteStore.get(m.message.symbol);
        const quote = mergePowertradeTrade(m.message, previous, this.emptyQuote());
        this.emitQuoteUpdate(m.message.symbol, quote);
        return;
      }
      case 'reference_price': {
        const sym = m.message.symbol;
        if (sym == null) return;
        const inst = this.instrumentMap.get(sym);
        if (inst == null) return;
        const previous = this.quoteStore.get(sym);
        const quote = mergePowertradeReferencePrice(m.message, previous, this.emptyQuote());
        this.emitQuoteUpdate(sym, quote);
        return;
      }
      case 'risk': {
        const inst = this.instrumentMap.get(m.message.symbol);
        if (inst == null) return;
        const previous = this.quoteStore.get(m.message.symbol);
        const quote = mergePowertradeRiskSnapshot(m.message, previous, this.emptyQuote());
        this.emitQuoteUpdate(m.message.symbol, quote);
        return;
      }
      case 'subscribed': {
        // First subscribed ack after connect doubles as our "reference data
        // replay is far enough along to start serving" signal — but in
        // practice the option deliverables stream BEFORE any subscribed
        // ack arrives, so we close the bootstrap window on either
        // (a) the first non-token deliverable batch ending, or (b) the
        // 15s safety timeout. Use ack as a secondary signal.
        if (this.bootstrapDeferred != null && this.instruments.length > 0) {
          this.completeBootstrap();
        }
        log.debug({ ack: m.message.subscribed }, 'subscribe ack');
        return;
      }
      case 'subscribe_error': {
        log.warn({ err: m.message.subscribe_error.message }, 'powertrade subscribe error');
        return;
      }
      case 'unsubscribed':
      case 'unknown':
      default:
        return;
    }
  }

  // ── REST helpers ─────────────────────────────────────────────

  private async refreshHealth(): Promise<void> {
    try {
      const res = await fetch(`${POWERTRADE_REST_BASE_URL}${POWERTRADE_CURRENCY_ALL_SUMMARY}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: unknown = await res.json();
      const parsed = PowertradeCurrencyAllSummarySchema.safeParse(json);
      if (!parsed.success) {
        const health = derivePowertradeHealth(null, this.instruments.length);
        this.emitStatus(health.status, health.message);
        return;
      }
      const health = derivePowertradeHealth(parsed.data, this.instruments.length);
      this.emitStatus(health.status, health.message);
    } catch (error: unknown) {
      const health = derivePowertradeHealth(null, this.instruments.length, error);
      this.emitStatus(health.status, health.message);
    }
  }

  override async dispose(): Promise<void> {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    await this.unsubscribeAll();
    await this.wsClient?.disconnect();
    this.wsClient = null;
  }

  override async listUnderlyings(): Promise<string[]> {
    const found = await super.listUnderlyings();
    return found.length > 0 ? found : Array.from(SUPPORTED_UNDERLYINGS_FALLBACK);
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @oggregator/core typecheck`
Expected: PASS, zero errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/feeds/powertrade/ws-client.ts \
        packages/core/src/feeds/powertrade/index.ts
git commit -m "feat(core/powertrade): adapter orchestrator (ws + rest)"
```

---

## Task 10 — Wire into core public exports + server registry

**Files:**
- Modify: `packages/core/src/index.ts:153`
- Modify: `packages/server/src/adapters.ts`

- [ ] **Step 1: Add the public export**

In `packages/core/src/index.ts`, after line 153 add:

```ts
export { PowertradeWsAdapter } from './feeds/powertrade/index.js';
```

- [ ] **Step 2: Build core (server runs from dist!)**

Run: `pnpm --filter @oggregator/core build`
Expected: PASS, `dist/feeds/powertrade/` populated.

- [ ] **Step 3: Register in server**

In `packages/server/src/adapters.ts` change the import block and the `adapters` array:

```ts
import {
  registerAdapter,
  DeribitWsAdapter,
  OkxWsAdapter,
  BinanceWsAdapter,
  BybitWsAdapter,
  DeriveWsAdapter,
  CoincallWsAdapter,
  ThalexWsAdapter,
  PowertradeWsAdapter,
} from '@oggregator/core';

const adapters = [
  new DeribitWsAdapter(),
  new OkxWsAdapter(),
  new BinanceWsAdapter(),
  new BybitWsAdapter(),
  new DeriveWsAdapter(),
  new CoincallWsAdapter(),
  new ThalexWsAdapter(),
  new PowertradeWsAdapter(),
];
```

- [ ] **Step 4: Server typecheck + tests**

Run: `pnpm --filter @oggregator/server typecheck && pnpm --filter @oggregator/server test`
Expected: PASS.

- [ ] **Step 5: End-to-end smoke test**

Run: `pnpm dev` in one terminal. Wait until logs show:

```
{"venue":"powertrade","ms":<n>,"underlyings":["BTC","ETH","SOL",...]} venue loaded
```

If the line shows `venue failed` with a 401/403/451 code, stop and contact the user — IP enablement is needed. Otherwise hit:

```bash
curl -s http://localhost:3100/api/venues | jq '.venues[] | select(.id=="powertrade")'
curl -s 'http://localhost:3100/api/underlyings' | jq '.underlyings | map(select(.venues[]=="powertrade"))'
curl -s 'http://localhost:3100/api/chain?underlying=BTC&expiry=<some-listed-expiry>' \
  | jq '.contracts | to_entries[] | select(.value.venue=="powertrade") | .value.greeks' | head -40
```

Expected: greeks populate (`delta`, `gamma`, `vega`, `theta`, `markIv`) within 30s of server boot for at least one BTC contract.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts packages/server/src/adapters.ts
git commit -m "feat(core,server): register powertrade adapter"
```

---

## Task 11 — Web sidebar venue entry

**Files:**
- Create: `packages/web/src/assets/venues/powertrade.svg` (placeholder — user supplies real SVG)
- Modify: `packages/web/src/lib/venue-meta.ts`

- [ ] **Step 1: Drop a placeholder logo**

If the user has not yet supplied an SVG, create a 1-letter mark so the sidebar renders:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#FF5C00"/>
  <text x="50%" y="55%" text-anchor="middle" fill="#fff" font-family="system-ui" font-weight="700" font-size="14">P</text>
</svg>
```

Save as `packages/web/src/assets/venues/powertrade.svg`.

- [ ] **Step 2: Add the venue entry**

In `packages/web/src/lib/venue-meta.ts`:

After the `thalexLogo` import, add:

```ts
import powertradeLogo from '@/assets/venues/powertrade.svg';
```

After the `thalex` block (currently ending at line 48), add:

```ts
  powertrade: {
    id: 'powertrade',
    label: 'PowerTrade',
    shortLabel: 'PWT',
    logo: powertradeLogo,
    color: '#FF5C00',
  },
```

- [ ] **Step 3: Web typecheck + build**

Run: `pnpm --filter @oggregator/web typecheck && pnpm --filter @oggregator/web build`
Expected: PASS.

- [ ] **Step 4: Visual check**

With `pnpm dev` running, open http://localhost:5173 and confirm the PowerTrade chip appears in the venue sidebar and is selectable. Click into BTC → an expiry → confirm the chain shows `PWT` columns where data has flowed.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/assets/venues/powertrade.svg \
        packages/web/src/lib/venue-meta.ts
git commit -m "feat(web): add powertrade to venue sidebar options"
```

---

## Task 12 — Final precommit + retrospective

- [ ] **Step 1: Run full precommit**

Run: `pnpm precommit`
Expected: PASS — typecheck across all packages and full vitest single pass.

- [ ] **Step 2: Inspect comment hygiene**

Skim every new file under `packages/core/src/feeds/powertrade/` against `.pi/skills/comment-cleanup/SKILL.md`. Strip comments that explain the WHAT; keep only WHY/non-obvious notes. (Most existing comments in the plan above are already WHY-style; this is a sanity sweep.)

- [ ] **Step 3: Final commit if any cleanups happened**

```bash
git add packages/core/src/feeds/powertrade/
git commit -m "chore(core/powertrade): comment cleanup pass"
```

- [ ] **Step 4: Tag a known-good commit**

```bash
git log --oneline -10
```

Expected: 10–12 commits ending with the powertrade work, ready for review/PR.

---

## Self-Review Notes

**Spec coverage check:**
- Instrument discovery → Tasks 5, 8, 9 (WS-based via `deliverable<option>` + token decimals)
- Top of book / trades / mark / settlement → Tasks 5, 9 (mergers + dispatcher)
- Greeks + IV → Tasks 5, 9 (`risk_snapshot` mid/bid/ask)
- Symbol normalisation → Tasks 3, 5 (regex + `buildPowertradeInstrument`)
- Health probe → Task 7
- Server registration → Task 10
- Web sidebar → Task 11
- Fee cap placeholder → Task 1
- VenueId registration → Task 1
- Reference docs → Task 1 (HTML spec) + Task 3 (JSON fixtures)

**Settlement-price channel** is exposed by the spec but not consumed — settlement events fire at expiry boundaries and the chain runtime treats expired contracts as removed (handled by `sweepExpiredInstruments` in the base adapter). Adding it later is a single dispatcher branch + merge function if a use case appears.

**Order book L2 (`ob_snapshot` / `pb_snapshot`)** is also exposed by the spec but not consumed — the project's `LiveQuote` model is top-of-book only, mirroring every other venue. Subscribing to L2 would inflate bandwidth ~20× without changing any analytics output.

**Open issues to track after delivery:**
- Replace doc fixtures with live captures once API is enabled (Task 4 step 5).
- Replace placeholder fee cap (`0.125`) with PowerTrade's real cap when supplied.
- Replace placeholder logo SVG with the real PowerTrade brand mark.
