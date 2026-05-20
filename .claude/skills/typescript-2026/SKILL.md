---
name: typescript-2026
description: >
  Apply this skill whenever writing, reviewing, or generating TypeScript code — especially
  for backend/Node services, WebSocket clients, REST/WS API integrations, data normalization
  pipelines, and real-time aggregators. Covers 2026 patterns, strict typing, comment conventions,
  import order, file structure, and what to avoid.
---

# TypeScript 2026 — Coding Standard

This skill defines the rules for writing TypeScript in a crypto options aggregator context:
multi-platform WebSocket feeds, REST APIs, data normalization, and real-time pipelines.
Follow every rule below unless you have an explicit reason to deviate — and document that reason.

---

## 1. tsconfig — Non-negotiable baseline

Always start from strict mode. No exceptions.

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": {
      "@feeds/*": ["src/feeds/*"],
      "@core/*":  ["src/core/*"],
      "@types/*": ["src/types/*"],
      "@utils/*": ["src/utils/*"]
    }
  }
}
```

`noUncheckedIndexedAccess` is critical: `arr[0]` returns `T | undefined`, forcing you to handle
missing data from exchange APIs instead of assuming it exists.

---

## 2. File structure — Feature-first, not type-first

**Do NOT** create flat dirs like `src/interfaces/`, `src/types/`, `src/services/`.
**DO** group by domain/feature.

```
src/
  feeds/
    deribit/
      ws-client.ts        ← WebSocket connection management
      normalizer.ts       ← Raw → canonical type conversion
      types.ts            ← Deribit-specific raw types
      index.ts            ← Public exports only
    bybit/
      ws-client.ts
      normalizer.ts
      types.ts
      index.ts
    binance/
      ...
  core/
    aggregator.ts         ← Merges normalized data from all feeds
    order-book.ts
    types.ts              ← Canonical shared types (OptionsQuote, Greeks, etc.)
    index.ts
  utils/
    reconnect.ts
    logger.ts
    retry.ts
    time.ts
  types/
    common.ts             ← Branded types, enums, shared primitives
  index.ts                ← App entry point
```

Rules:
- Each directory has one `index.ts` that only re-exports the public API of that module.
- `types.ts` lives inside the feature folder, not at root. Shared types go in `core/types.ts` or `types/common.ts`.
- Do not put types in `index.ts` — keep exports and type declarations separate.
- File names: `kebab-case.ts` always. No `WsClient.ts`, no `wsClient.ts`.

---

## 3. Import order

Enforce with `eslint-plugin-import` or Biome. Order is:

```typescript
// 1. Node built-ins
import { EventEmitter } from "node:events";
import { setTimeout }   from "node:timers/promises";

// 2. External packages
import { z }            from "zod";
import WebSocket        from "ws";

// 3. Internal aliases (@ paths)
import { OptionsQuote } from "@core/types";
import { logger }       from "@utils/logger";

// 4. Relative imports — parent first, then siblings
import { parseGreeks }  from "../shared/greeks";
import { DeribitRaw }   from "./types";
```

Blank line between each group. No blank lines within a group.
Remove unused imports immediately — they are noise in WebSocket code where callback shapes
change frequently.

---

## 4. Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case | `ws-client.ts`, `order-book.ts` |
| Classes | PascalCase | `DeribitFeedClient` |
| Interfaces | PascalCase, no `I` prefix | `OptionsQuote`, `FeedConfig` |
| Type aliases | PascalCase | `ExchangeId`, `OptionSide` |
| Enums | PascalCase members | `OptionSide.Call`, `OptionSide.Put` |
| Functions | camelCase | `normalizeGreeks()`, `reconnectWithBackoff()` |
| Constants (module-level) | SCREAMING_SNAKE | `MAX_RECONNECT_ATTEMPTS` |
| Local variables | camelCase | `rawQuote`, `parsedTs` |
| Observables / Subjects | `$` suffix | `quote$`, `connectionState$` |

Never use `I` prefix on interfaces (`IFeedClient` → `FeedClient`).
Never use `T` prefix on type aliases (`TQuote` → `Quote`).

---

## 5. Type patterns for aggregators

### 5.1 Branded types for exchange IDs and symbols
Never use bare `string` where context matters.

```typescript
// types/common.ts
declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

