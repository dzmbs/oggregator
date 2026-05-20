---
name: vitest-2026
description: >
  Apply this skill when writing, reviewing, or generating tests with Vitest.
  Covers Vitest v4 setup with Vite, config, file structure, test patterns,
  mocking (vi.fn, vi.mock, MSW for HTTP/WS), async testing, coverage with v8,
  what to never do, and patterns specific to TypeScript + real-time/WebSocket
  codebases. Based on official vitest.dev docs.
---

# Vitest 2026 — Testing Standard

Current version: **Vitest 4.1** (requires Vite >=6, Node >=20).
Source: vitest.dev official docs.

---

## 1. Installation

```bash
npm install -D vitest @vitest/coverage-v8

# For React component testing
npm install -D @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom

# For HTTP/WebSocket mocking (official Vitest recommendation)
npm install -D msw
```

---

## 2. Configuration — extend vite.config.ts, don't duplicate it

The official Vitest docs say to use a **single config file** for both Vite and Vitest.
Only split into `vitest.config.ts` if you need fundamentally different settings.

```typescript
// vite.config.ts — add `test` block directly
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      "@":           resolve(__dirname, "src"),
      "@components": resolve(__dirname, "src/components"),
      "@hooks":      resolve(__dirname, "src/hooks"),
      "@features":   resolve(__dirname, "src/features"),
      "@lib":        resolve(__dirname, "src/lib"),
      "@types":      resolve(__dirname, "src/types"),
      "@stores":     resolve(__dirname, "src/stores"),
    },
  },

  test: {
    // Run in jsdom for React component tests.
    // Use "node" for pure logic/utility tests (faster).
    environment: "jsdom",

    // DO import explicitly from "vitest" — don't use globals: true.
    // Explicit imports make dependencies clear and play well with TypeScript.
    globals: false,

    // Setup file runs before each test file.
    // Use it for @testing-library/jest-dom matchers, MSW server, etc.
    setupFiles: ["./src/test/setup.ts"],

    // Alias resolution inherits from resolve.alias above automatically.
    // No need to repeat it here.

    coverage: {
      provider:  "v8",   // v8 is recommended: faster, no pre-instrumentation
      reporter:  ["text", "html", "lcov"],
      include:   ["src/**/*.{ts,tsx}"],
      exclude:   [
        "src/test/**",
        "src/**/*.d.ts",
        "src/main.tsx",
        "src/**/*.stories.{ts,tsx}",
        "src/**/index.ts",   // barrel files — nothing to test
      ],
      thresholds: {
        lines:     80,
        functions: 80,
        branches:  75,
      },
    },
  },
});
```

---

## 3. Setup file

```typescript
// src/test/setup.ts
import "@testing-library/jest-dom";
// Extends expect() with .toBeInTheDocument(), .toHaveValue(), etc.
// Must be imported — does not auto-register in Vitest.

// If using MSW, start the server here (see section 7).
```

---

## 4. package.json scripts

```json
{
  "scripts": {
    "test":          "vitest",
    "test:run":      "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:ui":       "vitest --ui",
    "typecheck":     "tsc --noEmit"
  }
}
```

`vitest` (no `run`) = watch mode. `vitest run` = CI, exits after one pass.
Run `typecheck` separately — Vitest does not type-check, only transpiles.

---

## 5. File placement and naming

```
src/
  features/
    options-chain/
      normalizer.ts
      normalizer.test.ts      ← unit test co-located with source
      useOptionsChain.ts
      useOptionsChain.test.ts
  hooks/
    useWebSocket.ts
    useWebSocket.test.ts
  lib/
    backoff.ts
    backoff.test.ts
  test/
    setup.ts                  ← global setup only
    msw-handlers.ts           ← shared MSW request handlers
    factories.ts              ← test data factories
```

Rules:
- Test file lives **next to the file it tests**. Never in a top-level `__tests__` folder.
- Name: `filename.test.ts` for units, `filename.spec.ts` for integration — be consistent,
  pick one convention and keep it.
- No `__tests__` directories — they separate tests from source for no benefit.

---

## 6. Test structure — AAA, always

