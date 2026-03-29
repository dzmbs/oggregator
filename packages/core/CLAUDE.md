# @oggregator/core

Feeds, canonical types, reusable live-data runtimes, normalization, and enrichment analytics.

## Commands

```bash
pnpm typecheck      # tsc --noEmit
pnpm build          # tsc → dist/
pnpm test           # vitest watch
pnpm test:run       # vitest single pass (CI)
```

## Structure

```
src/
  feeds/{venue}/    ws-client.ts, codec.ts, planner.ts, state.ts, health.ts, types.ts
  feeds/shared/     BaseAdapter, SdkBaseAdapter, JsonRpcWsClient, TopicWsClient
  runtime/          chain, spot, trades, block-trades
  core/             canonical types, aggregator, enrichment, registry, symbol
  services/         dvol only
  types/common.ts   VenueId, OptionRight, DataSource, UnixMs
  utils/logger.ts   pino structured logging
  index.ts          public API (explicit named exports)
```

## Non-obvious decisions

- **Zod schemas are the source of truth** — each venue's `types.ts` defines what the exchange actually sends. TypeScript types are derived via `z.infer<>`. Changes to exchange response formats start in the Zod schema.

- **Feed isolation** — feeds never import from each other. Cross-feed communication goes through `core/aggregator.ts`.

- **Two JSON-RPC venues share one client** — `jsonrpc-client.ts` serves Deribit (`public/subscribe`) and Derive (`subscribe`), configured via method name overrides.

- **Enrichment is pure computation** — `core/enrichment.ts` transforms raw ComparisonRows into analytics (ATM IV, 25Δ skew, GEX, IV surface, term structure). No network calls, no mutation. All stats are derived from data already in the QuoteStore.

- **IV convention: fractions (0–1+)** — Deribit sends percentages (50.18 = 50.18%), converted via `ivToFraction()` in the adapter. All other venues send fractions natively. Frontend `fmtIv()` does `value × 100` for display.

- **Fee estimation with cap** — `estimateFees()` in `sdk-base.ts` uses `min(rate × underlying, cap × optionPrice)`. Cap prevents absurd fees on cheap OTM options (e.g. 12.5% cap: a $5 option pays max $0.625 fee, not $21).

- **Tests are doc-driven** — fixtures copied verbatim from `references/options-docs/`. If a test fails, check the docs — the exchange may have changed their API.
- **Runtimes are the public product surface** — `ChainRuntime`, `SpotRuntime`, `TradeRuntime`, and `BlockTradeRuntime` are the core APIs downstream consumers should use. Server/web protocol shaping stays outside core.

## Where things are

- Canonical types: `core/types.ts`
- Enrichment (stats, GEX, surface): `core/enrichment.ts`
- Per-venue Zod schemas: `feeds/{venue}/types.ts`
- Inverse→USD conversion: `feeds/shared/sdk-base.ts` → `normPrice()`
- IV normalization: `feeds/shared/base.ts` → `ivToFraction()`
- Expiry parsing: `feeds/shared/sdk-base.ts` → `parseExpiry()`
- Fee estimation: `feeds/shared/sdk-base.ts` → `estimateFees()`
- Runtime venue endpoints: `feeds/shared/endpoints.ts`
- Official API docs: `../../references/options-docs/{venue}/`

## Adding a venue

1. Save the venue's official API docs under `references/options-docs/{venue}/`.
2. Add `feeds/{venue}/types.ts` first. Zod schemas define the real API contract.
3. Split venue logic by role: `codec.ts`, `planner.ts`, `state.ts`, `health.ts`, then keep `ws-client.ts` orchestration-only.
4. Reuse the shared transport that fits the protocol (`TopicWsClient`, `JsonRpcWsClient`, or polling) instead of building a venue-local transport loop.
5. Export the venue from `src/index.ts` and add it to `types/common.ts`.
6. Add doc-backed tests in `feeds/{venue}/types.test.ts` and focused planner/health/state tests before trusting live payloads.
7. Register the adapter in `packages/server/src/adapters.ts`.

Each new venue adapter must implement instrument discovery, live subscriptions, unsubscribe/cleanup, canonical symbol/expiry normalization, and runtime-safe delta emission before the server sees it.

## Critical: server runs from dist/, not src/

`packages/server` imports `@oggregator/core` via `dist/index.js`. Source changes in `src/` are invisible to the running server until you rebuild:

```bash
pnpm --filter @oggregator/core build   # tsc → dist/
# then restart the server
```

`pnpm dev` prebuilds at startup. But if the server is already running and you change core source, you must rebuild + restart. `pnpm typecheck` and `pnpm test` check source directly and will pass even when dist is stale — they won't catch this.

## Known gotchas

- **Deribit IV is percentage**: 50.18 means 50.18%. All others send 0.5018. `ivToFraction()` handles this.
- **Deribit decimal strikes use `d`**: instrument names encode `420.5` as `420d5`. If parsing fails, check the strike token before touching expiry logic.
- **Deribit `creation_timestamp` is listing time**: it is not a live quote timestamp.
- **Deribit inverse vs linear depends on settlement**: BTC/ETH inverse products need underlying conversion for USD premium/notional. USDC/USDT-settled instruments are linear.
- **Bybit requires JSON pings**: send `{"op":"ping"}` on the app protocol cadence. WS-level ping frames are not enough.
- **Bybit REST vs WS field names differ**: REST uses `bid1Price`/`markIv`, WS uses `bidPrice`/`markPriceIv`. Two separate normalizer functions.
- **Bybit baseCoin bulk tickers broken**: `tickers.BTC` silently accepts but never delivers. Must use per-instrument `tickers.BTC-21MAR26-70000-C-USDT`.
- **Binance option fields are mostly strings**: prices and greeks arrive as strings. Coerce at the boundary and keep schemas honest.
- **Binance two WS paths**: `/market` for mark price, `/public` for trades. Cannot combine on one connection.
- **OKX tickers need per-instId**: `instFamily` parameter errors for the tickers channel (60018). Must subscribe per instrument. `opt-summary` does support `instFamily` for bulk.
- **OKX markPx missing**: `opt-summary` has no `markPx` field. Mark price stays null. Bid/ask/IV/greeks all work.
- **OKX oiUsd is not notional**: `/public/open-interest` returns a face/count-style USD field, not market notional. Do not use it for analytics. Core normalizes OI to contract count and derives USD OI from contract metadata plus underlying price.
- **OKX vol24h is contracts, not base currency**: Multiply by `ctMult` (0.01 for BTC, 0.1 for ETH) to get base currency before storing as `volume24h`. Enrichment then multiplies by `underlyingPrice` for USD.
- **Derive sends numeric fields as strings**: schema them that way and coerce downstream with the shared helpers.
- **Derive `get_all_instruments` is incomplete**: it caps out and misses the full venue set. Fetch per currency instead.
- **Derive subscribe method is `subscribe`**: not `public/subscribe` like Deribit.
- **Derive has no app-level heartbeat**: rely on WS ping/pong and reconnect logic.
- **Derive DNS**: `api.derive.xyz` doesn't resolve. Use `api.lyra.finance`.
- **Derive slow bootstrap**: ~13s to load all instruments + tickers across currencies/expiries.
