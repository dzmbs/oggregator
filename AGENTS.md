# oggregator — Agent Quick Reference

```bash
pnpm dev            # server + web (prebuilds core + protocol)
pnpm typecheck      # all packages
pnpm test           # all tests
pnpm precommit      # typecheck + test (gate)
```

**Dependency Management:** Always run `pnpm install` after modifying `package.json` to update `pnpm-lock.yaml` and prevent CI failures due to outdated lockfiles.

**After changing `packages/core/src/` or `packages/protocol/src/`:** rebuild the package so consumers pick up fresh `dist/` output:
```bash
pnpm --filter @oggregator/core build   # tsc → dist/
pnpm --filter @oggregator/protocol build
```
`pnpm dev` prebuilds both packages at startup. Long-running consumers may need a restart after the rebuild if they already loaded stale output.

```
packages/protocol/  Shared Zod schemas and WS/API contracts
packages/core/      Feeds, portfolio analytics, runtimes, enrichment (see its CLAUDE.md)
packages/server/    Fastify REST + WS API, paper trading, portfolio routes (see its CLAUDE.md)
packages/web/       React dashboard, trading UI, portfolio UI (see its CLAUDE.md)
packages/trading/   Paper trading domain services and persistence ports
packages/db/        Optional Postgres trade store + migrations
packages/ingest/    Optional persistence worker that records live + institutional trades
references/         Official API docs per venue
```

When touching venue adapters or adding a new venue, read `packages/core/CLAUDE.md` first. It contains the venue-onboarding checklist and exchange-specific gotchas that used to live in `agent_docs/`.

Structural changes to core/server/ingest should preserve the runtime-first architecture: `@oggregator/core` owns reusable live-data runtimes, while server, ingest, bots, and external apps are consumers.

Zod at I/O boundaries. No `any`. No vendor SDKs. Pino logging. IV stored as fractions (0–1+). `pnpm precommit` must pass.

## Local service ops

`ogg-backend.service` runs as a user service on this machine.

```bash
systemctl --user restart ogg-backend.service
systemctl --user status ogg-backend.service
```

To build the web package directly:

```bash
pnpm --filter @oggregator/web build
```
# Code policy

Do not write comments in code unless necessary — only when the *why* is non-obvious (hidden constraints, workarounds, surprising invariants). Don't restate what the code already says.