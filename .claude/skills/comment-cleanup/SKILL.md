---
name: comment-cleanup
description: >
  Apply this skill after every code change. Reviews and cleans up comments ONLY
  in the code that was just modified — never touches pre-existing comments outside
  the changed scope. Enforces lean, context-aware commenting: structural markers,
  genuine clarification, and non-obvious reasoning only. Strips conversation
  artifacts, redundant labels, and anything a fresh reader would find confusing
  or meaningless.
---

# Comment Cleanup — After Every Change

Run this after every code modification, before considering the task done.
Scope is strict: **only touch comments in lines/blocks you just wrote or edited.**
Leave everything else alone.

---

## The core test — read as a stranger

Before keeping any comment, ask:
> "If someone who was NOT in this conversation reads this comment cold,
> does it make complete sense on its own?"

If the answer is no — rewrite or delete it.

---

## What to DELETE immediately

### Conversation artifacts
Comments that reference what happened during the chat session. These mean nothing
to anyone reading the code later.

```typescript
// BAD — references a conversation decision, meaningless to future reader
// WS client implementation (NO SDK)
// Removed axios dependency per user request
// Using native WebSocket instead of socket.io
// Reverted to manual parsing after library issues
// Added back after we decided to keep it

// GOOD — if there's a real reason to note it, explain WHY, not WHAT changed
// Native WebSocket used here — socket.io adds 80KB to bundle for no benefit in this context
```

### Labels that just repeat the code
```typescript
// BAD — code already says this
// Function to normalize quote
function normalizeQuote(raw: DeribitRaw): OptionsQuote { ... }

// BAD — variable name already says this
// WebSocket connection
const ws = new WebSocket(url);

// BAD — the return statement is obvious
// Return the result
return result;
```

### Commented-out code
```typescript
// BAD — dead code with no explanation
// const oldClient = new SDKClient(config);
// await oldClient.connect();

// RULE: If code is commented out, either delete it or add a comment explaining
// EXACTLY why it must stay (e.g. needed for rollback on specific date/ticket).
// "Maybe I'll need this later" is not a reason. Delete it.
```

### TODO comments without context
```typescript
// BAD — vague, no owner, no ticket
// TODO: fix this
// TODO: handle error
// TODO: optimize

// ACCEPTABLE — specific, actionable
// TODO(#483): Bybit sends negative IV during maintenance — clamp to 0 for now
```

### Defensive/apologetic comments
```typescript
// BAD — explains nothing useful
// This is a bit hacky but it works
// Not the best way to do this but...
// I know this looks weird
// This might cause issues

// RULE: If the code is weird enough to need an apology, fix the code.
// If it can't be fixed (external constraint), explain the constraint specifically.
```

### Version / changelog comments
```typescript
// BAD — this belongs in git history, not source code
// Updated 2024-03-15
// v2 of this function
// Old version below
```

---

## What to KEEP and how to write it

### 1. Structure markers — for long files or complex blocks
Only when the file is long enough that navigation genuinely helps.
Keep them minimal — one line, no decoration.

```typescript
// ── Connection lifecycle ──────────────────────────────────────────────────

private connect(): void { ... }
private disconnect(): void { ... }
private scheduleReconnect(): void { ... }

// ── Message handling ──────────────────────────────────────────────────────

private handleMessage(raw: unknown): void { ... }
private handleError(err: unknown): void { ... }
```

Not needed for files under ~80 lines. Don't add structure to code that isn't complex.

### 2. Non-obvious reasoning — the WHY, never the WHAT
```typescript
// Deribit sends IV as a percentage (20 = 20%), normalize to decimal for internal types.
const iv = raw.mark_iv != null ? raw.mark_iv / 100 : null;

// Bybit timestamps are microseconds. All internal types use milliseconds.
const receivedAt = (raw.ts / 1_000) as UnixMs;

// Jitter prevents thundering-herd reconnects when all feeds drop simultaneously.
const delay = baseMs * 2 ** attempt + Math.random() * 200;

// onerror fires before onclose — only log here, let onclose handle reconnect logic.
ws.onerror = () => { logger.warn("WS error on", this.url); };
```

### 3. Hard-won external knowledge — things you can't see in code
```typescript
// Deribit closes idle connections after 60s. Heartbeat interval must be < 60s.
private readonly HEARTBEAT_INTERVAL_MS = 30_000;

// Binance rejects subscriptions with >200 symbols per connection.
// Split feeds across multiple connections above this threshold.
const MAX_SYMBOLS_PER_CONNECTION = 200;

// readyState 2 = CLOSING. Sending on a CLOSING socket throws synchronously.
if (this.ws.readyState !== WebSocket.OPEN) return;
```

### 4. JSDoc — only on exported public functions
Only when the signature alone doesn't tell the full story.
Do NOT restate the types — they're already in the signature.

```typescript
/**
 * Normalizes a raw Deribit subscription payload into a canonical OptionsQuote.
 *
 * @throws {FeedParseError} if required fields are missing — Deribit has dropped
 *   greeks during maintenance windows, treat as non-fatal at the call site.
 */
export function normalizeDeribitQuote(raw: DeribitQuoteData, ts: UnixMs): OptionsQuote
```

Do NOT write JSDoc on:
- Private functions
- Internal helpers
- Anything not exported
- Functions where the name + types are self-explanatory

---

## The rewrite checklist — apply to every comment in changed code

For each comment in code you just touched, answer these in order:

1. **Conversation artifact?** → Delete. No exceptions.
2. **Repeats what the code already says?** → Delete.
3. **Commented-out code?** → Delete (or add specific retention reason).
4. **Vague TODO?** → Add ticket/owner or delete.
5. **Explains WHAT instead of WHY?** → Rewrite to explain WHY, or delete.
6. **Would a stranger understand this with zero context from our chat?** → If no, rewrite.
7. **Passes the stranger test?** → Keep.

---

## Quick reference — patterns to find and fix

| Pattern | Action |
|---|---|
| `// NO SDK`, `// without library`, `// native X` | Delete or rewrite with actual reason |
| `// Removed X`, `// Added X back`, `// Changed to Y` | Delete — git history owns this |
| `// This function does X` where function is named `doX` | Delete |
| `// TODO: fix` with no ticket | Delete or add `// TODO(#N): specific thing` |
| `// old version`, `// v2`, `// updated YYYY-MM-DD` | Delete |
| `// hacky`, `// not ideal`, `// works for now` | Fix the code or explain the real constraint |
| Long inline comment restating logic step by step | Delete — code should be readable |
| Comment referencing "the user", "we decided", "per request" | Delete |
