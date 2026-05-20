---
name: project-docs
description: >
  Apply this skill when creating or updating any project documentation that agents
  read — CLAUDE.md, AGENTS.md, README, architecture docs, agent_docs/, or any
  markdown that shapes how an agent understands the project. Covers what to write,
  what kills agent performance, how to structure for context efficiency, and how to
  keep docs honest and current — not artificial. Based on Anthropic official docs
  and practitioner patterns from 2025/2026.
---

# Project Documentation for Agents — 2026 Standard

The audience for these docs is an agent with zero memory of your project.
Every session starts cold. The docs are the only thing that survives.

---

## The core problem this skill solves

Agents produce artificial documentation when:
- They pad to look thorough
- They document the current conversation instead of the project
- They describe what they just built ("Added WebSocket client using native API") instead
  of what the project is
- They copy-paste architecture decisions that are already obvious from reading the code
- They document things that will be wrong in a week

Good documentation makes a fresh agent immediately productive.
Bad documentation makes a fresh agent confidently wrong.

---

## 1. CLAUDE.md — what it is and what it isn't

CLAUDE.md (or AGENTS.md for other tools) is loaded into **every single session**.
That means everything in it costs context on every task, even unrelated ones.

**It is:** The project's onboarding document for a new agent. Commands, architecture
constraints, non-obvious decisions, and where to look for things.

**It is NOT:**
- A code style guide (that's the linter's job)
- A record of what changed in this session
- A list of things that were removed ("no longer uses SDK X")
- A transcript of architectural decisions from the chat
- Documentation that will rot within days of being written

### What belongs in CLAUDE.md

```markdown
# Project Name

## What this is
One paragraph. What the project does, who uses it, what it's for.
No fluff. No "This is a modern TypeScript application that..."

## Commands
# The exact commands to run, not descriptions of them
npm run dev          # start dev server on :3000
npm run test         # vitest watch
npm run test:run     # vitest single pass (CI)
npm run typecheck    # tsc --noEmit
npm run build        # production build

## Architecture — what an agent needs to know
- feeds/ — one folder per exchange (deribit/, bybit/, binance/)
  Each feed has: ws-client.ts, normalizer.ts, types.ts, index.ts
- core/ — canonical types and aggregator logic
- State split: TanStack Query for server state, Zustand for UI state
- All external data is validated with Zod at the boundary before use

## Non-obvious rules
- Timestamps: all internal types use UnixMs (branded number, milliseconds)
  Deribit sends microseconds — divide by 1000 before storing
- IV: Deribit sends as percentage (80 = 80%) — divide by 100 before storing
- Never import from another feature's internals — only from its index.ts

## Where things are
- Shared types: src/types/common.ts and src/core/types.ts
- Exchange-specific raw types: src/feeds/{exchange}/types.ts
- MSW handlers for tests: src/test/msw-handlers.ts
- Test factories: src/test/factories.ts

## Known gotchas
- Bybit sends greeks as strings ("0.42") — parseFloat() them, they send "" occasionally
- Binance closes connections at 24h exactly — reconnect logic must handle this
- WebSocket readyState 2 = CLOSING — never send on CLOSING, it throws synchronously
```

### What does NOT belong in CLAUDE.md

```markdown
# BAD — conversation artifacts
## Changes in this session
- Removed socket.io dependency (user requested native WebSocket)
- Switched from axios to fetch for REST calls

# BAD — things that rot immediately
## Current implementation status
- Deribit feed: complete ✅
- Bybit feed: in progress 🚧
- Binance feed: not started ❌

# BAD — repeating what TypeScript already enforces
## TypeScript rules
- Always use explicit types
- Never use any
- Use strict mode

# BAD — style guide that belongs in ESLint
## Code style
- Use 2 spaces for indentation
- Single quotes for strings
- Semicolons required
```

---

## 2. The three questions before writing anything

Before writing any line of documentation, ask:

**1. Will this be true in a month?**
If it describes current state ("currently uses X"), implementation progress, or
anything that changes with each PR — don't write it. It will be wrong soon and
confidently mislead a fresh agent.

