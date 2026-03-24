# @oggregator/web

React 19 + Vite + TypeScript dashboard for cross-venue crypto options data. Mobile-first responsive design.

## Views

- **Chain** — Option chain with calls/puts mirrored around strike, best-price highlighting, IV chips, spread pills, expandable per-venue detail, and quick trade
- **Builder** — Multi-leg options builder with templates, custom legs, live repricing, draggable payoff strikes, and venue comparison
- **Surface** — IV surface heatmap (expiry × delta grid) with term structure indicator
- **Flow** — Live options trade flow with whale detection (🐋 $100K+) plus an institutional RFQ / block trade mode
- **Analytics** — OI by venue, call/put summary, put/call ratio by expiry, DVOL chart with HV overlay, OI by strike, and cross-expiry curves
- **GEX** — Gamma exposure by strike showing dealer positioning (magnet vs accelerator)

## Mobile

Fully responsive with:
- Bottom tab navigation
- Shared toolbar with asset + expiry + hamburger settings
- Full-screen settings drawer (venues, expiry, asset, My IV)
- Card-based chain layout replacing the 15-column desktop grid
- Touch-optimized tap targets (44px minimum)
- PWA ready (manifest, safe areas, homescreen install)

## Commands

```bash
pnpm dev          # dev server on :5173 (proxies /api → :3100)
pnpm build        # tsc --noEmit && vite build
pnpm typecheck    # tsc --noEmit
pnpm test:run     # vitest
```

## Stack

| Concern | Library |
|---------|---------|
| Build | Vite 8 + SWC |
| UI | React 19 |
| Server state | TanStack Query v5 |
| Client state | Zustand v5 |
| Charts | Lightweight Charts v5 |
| Validation | Zod |
| Styling | CSS Modules |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | `/api` | API base URL (override for split deploys) |