export type ExchangeId  = Brand<string, "ExchangeId">;
export type OptionSymbol = Brand<string, "OptionSymbol">;
export type UnixMs      = Brand<number, "UnixMs">;

// Usage — prevents mixing up raw string with validated ID
const exchange = "deribit" as ExchangeId;
```

### 5.2 Discriminated unions for WebSocket message types
Every exchange sends different message shapes. Model this explicitly.

```typescript
// feeds/deribit/types.ts
export type DeribitMessage =
  | { type: "subscription"; channel: string; data: DeribitQuoteData }
  | { type: "heartbeat"; id: number }
  | { type: "error"; code: number; message: string };

// Narrow safely — no `as` casting
function handleMessage(msg: DeribitMessage): void {
  switch (msg.type) {
    case "subscription": processQuote(msg.data); break;
    case "heartbeat":    sendPong(msg.id);        break;
    case "error":        handleError(msg);        break;
  }
}
```

### 5.3 Canonical normalized type for all feeds

```typescript
// core/types.ts
export interface OptionsQuote {
  exchange:   ExchangeId;
  symbol:     OptionSymbol;
  side:       OptionSide;
  strike:     number;
  expiry:     UnixMs;
  bid:        number | null;
  ask:        number | null;
  iv:         number | null;       // implied volatility
  greeks:     Greeks | null;
  receivedAt: UnixMs;
}

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega:  number;
  rho:   number;
}

export enum OptionSide {
  Call = "C",
  Put  = "P",
}
```

### 5.4 Use `unknown` for external data, parse immediately

```typescript
// WRONG — trusts external data blindly
ws.on("message", (raw: string) => {
  const msg = JSON.parse(raw) as DeribitMessage; // 💀 dangerous cast
});

// RIGHT — validate at the boundary, then the rest of the system is safe
import { z } from "zod";

const DeribitMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscription"), channel: z.string(), data: DeribitQuoteDataSchema }),
  z.object({ type: z.literal("heartbeat"),    id: z.number() }),
  z.object({ type: z.literal("error"),        code: z.number(), message: z.string() }),
]);

ws.on("message", (raw: string) => {
  const result = DeribitMessageSchema.safeParse(JSON.parse(raw));
  if (!result.success) {
    logger.warn({ error: result.error, raw }, "Unparseable message from Deribit");
    return;
  }
  handleMessage(result.data);
});
```

Use **Zod** at all WebSocket message boundaries and REST response boundaries.
After the parse, everything inside the system has correct TS types — no casts needed.

### 5.5 Utility types — use them

```typescript
// Partial config for construction, Required for validated config
type FeedConfigInput   = Partial<FeedConfig>;
type ValidatedConfig   = Required<FeedConfig>;

// Read-only snapshot passed to aggregator — immutable
type QuoteSnapshot = Readonly<OptionsQuote>;

// Pick only what a normalizer needs from config
type NormalizerDeps = Pick<FeedConfig, "exchange" | "symbolMap">;

// Record for exchange → config mapping
const configs: Record<ExchangeId, FeedConfig> = { ... };
```

---

## 6. WebSocket patterns

### 6.1 Typed WebSocket client class

```typescript
// feeds/deribit/ws-client.ts

interface DeribitClientConfig {
  url:                  string;
  heartbeatIntervalMs:  number;
  maxReconnectAttempts: number;
  reconnectBaseDelayMs: number;
}

type ConnectionState = "disconnected" | "connecting" | "connected" | "closing";

export class DeribitFeedClient extends EventEmitter {
  private ws:                WebSocket | null = null;
  private state:             ConnectionState  = "disconnected";
  private reconnectAttempts: number           = 0;
  private heartbeatTimer:    NodeJS.Timeout | null = null;

  constructor(private readonly config: DeribitClientConfig) {
    super();
  }

  async connect(): Promise<void> {
    // implementation
  }

