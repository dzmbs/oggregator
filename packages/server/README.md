# @oggregator/server

Fastify REST + WebSocket API. Bootstraps venue adapters from `@oggregator/core`, serves enriched option chain data, and hosts the web dashboard in production.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Service health |
| `GET /api/venues` | Connected venues and connection state |
| `GET /api/underlyings` | Available base assets, per-venue breakdown |
| `GET /api/expiries?underlying=BTC` | Expiry dates with per-venue availability |
| `GET /api/chains?underlying=BTC&expiry=...&venues=...` | Cross-venue enriched option chain |
| `GET /api/surface?underlying=BTC` | IV surface (expiry × delta heatmap) |
| `GET /api/stats?underlying=BTC` | Spot, DVOL, IVR, 24h changes |
| `GET /api/dvol-history?currency=BTC` | Historical DVOL candles + realized vol |
| `GET /api/flow?asset=BTC` | Recent options trades across venues |
| `WS /ws/chain` | Real-time chain snapshot push |

## Commands

```bash
pnpm dev          # tsx watch on :3100 (hot reload)
pnpm build        # tsc → dist/
pnpm start        # NODE_ENV=production node dist/index.js
pnpm test:run     # vitest
```

## How it works

1. Server starts and begins bootstrapping venue adapters (~5–15s)
2. During bootstrap, all endpoints return `503`. The web client retries automatically
3. Once adapters connect, `isReady()` flips and data starts flowing
4. In production (`NODE_ENV=production`), the server also serves the built web SPA from `../web/dist/`

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server listen port |
| `NODE_ENV` | | Set to `production` to serve static SPA |
