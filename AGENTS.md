# oggregator — Agent Quick Reference

```bash
pnpm dev            # server + web (prebuilds core + protocol)
pnpm typecheck      # all packages
pnpm test           # all tests
pnpm precommit      # typecheck + test (gate)
```

**After changing `packages/core/src/`:** the server imports from `core/dist/`, not `src/`. You must rebuild and restart or changes won't take effect:
```bash
pnpm --filter @oggregator/core build   # tsc → dist/
# then restart pnpm dev
```
`pnpm dev` prebuilds core at startup, but a running server won't pick up source changes without a rebuild + restart.

```
packages/core/      Feeds + types + enrichment (see its CLAUDE.md)
packages/server/    Fastify REST + WS API, readiness, SPA serving (see its CLAUDE.md)
packages/web/       React dashboard (see its CLAUDE.md)
packages/db/        Optional Postgres trade store + migrations
packages/ingest/    Optional persistence worker that records live + institutional trades
references/         Official API docs per venue
```

When touching venue adapters or adding a new venue, read `packages/core/CLAUDE.md` first. It contains the venue-onboarding checklist and exchange-specific gotchas that used to live in `agent_docs/`.

Structural changes to core/server/ingest should preserve the runtime-first architecture: `@oggregator/core` owns reusable live-data runtimes, while server, ingest, bots, and external apps are consumers.

Zod at I/O boundaries. No `any`. No vendor SDKs. Pino logging. IV stored as fractions (0–1+). `pnpm precommit` must pass.
