# @oggregator/server — Quick Reference

```bash
pnpm dev            # hot reload on :3100
pnpm build          # tsc
pnpm typecheck      # tsc --noEmit
```

```
GET /api/health          → service status
GET /api/venues          → registered venue IDs
GET /api/underlyings     → base assets across venues
GET /api/expiries        → expiry dates (query: underlying)
GET /api/chains          → enriched cross-venue chain (query: underlying, expiry, venues?)
GET /api/surface         → IV surface grid (query: underlying)
GET /api/stats           → spot, DVOL, regime-facing stats
GET /api/iv-history      → ATM IV / RR / fly history
GET /api/flow            → live options trade flow
GET /api/block-flow      → institutional RFQ / block trades
GET /api/portfolio/*     → positions, metrics, scenarios, venue credentials
WS /ws/chain             → enriched chain snapshots + deltas
WS /ws/portfolio         → portfolio metrics snapshots + deltas
WS /ws/paper             → paper trading account/order/fill events
```

Imports shared market/runtime logic from `@oggregator/core` and shared payload contracts from `@oggregator/protocol`. Returns 503 until adapters ready.
