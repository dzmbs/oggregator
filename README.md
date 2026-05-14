<p align="center">
  <img src="packages/web/src/assets/oggregator-logo.svg" alt="oggregator" width="320" />
</p>

<p align="center">
  <strong>Cross-venue crypto options aggregator. Real-time pricing, greeks, and IV across 8 exchanges.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.0.1-blue" />
  <img src="https://img.shields.io/badge/license-MIT-green" />
  <img src="https://img.shields.io/badge/node-≥20-orange" />
  <img src="https://img.shields.io/badge/venues-8-50D2C1" />
</p>

<p align="center">
  <img src="media/oggregator-readme.gif" alt="oggregator demo showing chain overview and builder" width="900" />
</p>

---

## What this is

oggregator connects to Deribit, OKX, Binance, Bybit, Derive, Coincall, Thalex, and Gate.io via WebSocket, normalizes option quotes to a canonical format, and serves a real-time cross-venue comparison dashboard. See the best price, IV, spread, and greeks for any strike across all venues simultaneously.

**Live demo:** [oggregator.useheat.xyz](https://oggregator.useheat.xyz)

## Venues

| Venue | Connection | Settlement |
|-------|-----------|------------|
| Deribit | WebSocket | USDC |
| OKX | WebSocket + REST | USDC |
| Binance | WebSocket | USDT |
| Bybit | WebSocket + REST | USDC |
| Derive | WebSocket | USDC |
| Coincall | WebSocket + REST | USDT |
| Thalex | WebSocket | USD (stablecoin) |
| Gate.io | WebSocket + REST | USDT |

## Quick Start

```bash
pnpm install
pnpm dev          # server (:3100) + web (:5173)
```

Open [localhost:5173](http://localhost:5173). Data starts flowing within ~10 seconds as venue adapters connect.

## Quality Gates

```bash
pnpm typecheck    # tsc --noEmit across all packages
pnpm test         # vitest single pass across all workspaces
pnpm precommit    # typecheck + test (run before every commit)
pnpm build        # production build (server + web)
```

## Architecture

```
packages/
  protocol/   Shared Zod schemas for WS protocol between server and web
  core/       Venue adapters, canonical types, normalization, enrichment, IV history
  server/     Fastify REST + WS API, readiness, SPA serving, paper trading engine
  web/        React 19 + Vite dashboard (mobile-first responsive)
  trading/    Paper trading domain — accounts, orders, fills, positions, P&L
  db/         Optional Postgres store (trades + paper trading) + SQL migrations
  ingest/     Optional worker that records live + institutional trades into Postgres
```

Live data path: **Exchange WS/REST → Core venue adapter → Core runtime → Server delivery → Web dashboard**

Chain transport path: **Exchange deltas → `ChainRuntime` projection → `WS /ws/chain` snapshot+delta stream → browser query cache**

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
| `GET /api/iv-history?underlying=BTC&window=90d` | Constant-maturity ATM IV / 25Δ RR / 25Δ fly history with rank + percentile per tenor |
| `GET /api/spot-candles?underlying=BTC` | Spot OHLC candles for payoff overlays |
| `GET /api/ready` | Readiness for deploy health checks |
| `GET /api/flow?underlying=BTC` | Recent options trades across venues |
| `GET /api/block-flow?underlying=BTC` | Institutional RFQ / block trades |
| `GET /api/portfolio/positions?source=manual` | Current portfolio legs for the selected source |
| `GET /api/portfolio/metrics?source=manual&forwardDays=0` | Portfolio totals, pnl curve, greeks, break-even, and shock grid |
| `POST /api/portfolio/scenarios?source=manual` | Run custom vol shock scenarios against current positions |
| `POST/DELETE/GET /api/portfolio/venue-credentials/:venue` | Connect, disconnect, and inspect private-venue portfolio adapters |
| `WS /ws/chain` | Real-time chain snapshot + delta stream to the browser |
| `WS /ws/portfolio` | Real-time portfolio metrics snapshot + delta stream |
| `POST /api/paper/auth/register` · `/paper/account` · `/paper/orders` · `/paper/positions` · `/paper/fills` · `/paper/pnl` · `/paper/trades` · `/paper/activity` | Paper trading engine (auth, accounts, multi-leg orders, fills, P&L, activity feed) |
| `WS /ws/paper` | Real-time paper trading account/order/fill events |

## Dashboard

The web dashboard includes:

- **Chain** — Cross-venue option chain with best-price highlighting, IV chips, spread pills, expandable per-venue detail, and quick trade
- **Architect** — Multi-leg strategy builder with prebuilt templates, custom legs, live repricing, interactive payoff chart with spot candle overlay, venue comparison slideover, and shareable URL strategies
- **Surface** — IV surface heatmap across delta levels and expiries, vol smile per expiry with hover/grid lines, ATM term structure, RV vs IV overlay, and per-tenor IV rank panel (7d / 30d / 60d / 90d) seeded from Deribit DVOL history
- **Alpha** — Vertical spread analyzer, signals feed, and venue routing table with vol smile inset for cross-venue execution edge
- **Flow** — Live options trade flow plus institutional RFQ / block trade mode
- **Analytics** — OI by venue, call/put summary, put/call ratio by expiry, DVOL chart with HV overlay, OI by strike, and cross-expiry curves
- **GEX** — Gamma exposure by strike with dealer positioning explanation
- **DVOL** — Standalone DVOL chart with historical candles and HV bands
- **Portfolio** — Manual and venue-backed option positions with live pnl curve, strike/expiry greek aggregation, break-even IV view, and shock scenarios
- **Trading** — Paper trading: accounts, multi-leg order entry, live positions, fills, realized/unrealized P&L, and activity feed (real-time via `WS /ws/paper`)

Mobile responsive with bottom navigation, shared toolbar, and full-screen settings drawer.

## Deploy

Main app is a single service. The server serves the SPA in production:

```bash
pnpm build
pnpm start        # NODE_ENV=production, serves API + static SPA
```

Optional durable storage (live + institutional flow, paper trading state) uses Postgres + a separate ingest consumer:

```bash
pnpm db:migrate   # run once with DATABASE_URL set
pnpm dev:ingest   # local worker for trade ingest
```

Paper trading runs in-memory by default; setting `DATABASE_URL` persists accounts, orders, fills, and positions across restarts.

Production shape:
- main app: `Dockerfile`
- ingest consumer: `Dockerfile.ingest`
- Postgres: private/internal only

**Coolify**:
- main app → `Dockerfile`
- ingest worker → `Dockerfile.ingest`
- run `pnpm db:migrate` once before starting ingest

**Railway**: Build command `pnpm install && pnpm build`, start command `pnpm start`.

## License

MIT
