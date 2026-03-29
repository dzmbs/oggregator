# @oggregator/core

Venue adapters, canonical types, reusable live-data runtimes, and enrichment analytics for 5 crypto options exchanges.

## What this does

Connects to Deribit, OKX, Binance, Bybit, and Derive via WebSocket, normalizes venue data into canonical core types, exposes shared domain runtimes (`ChainRuntime`, `SpotRuntime`, `TradeRuntime`, `BlockTradeRuntime`), and enriches cross-venue chains with analytics such as ATM IV, skew, GEX, IV surface, and put/call ratios.

## Structure

```
src/
  feeds/{venue}/    ws-client, codec, planner, state, health
  feeds/shared/     BaseAdapter, JSON-RPC client, topic/socket transports
  runtime/          chain, spot, trades, block-trades
  core/             canonical types, aggregator, enrichment, registry
  services/         dvol only
  trade-persistence.ts shared trade money and instrument helpers
  types/common.ts   VenueId, OptionRight, UnixMs (branded types)
  utils/logger.ts   pino structured logging
```

## Key concepts

- **Zod at the boundary** — every exchange message is parsed through Zod schemas before entering the system. Types are inferred from schemas, never manually duplicated.
- **Feed isolation** — venue adapters never import from each other. Cross-venue aggregation happens in `core/aggregator.ts`.
- **IV as fractions** — all internal IV values are 0–1+ (0.50 = 50%). Deribit sends percentages and is converted at the adapter level.
- **Enrichment is pure** — `core/enrichment.ts` computes ATM IV, 25Δ skew, GEX, IV surface, and term structure from raw data. No side effects.

## Commands

```bash
pnpm typecheck    # tsc --noEmit
pnpm build        # tsc → dist/
pnpm test:run     # vitest single pass
```

## Runtime notes

- `ChainRuntime`, `SpotRuntime`, `TradeRuntime`, and `BlockTradeRuntime` are the primary public API for downstream consumers
- Runtimes own shared live state, buffering/retention, and health so server, ingest, bots, and external apps consume the same canonical data product
- legacy service wrappers were removed; runtimes are the only live-data surface
- `trade-persistence.ts` centralizes instrument parsing and venue-specific premium/notional math shared by server routes and persistence code

## Example: external trade consumer

```ts
import { TradeRuntime } from '@oggregator/core';

const runtime = new TradeRuntime();

runtime.subscribe((trade) => {
  if (trade.underlying === 'BTC' && trade.price > 1_000) {
    console.log('large trade', trade.venue, trade.instrument, trade.price, trade.timestamp);
  }
});

await runtime.start(['BTC', 'ETH']);

process.on('SIGINT', () => {
  runtime.dispose();
});
```

That is the intended non-server integration shape for ingest workers, analytics jobs, bots, and internal automation.