Every test follows Arrange → Act → Assert. No exceptions.

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { normalizeDeribitQuote } from "./normalizer";
import type { DeribitRaw } from "./types";

describe("normalizeDeribitQuote", () => {
  // Group by function/component at the top level.
  // Nest describe blocks for specific scenarios, not for every branch.

  it("converts IV from percentage to decimal", () => {
    // Arrange
    const raw: DeribitRaw = buildRaw({ mark_iv: 20 });

    // Act
    const result = normalizeDeribitQuote(raw, 1_700_000_000_000 as UnixMs);

    // Assert
    expect(result.iv).toBe(0.2);
  });

  it("returns null IV when mark_iv is missing", () => {
    const raw: DeribitRaw = buildRaw({ mark_iv: undefined });
    const result = normalizeDeribitQuote(raw, 1_700_000_000_000 as UnixMs);
    expect(result.iv).toBeNull();
  });

  it("throws FeedParseError when instrument_name is missing", () => {
    const raw = buildRaw({ instrument_name: undefined });
    expect(() => normalizeDeribitQuote(raw, 0 as UnixMs))
      .toThrowError(FeedParseError);
  });
});
```

**Naming rule for `it()`:** Complete sentence starting with a verb.
`"converts IV from percentage to decimal"` — not `"IV conversion"` or `"test 1"`.
Reading the test name alone must tell you exactly what is verified and what the expected behavior is.

---

## 7. Mocking — the right tool for each job

### 7.1 Functions — vi.fn() and vi.spyOn()

```typescript
import { vi, expect, it, beforeEach } from "vitest";

// Spy on a real implementation — keeps original, lets you assert calls
const spy = vi.spyOn(logger, "warn");
expect(spy).toHaveBeenCalledWith(expect.stringContaining("timeout"));
spy.mockRestore(); // always restore after use

// Mock a function entirely
const onMessage = vi.fn<[OptionsQuote], void>();
client.on("quote", onMessage);
expect(onMessage).toHaveBeenCalledTimes(1);
expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ exchange: "deribit" }));
```

**Always clear/restore mocks between tests.** Add to vitest config or do it manually:

```typescript
// Option A — in vitest config (recommended)
test: {
  clearMocks:   true,  // clears call history between tests
  restoreMocks: true,  // restores vi.spyOn originals between tests
}

// Option B — explicit in test file
beforeEach(() => {
  vi.clearAllMocks();
});
```

### 7.2 Modules — vi.mock()

`vi.mock()` is **hoisted** to the top of the file by Vitest — it runs before imports.
This means you cannot use variables defined in the test file inside `vi.mock()` factory.

```typescript
import { vi, it, expect } from "vitest";
import { connect } from "./ws-client";

// Correct: factory uses vi.fn() directly, no outer variables
vi.mock("./ws-client", () => ({
  connect: vi.fn(),
}));

it("calls connect on mount", () => {
  // connect is already mocked — no imports needed
  renderHook(() => useWebSocket("ws://localhost"));
  expect(connect).toHaveBeenCalledOnce();
});
```

To mock only part of a module and keep the rest real:

```typescript
vi.mock(import("./normalizer"), async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    normalizeDeribitQuote: vi.fn(), // override one function
  };
});
```

### 7.3 HTTP and WebSocket requests — MSW (official Vitest recommendation)

Do **not** mock `fetch` or `WebSocket` manually with `vi.fn()`.
The official Vitest docs explicitly recommend **MSW** for all network mocking.

```typescript
// src/test/msw-handlers.ts — shared handlers for all tests
import { http, HttpResponse, ws } from "msw";

const deribitWs = ws.link("wss://www.deribit.com/ws/api/v2");

export const handlers = [
  http.get("/api/quotes", () => {
    return HttpResponse.json({ quotes: [] });
  }),

  deribitWs.addEventListener("connection", ({ client }) => {
    client.send(JSON.stringify({ type: "heartbeat", id: 1 }));
  }),
];
```

```typescript
// src/test/setup.ts
import { setupServer } from "msw/node";
import { handlers } from "./msw-handlers";