  disconnect(): void {
    this.state = "closing";
    this.ws?.close(1000, "Client disconnect");
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.emit("fatal", new Error("Max reconnect attempts exceeded"));
      return;
    }
    // Exponential backoff — never hammer an exchange
    const delay = this.config.reconnectBaseDelayMs * 2 ** this.reconnectAttempts;
    this.reconnectAttempts++;
    setTimeout(() => void this.connect(), delay);
  }
}
```

### 6.2 Reconnection — exponential backoff, not fixed interval

```typescript
// utils/reconnect.ts
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 30_000): number {
  return Math.min(baseMs * 2 ** attempt + Math.random() * 200, maxMs);
}
```

Jitter (the `Math.random() * 200`) prevents thundering-herd reconnects across multiple
feed clients reconnecting at exactly the same time.

### 6.3 Heartbeat / ping-pong

Exchanges close idle connections. Always implement:

```typescript
private startHeartbeat(): void {
  this.heartbeatTimer = setInterval(() => {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.ping(); // or send exchange-specific heartbeat JSON
    }
  }, this.config.heartbeatIntervalMs);
}

private stopHeartbeat(): void {
  if (this.heartbeatTimer) {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
```

---

## 7. Error handling

### 7.1 Always throw `Error` instances, never strings

```typescript
// WRONG
throw "Connection failed";

// RIGHT
throw new Error("Connection failed");

// BETTER for typed error handling
class FeedConnectionError extends Error {
  constructor(
    message: string,
    public readonly exchange: ExchangeId,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FeedConnectionError";
  }
}
```

### 7.2 `catch` blocks always type `unknown`

```typescript
// WRONG — implicitly any
try { ... } catch (e) {
  logger.error(e.message); // 💀 runtime error if e isn't an Error
}

// RIGHT
try { ... } catch (e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  logger.error({ err: e }, message);
}
```

### 7.3 Async/await — never lose errors

```typescript
// WRONG — fire-and-forget loses errors silently
feedClient.connect();

// RIGHT — float errors up or handle explicitly
await feedClient.connect().catch((err: unknown) => {
  logger.fatal({ err }, "Feed failed to connect on startup");
  process.exit(1);
});
```

---

## 8. Comment conventions — useful or none

Comments explain **why**, not **what**. The code explains what. If you need to explain what,
the code is unclear — fix the code.

### Good comments

```typescript
// Deribit timestamps are in microseconds, not milliseconds.
// All internal types use UnixMs (branded ms), so divide by 1000.
const receivedAt = (raw.timestamp / 1000) as UnixMs;
```

```typescript
// Bybit sends greeks as strings ("0.42"), not numbers.
// Parse defensively — they've sent "NaN" and "" in production.
const delta = parseFloat(raw.greeks?.delta ?? "0") || null;
```

```typescript
// Reconnect uses exponential backoff with jitter to avoid
// thundering-herd when all feeds reconnect after a network blip.
const delay = backoffDelay(this.reconnectAttempts);
```

### Bad comments — never write these

```typescript
// Get the price        ← WHAT, not WHY
const price = quote.bid;

// Loop through items   ← obvious
for (const item of items) { ... }

// TODO: fix this       ← vague, no owner, no ticket
// TODO(dan, #483): handle negative IV from Binance raw feed
//   ← good: has owner, has ticket reference

// Set x to 5           ← useless
x = 5;
```

### JSDoc — only on exported public API

```typescript
/**
 * Normalizes a raw Deribit subscription message into a canonical OptionsQuote.
 *
 * @throws {FeedConnectionError} if the raw message is missing required fields
 *   (exchange-side bugs — Deribit has dropped `greeks` during maintenance windows)
 */
export function normalizeDeribitQuote(raw: DeribitQuoteData, ts: UnixMs): OptionsQuote {
  ...
}
```

Do NOT write JSDoc on private/internal functions. Do NOT repeat the type signature in prose.
Only document things that aren't obvious from the types.

---

## 9. Async patterns

Always `async/await`. Never raw `.then()/.catch()` chains.
Never `new Promise()` unless wrapping a callback API with no promise version.

```typescript
// WRONG — callback hell
ws.on("open", () => {
  ws.send(JSON.stringify(subMsg), (err) => {
    if (err) handleError(err);
  });
});

// RIGHT — promisify once, use await everywhere
function wsSend(ws: WebSocket, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.send(JSON.stringify(payload), (err) => err ? reject(err) : resolve());
  });
}

