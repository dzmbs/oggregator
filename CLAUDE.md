# oggregator

Multi-venue crypto options aggregator. Deribit, OKX, Binance, Bybit, Derive via direct WebSocket → normalized cross-venue chain → enriched analytics → REST API → React dashboard.

## Commands

```bash
pnpm dev            # server (:3100) + web (:5173) concurrently
pnpm typecheck      # tsc --noEmit all packages
pnpm test           # vitest single pass
pnpm precommit      # typecheck + test — must pass before commit
```

## Monorepo

```
packages/core/      Feeds, types, normalization, enrichment (see its CLAUDE.md)
packages/server/    Fastify REST API (see its CLAUDE.md)
packages/web/       React + Vite dashboard (see its CLAUDE.md)
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
- `packages/core/README.md` and `packages/core/CLAUDE.md` — read before making structural changes to core/server/ingest runtimes or external-consumer architecture
- `.pi/skills/typescript-2026/SKILL.md` — TypeScript coding standard
- `.pi/skills/comment-cleanup/SKILL.md` — comment conventions
- `.pi/skills/vite-react-ts-2026/SKILL.md` — frontend coding standard
- `.pi/skills/vitest-2026/SKILL.md` — testing standard
