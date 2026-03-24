<p align="center">
  <img src="packages/web/src/assets/oggregator-logo.svg" alt="oggregator" width="320" />
</p>

<p align="center">
  <strong>Cross-venue crypto options aggregator. Real-time pricing, greeks, and IV across 5 exchanges.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.0.1-blue" />
  <img src="https://img.shields.io/badge/license-MIT-green" />
  <img src="https://img.shields.io/badge/node-≥20-orange" />
  <img src="https://img.shields.io/badge/venues-5-50D2C1" />
</p>

---

## What this is

oggregator connects to Deribit, OKX, Binance, Bybit, and Derive via WebSocket, normalizes option quotes to a canonical format, and serves a real-time cross-venue comparison dashboard. See the best price, IV, spread, and greeks for any strike across all venues simultaneously.

## Venues

| Venue | Connection | Settlement |
|-------|-----------|------------|
| Deribit | WebSocket | USDC |
| OKX | WebSocket + REST | USDC |
| Binance | WebSocket | USDT |
| Bybit | WebSocket + REST | USDC |
| Derive | WebSocket | USDC |

## Quick Start

```bash
pnpm install
pnpm dev          # server (:3100) + web (:5173)
```

Open [localhost:5173](http://localhost:5173). Data starts flowing within ~10 seconds as venue adapters connect.

## Quality Gates

```bash
pnpm typecheck    # tsc --noEmit across all packages
pnpm test         # 293 contract tests
pnpm precommit    # typecheck + test (run before every commit)
pnpm build        # production build (server + web)
```

## Architecture

```
packages/
  protocol/   Shared Zod schemas for WS protocol between server and web
  core/       Venue adapters, canonical types, normalization, enrichment
  server/     Fastify REST + WS API, serves enriched chain data
  web/        React 19 + Vite dashboard (mobile-first responsive)
```

Data flows: **Exchange WS → Core Adapter → Normalizer → Enrichment → Server API → Web Dashboard**

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Service health |
| `GET /api/venues` | Connected venues and status |
| `GET /api/underlyings` | Available base assets per venue |
| `GET /api/expiries?underlying=BTC` | Expiry dates with per-venue availability |
| `GET /api/chains?underlying=BTC&expiry=2026-03-28` | Cross-venue option chain with enriched stats |
| `GET /api/surface?underlying=BTC` | IV surface (expiry × delta grid) |
| `GET /api/stats?underlying=BTC` | DVOL, spot, IVR, 24h changes |
| `GET /api/dvol-history?currency=BTC` | Historical DVOL candles |
| `GET /api/flow?asset=BTC` | Recent options trades across venues |
| `WS /ws/chain` | Real-time chain updates via WebSocket |

## Dashboard

The web dashboard includes:

- **Chain** — Cross-venue option chain with best-price highlighting, IV chips, spread pills, expandable per-venue detail, and quick trade
- **Builder** — Multi-leg options builder with templates, custom legs, live repricing, payoff chart editing, and venue comparison
- **Surface** — IV surface heatmap across delta levels and expiries with term structure indicator
- **Flow** — Live options trade flow plus institutional RFQ / block trade mode
- **Analytics** — OI by venue, call/put summary, put/call ratio by expiry, DVOL chart with HV overlay, OI by strike, and cross-expiry curves
- **GEX** — Gamma exposure by strike with dealer positioning explanation

Mobile responsive with bottom navigation, shared toolbar, and full-screen settings drawer.

## Deploy

Single-service deploy. The server serves the SPA in production:

```bash
pnpm build
pnpm start        # NODE_ENV=production, serves API + static SPA
```

**Railway**: Build command `pnpm install && pnpm build`, start command `pnpm start`.

## License

MIT