// Then everywhere:
await wsSend(ws, subscribeMessage);
```

---

## 10. What to NEVER do

### Type system
- ❌ `any` — use `unknown` and narrow it, or fix the type
- ❌ `as SomeType` casts on external data — parse with Zod at the boundary
- ❌ `// @ts-ignore` — if TS complains, understand why and fix it
- ❌ `// @ts-expect-error` in production code (only acceptable in test files)
- ❌ `Object` (capital O) — use `object` or a proper interface
- ❌ `Function` — use `() => void` or the precise signature
- ❌ Unused generic type params: `type Wrapper<T> { value: string }` — T is unused noise
- ❌ `enum` for bit flags or when the values matter at runtime — use `const` objects instead

### Architecture
- ❌ Shared mutable state across feed normalizers — each feed is isolated
- ❌ Silent catch blocks: `catch (_) {}` — at minimum log it
- ❌ Hardcoded exchange URLs/keys in source — use env vars with validation at startup
- ❌ Comparing timestamps across exchanges without normalizing to a common unit (use `UnixMs` branded type)
- ❌ Trusting `JSON.parse()` output without schema validation
- ❌ `setInterval` for reconnect — use backoff logic instead

### Style
- ❌ Deep relative imports: `../../../core/types` — use `@core/types` alias
- ❌ `export default` for anything except the main entry point — named exports are refactor-safe
- ❌ `var` — always `const`, fall back to `let` only when reassignment is required
- ❌ Triple-slash directives `/// <reference ...>` in application code
- ❌ Barrel files that re-export everything (`export * from './x'`) — it makes tree-shaking and circular dependency tracking hard. Be explicit.

---

## 11. Normalization pattern (multi-exchange)

Each exchange gets its own normalizer that maps raw → canonical. The aggregator only sees canonical types.

```typescript
// feeds/deribit/normalizer.ts
import type { DeribitQuoteData } from "./types";
import type { OptionsQuote }     from "@core/types";
import { OptionSide }            from "@core/types";
import type { UnixMs }           from "@types/common";

export function normalizeDeribitQuote(
  raw:        DeribitQuoteData,
  receivedAt: UnixMs,
): OptionsQuote {
  return {
    exchange:   "deribit" as ExchangeId,
    symbol:     raw.instrument_name as OptionSymbol,
    side:       raw.instrument_name.endsWith("-C") ? OptionSide.Call : OptionSide.Put,
    strike:     raw.strike,
    expiry:     (raw.expiration_timestamp) as UnixMs, // already ms on Deribit
    bid:        raw.best_bid_price ?? null,
    ask:        raw.best_ask_price ?? null,
    iv:         raw.mark_iv != null ? raw.mark_iv / 100 : null, // Deribit sends 20 for 20%
    greeks:     raw.greeks ? {
      delta: raw.greeks.delta,
      gamma: raw.greeks.gamma,
      theta: raw.greeks.theta,
      vega:  raw.greeks.vega,
      rho:   raw.greeks.rho,
    } : null,
    receivedAt,
  };
}
```

The key discipline: normalizers live inside the feed folder. They know about raw types.
The aggregator never imports from `feeds/*/types.ts` — only `feeds/*/index.ts` exports.

---

## 12. Tooling setup

```json
// package.json scripts
{
  "lint":       "eslint src --ext .ts",
  "lint:fix":   "eslint src --ext .ts --fix",
  "typecheck":  "tsc --noEmit",
  "format":     "biome format --write src",
  "pre-commit": "npm run typecheck && npm run lint"
}
```

Recommended tools:
- **ESLint** + `@typescript-eslint/recommended-type-checked` (not just `recommended`)
- **Biome** or **Prettier** for formatting
- **Zod** for runtime schema validation at all I/O boundaries
- **pino** for structured logging (fast, JSON output, works well with log aggregators)
- **vitest** for unit tests

Run `tsc --noEmit` in CI. No type errors merge to main.