**2. Would a stranger understand this without our conversation?**
Docs must make sense cold. If they reference decisions made in chat ("switched to
native API as discussed"), rewrite to capture the actual reason
("native WebSocket: socket.io adds 80KB for no benefit in this context").

**3. Does the code already say this?**
If a fresh agent can read the code and figure it out in 30 seconds, don't document it.
Document things that aren't in the code: constraints, gotchas, external quirks,
non-obvious architectural decisions, and exactly why something unusual was done.

---

## 3. agent_docs/ — splitting context to avoid bloat

The official CLAUDE.md best practice (from Anthropic docs and HumanLayer):
keep CLAUDE.md minimal, put detailed docs in separate files, and tell the agent
when to read them — not dump everything in context every session.

```
project-root/
  CLAUDE.md                        ← minimal, universal, always loaded
  agent_docs/
    architecture.md                ← deep system design, read when architecting
    exchange-quirks.md             ← per-exchange gotchas, read when touching feeds
    testing-patterns.md            ← test setup details, read when writing tests
    deployment.md                  ← deploy steps, read before shipping
```

In CLAUDE.md, reference these with trigger conditions:

```markdown
## Reference docs — read before starting, not always
- agent_docs/exchange-quirks.md — read this before touching any feed code
- agent_docs/architecture.md — read this before making structural changes
- agent_docs/testing-patterns.md — read this before writing tests
```

**Do NOT** embed file contents with `@file` in CLAUDE.md — that puts everything
in context every session. Reference paths with conditions instead.

---

## 4. Architecture docs — what makes them useful vs useless

### Useful architecture doc

Captures decisions that aren't obvious from the code — the WHY, the constraints,
and the trade-offs considered.

```markdown
# Architecture

## State management split
Server state (API data, feed quotes) → TanStack Query
UI state (selected exchange, open panels, theme) → Zustand
Local state (input values, toggles) → useState

Reason: conflating server and client state was the biggest source of bugs in v1.
TanStack Query handles cache invalidation, background refetch, and stale data
automatically. Zustand stays minimal — if something belongs in TQ, it goes there.

## Feed isolation
Each exchange is a completely isolated module in src/feeds/{exchange}/.
Feeds do not import from each other. Cross-feed communication goes through
the aggregator in src/core/aggregator.ts.

Reason: Exchange APIs change independently. Isolating them means a Bybit API
change can't break Deribit. The aggregator is the only place that knows about
multiple feeds simultaneously.

## Zod at every I/O boundary
All external data (WebSocket messages, REST responses) is parsed with Zod
before entering the system. After the boundary, types are correct by construction.

Reason: Exchange APIs send malformed data in production (nulls where numbers expected,
strings where numbers expected, missing fields during maintenance windows).
Zod catches this at the edge so the rest of the system doesn't need defensive code.
```

### Useless architecture doc (never write this)

```markdown
# Architecture

## Overview
This is a modern TypeScript application built with Vite and React. The frontend
communicates with a Node.js backend via WebSocket and REST APIs.

## Components
- Frontend: React + TypeScript
- Backend: Node.js + TypeScript
- State management: Zustand + TanStack Query
- Testing: Vitest

## Data Flow
Data flows from the exchanges through WebSocket connections to the normalizers,
which convert it to canonical types, which are stored in TanStack Query, which
is consumed by React components.
```

The second version describes what the code already shows. An agent reading
the codebase learns nothing from it. Delete it.

---

## 5. README — for humans first, agents second

README serves two audiences: humans evaluating the project, and agents getting context.
Keep them compatible by writing for humans — agents can read human docs fine.

What belongs:
- What the project does (1 paragraph, no marketing language)
- How to get it running (`npm install && npm run dev`)
- How to run tests
- How to contribute (if it's a shared repo)

What doesn't belong:
- Detailed architecture (that's `agent_docs/architecture.md`)
- Exchange-specific quirks (that's `agent_docs/exchange-quirks.md`)
- Anything that requires reading to understand an ongoing implementation

---

## 6. How to update docs — the trigger and the scope

### When to update

Update documentation when:
- A non-obvious constraint is discovered (exchange quirk, timing issue, API limit)
- An architectural decision is made that won't be obvious from code
- A gotcha burned you — add it to the Gotchas section immediately
- A command changes
- A directory or module is renamed or restructured

**Do NOT update documentation when:**
- You added a feature (code is the doc for that)
- You fixed a bug (unless the bug revealed a non-obvious constraint)
- You refactored within existing patterns
- The session is ending and you want to "summarize what was done"
  — that belongs in a git commit message, not CLAUDE.md

### What to write when updating

Write what a stranger needs to know, not what happened in the session.

```markdown
# BAD — session transcript masquerading as documentation
## Update (2026-03-20)
Discovered that Bybit sends greeks as strings during implementation.
Added parseFloat() calls in the normalizer.

# GOOD — durable constraint captured cleanly
## Bybit-specific quirks (in agent_docs/exchange-quirks.md)
Greeks arrive as strings ("0.42"), not numbers. parseFloat() them.
Bybit occasionally sends "" (empty string) for greeks during low-liquidity periods.
Treat as null, not 0.
```

---

## 7. The Gotchas section — highest-signal content in any doc

Every `agent_docs/` file should have a Gotchas section at the top.
These are the things that burned you, edge cases that aren't obvious from the code,
and constraints learned through pain. They're the highest-value content an agent
can get — it's institutional knowledge that doesn't exist anywhere else.

```markdown
# Exchange Quirks

## Gotchas — read these first

- **Deribit microseconds**: timestamps come in microseconds, not milliseconds.
  Divide by 1000 before casting to UnixMs. Easy to miss, hard to debug.

- **Binance 24h disconnect**: Binance forcibly closes all WebSocket connections
  exactly at 24h. The close code is 1000 (normal), so it looks clean. You must
  reconnect proactively before 24h or users will see a gap.

- **Bybit empty strings**: greeks fields can be "" during low-liquidity windows.
  parseFloat("") is NaN. Always check for empty string before parsing.

- **Deribit mark_iv is percentage**: 80 means 80%, not 0.80. All internal types
  store IV as decimal. Divide by 100 in the normalizer.
```

---

## 8. The single rule for documentation quality

**Write for the stranger, not for the session.**

The person (or agent) reading this doc wasn't in the conversation where decisions
were made. They don't know what was tried and rejected. They don't know what
changed from the previous version. They only know what the doc says right now.

Every sentence in every doc must be useful to that stranger on first read,
with no prior context, no chat history, and no knowledge of what today looked like.

If it references the conversation, delete it.
If it describes current progress, delete it.
If it could be read from the code, delete it.
If it captures a durable truth about the system — keep it.
