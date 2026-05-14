# oggregator

Multi-venue crypto options aggregator. Deribit, OKX, Binance, Bybit, Derive, Coincall, Thalex, Gate.io via direct WebSocket → normalized cross-venue chain → enriched analytics → REST API → React dashboard. Authoritative venue list: `VENUE_IDS` in `packages/protocol/src/ws.ts`.

## Commands

```bash
pnpm dev            # server (:3100) + web (:5173) concurrently
pnpm typecheck      # tsc --noEmit all packages
pnpm test           # vitest single pass
pnpm build          # build all workspaces
pnpm precommit      # typecheck + test — must pass before commit
```

## Monorepo

```
packages/protocol/  Shared Zod schemas and WS/API contracts
packages/core/      Feeds, portfolio analytics, runtimes, normalization, enrichment (see its CLAUDE.md)
packages/server/    Fastify REST + WS API, paper trading, portfolio routes (see its CLAUDE.md)
packages/web/       React + Vite dashboard, portfolio UI, trading UI (see its CLAUDE.md)
packages/trading/   Paper trading domain services and persistence ports
packages/db/        Optional Postgres storage + migrations
packages/ingest/    Optional persistence worker for live and institutional trades
references/         Official API docs and upstream reference repos
```

## Non-obvious constraints

- All external data validated with Zod `.safeParse()` at I/O boundaries
- No vendor SDKs — all 5 venue connections use raw `ws` + `fetch`
- Inverse venues (Deribit BTC/ETH, OKX BTC/ETH) quote premiums in base asset — `normPrice()` multiplies by underlyingPrice for USD
- IV units: Deribit sends percentages (50.18), all others send fractions (0.5018). Deribit adapter converts via `ivToFraction()`. Internal convention is fractions everywhere.
- Canonical symbol format: `BASE/USD:SETTLE-YYMMDD-STRIKE-C/P`
- Fee estimation uses venue-specific cap formula: `min(rate × underlying, cap × optionPrice)` — prevents absurd fees on cheap OTM options
- Tests use fixtures copied verbatim from official API docs in `references/options-docs/`

## Reference docs — read before starting relevant work

- `references/options-docs/{venue}/` — verified API response samples and field mappings
- `packages/core/README.md` and `packages/core/CLAUDE.md` — read before changing venue adapters, runtimes, or shared analytics
- `packages/server/CLAUDE.md` — read before changing REST/WS routes or readiness behavior
- `packages/web/CLAUDE.md` — read before changing dashboard state, transport, or feature structure
- `packages/trading/README.md` — read before changing paper trading semantics or persistence assumptions
- `.claude/skills/typescript-2026/SKILL.md` — TypeScript coding standard
- `.claude/skills/comment-cleanup/SKILL.md` — comment conventions
- `.claude/skills/vite-react-ts-2026/SKILL.md` — frontend coding standard
- `.claude/skills/vitest-2026/SKILL.md` — testing standard


# CODE POLICY
- do not write comments unless it is necessary
