# @oggregator/core — Quick Reference

```bash
pnpm typecheck      # tsc --noEmit
pnpm test:run       # vitest single pass
pnpm build          # tsc → dist/
```

```
src/feeds/{venue}/   ws-client.ts + types.ts (Zod) + index.ts
src/feeds/shared/    BaseAdapter, SdkBaseAdapter, JsonRpcWsClient
src/portfolio/       position store, greeks aggregation, scenarios, pnl curve
src/runtime/         chain, spot, trades, block-trades, portfolio
src/core/            types, aggregator, enrichment, registry, symbol
src/types/common.ts  VenueId, OptionRight, DataSource
```

IV stored as fractions (0–1+). Deribit sends percentages — `ivToFraction()` converts. Zod at all I/O boundaries. Rebuild `dist/` after changing `src/` before expecting server consumers to see the update.