const server = setupServer(...handlers);

beforeAll(()  => server.listen({ onUnhandledRequest: "error" }));
afterEach(()  => server.resetHandlers()); // reset per-test overrides
afterAll(()   => server.close());

export { server };
```

Override handlers for a specific test:

```typescript
import { server } from "@/test/setup";
import { http, HttpResponse } from "msw";

it("handles 500 error from quotes API", async () => {
  server.use(
    http.get("/api/quotes", () => HttpResponse.json({ error: "boom" }, { status: 500 }))
  );
  // test code...
});
```

### 7.4 Timers — vi.useFakeTimers()

For reconnect backoff, heartbeat intervals, debounce — anything time-based.

```typescript
import { vi, it, expect, beforeEach, afterEach } from "vitest";
import { DeribitFeedClient } from "./ws-client";

beforeEach(() => vi.useFakeTimers());
afterEach(()  => vi.useRealTimers());

it("reconnects after backoff delay", async () => {
  const client = new DeribitFeedClient({ reconnectBaseDelayMs: 500 });
  client.connect();
  // Simulate connection drop
  client["ws"]?.emit("close");

  // No reconnect yet
  expect(connectSpy).toHaveBeenCalledTimes(1);

  // Fast-forward past the backoff
  await vi.advanceTimersByTimeAsync(600);

  expect(connectSpy).toHaveBeenCalledTimes(2);
});
```

### 7.5 Dates

```typescript
it("stamps received quotes with current time", () => {
  const fixedTime = new Date("2026-01-01T12:00:00Z");
  vi.setSystemTime(fixedTime);

  const result = normalizeDeribitQuote(raw, Date.now() as UnixMs);

  expect(result.receivedAt).toBe(fixedTime.getTime());
  vi.useRealTimers(); // or handle in afterEach
});
```

---

## 8. Async tests

Always `await` — never return a promise without awaiting it.

```typescript
// WRONG — promise returned but not awaited; test may pass even if it rejects
it("connects", () => {
  return client.connect(); // if this rejects after the test ends, it's invisible
});

// RIGHT
it("connects", async () => {
  await client.connect();
  expect(client.status).toBe("open");
});

// Testing that a promise rejects
it("throws on invalid URL", async () => {
  await expect(client.connect("not-a-url")).rejects.toThrow(FeedConnectionError);
});
```

---

## 9. React component tests — RTL patterns

Use `@testing-library/react`. Test behavior, not implementation.
Never query by CSS class or component internal state.

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@lib/query-client";
import { OptionsChain } from "./OptionsChain";

// Wrapper for providers — reuse this across component tests
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

describe("OptionsChain", () => {
  it("renders quote rows after data loads", async () => {
    // MSW handler will return mock data (configured in setup.ts)
    render(<OptionsChain exchange="deribit" />, { wrapper: Wrapper });

    // Wait for async data to appear
    await waitFor(() => {
      expect(screen.getByRole("row", { name: /BTC-1MAR26-50000-C/i })).toBeInTheDocument();
    });
  });

  it("calls onSelect when a row is clicked", async () => {
    const user    = userEvent.setup();
    const onSelect = vi.fn();

    render(<OptionsChain exchange="deribit" onSelect={onSelect} />, { wrapper: Wrapper });
    await waitFor(() => screen.getByRole("row", { name: /BTC/i }));

    await user.click(screen.getByRole("row", { name: /BTC-1MAR26-50000-C/i }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "BTC-1MAR26-50000-C" })
    );
  });
});
```

Query priority (use in this order, per Testing Library docs):
1. `getByRole` — most accessible, preferred always
2. `getByLabelText` — for form inputs
3. `getByText` — for non-interactive text
4. `getByTestId` — last resort only, when nothing else works

Never use `container.querySelector(".some-class")` — that's testing CSS, not behavior.

---

## 10. Test data factories

Never build raw test objects inline. Use factories — single source of truth for test data.

