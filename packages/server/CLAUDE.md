# @oggregator/server

Fastify REST + WebSocket API. Bootstraps venue adapters from `@oggregator/core`, serves enriched chain data, flow routes, readiness, and the production SPA.

## Commands

```bash
pnpm dev            # tsx watch on :3100 (hot reload)
pnpm build          # tsc
pnpm start          # node dist/index.js
pnpm typecheck      # prebuilds core, then tsc --noEmit
```

## Structure

```
src/
  index.ts           Entry point (PORT from env, default 3100)
  app.ts             Fastify factory, plugin registration, adapter bootstrap
  adapters.ts        Instantiates + registers all 5 venue adapters
  routes/
    health.ts        GET /api/health + GET /api/ready
    venues.ts        GET /api/venues
    underlyings.ts   GET /api/underlyings
    expiries.ts      GET /api/expiries?underlying=BTC
    chains.ts        GET /api/chains?underlying=BTC&expiry=2026-03-28&venues=deribit,okx
    ws-chain.ts      WS /ws/chain
    flow.ts          GET /api/flow?underlying=BTC
    block-flow.ts    GET /api/block-flow?underlying=BTC
    surface.ts       GET /api/surface?underlying=BTC
    dvol-history.ts  GET /api/dvol-history?currency=BTC
    stats.ts         GET /api/stats?underlying=BTC
```

## Non-obvious decisions

- **Adapters bootstrap async after server starts** — routes return 503 via `isReady()` / `GET /api/ready` until adapters finish loading (~5-15s). Server accepts connections immediately while feeds connect in the background.

- **Server imports only from `@oggregator/core` package root** — never from internal feeds/core paths. If something is needed, it must be exported from core's `index.ts`.

- **New venues need zero route changes** — add the adapter in `adapters.ts`, call `registerAdapter()`, all routes pick it up via `getAllAdapters()`.

- **Auto-subscribes on first request** — `chains.ts` calls `ensureSubscribed()` per venue/underlying on first `/api/chains` request, opening WS connections lazily.

- **Chain browser transport is WS-first** — `ws-chain.ts` coalesces venue deltas and pushes enriched snapshots every 200ms. It does not forward raw exchange ticks one-by-one.

- **Enrichment happens per request / push** — each `/api/chains` call and each `WS /ws/chain` snapshot rebuilds the enriched response from the current QuoteStore. No caching layer between store and response.