```typescript
// src/test/factories.ts
import type { DeribitRaw } from "@features/deribit/types";
import type { OptionsQuote } from "@core/types";
import { OptionSide } from "@core/types";

export function buildDeribitRaw(overrides: Partial<DeribitRaw> = {}): DeribitRaw {
  return {
    instrument_name:      "BTC-1MAR26-50000-C",
    strike:               50_000,
    expiration_timestamp: 1_740_787_200_000,
    best_bid_price:       0.05,
    best_ask_price:       0.06,
    mark_iv:              80,
    greeks: {
      delta: 0.42,
      gamma: 0.0001,
      theta: -15.2,
      vega:  120.5,
      rho:   0.3,
    },
    ...overrides,
  };
}

export function buildOptionsQuote(overrides: Partial<OptionsQuote> = {}): OptionsQuote {
  return {
    exchange:   "deribit" as ExchangeId,
    symbol:     "BTC-1MAR26-50000-C" as OptionSymbol,
    side:       OptionSide.Call,
    strike:     50_000,
    expiry:     1_740_787_200_000 as UnixMs,
    bid:        0.05,
    ask:        0.06,
    iv:         0.8,
    greeks:     { delta: 0.42, gamma: 0.0001, theta: -15.2, vega: 120.5, rho: 0.3 },
    receivedAt: 1_700_000_000_000 as UnixMs,
    ...overrides,
  };
}
```

Usage:
```typescript
const quote = buildOptionsQuote({ iv: null });
const raw   = buildDeribitRaw({ mark_iv: undefined, greeks: undefined });
```

---

## 11. Testing types — expectTypeOf

Vitest has built-in type-level assertions. Use them to test TypeScript contracts,
not just runtime behavior.

```typescript
import { expectTypeOf, it } from "vitest";
import { normalizeDeribitQuote } from "./normalizer";

it("returns OptionsQuote type", () => {
  expectTypeOf(normalizeDeribitQuote).returns.toMatchTypeOf<OptionsQuote>();
});

it("iv is number | null, never undefined", () => {
  const quote = buildOptionsQuote();
  expectTypeOf(quote.iv).toEqualTypeOf<number | null>();
});
```

---

## 12. Coverage — v8, what matters

```bash
npm run test:coverage
```

- Provider: always **v8** (faster, no pre-instrumentation, same accuracy as Istanbul since v3.2).
- `thresholds` in config fail CI when coverage drops below limits.
- Don't chase 100% coverage. 100% line coverage with zero meaningful assertions is worthless.
- Exclude: barrel files (`index.ts`), `main.tsx`, type-only files, stories.
- Focus coverage on: normalizers, business logic, custom hooks, utility functions.

What does NOT need unit tests:
- Pure UI components with no logic (just render and pass props)
- `index.ts` re-exports
- Type definitions
- Configuration files

---

## 13. What to NEVER do

### Mocking
- ❌ `vi.mock("fs")`, `vi.mock("path")` — mock behavior not modules
- ❌ Manual `global.fetch = vi.fn()` — use MSW instead
- ❌ Manual `global.WebSocket = vi.fn()` — use MSW `ws` handler instead
- ❌ Forgetting `vi.clearAllMocks()` / `restoreMocks: true` between tests — mocks bleed across tests
- ❌ Using `vi.mock()` with a variable from outer scope — it's hoisted, the variable doesn't exist yet

### Test structure
- ❌ Multiple `expect()` calls testing different behaviors in one `it()` — split into separate tests
- ❌ `it.only()` or `describe.only()` committed to repo — will silently skip all other tests
- ❌ `it.skip()` without a comment explaining why — write the test or delete it
- ❌ Testing implementation details: internal state, private methods, exact re-render counts
- ❌ `expect(true).toBe(true)` — meaningless assertion that always passes
- ❌ Snapshots for large component trees — they're brittle and tell you nothing on failure

### Async
- ❌ Missing `await` on async assertions — test passes before assertion runs
- ❌ `setTimeout` in tests — use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()`
- ❌ `await new Promise(r => setTimeout(r, 500))` — never add real delays to tests

### TypeScript in tests
- ❌ `as any` to silence type errors in test setup — fix the factory or type the mock properly
- ❌ Separate tsconfig for tests with `strict: false` — tests need strict typing too
