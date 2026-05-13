---
name: vite-react-ts-2026
description: >
  Apply this skill when building or reviewing Vite + React + TypeScript projects —
  dashboards, SPAs, real-time UIs, data-heavy tools, and internal apps. Covers
  official Vite + React 19 patterns, with Vite 8 examples as the default baseline,
  plus guidance for staying aligned with the repo's installed Vite major, project structure, component conventions,
  state management split (server vs client), hooks, env vars, build config,
  and what to never do. Tailored for data-heavy, auth-gated, real-time applications
  like trading dashboards — not SEO-first marketing sites.
---

# Vite + React + TypeScript 2026 — Coding Standard

This skill is for SPAs: dashboards, internal tools, real-time data apps, anything
that lives behind auth and doesn't care about SEO. This is NOT for Next.js SSR apps.

Sources: vite.dev official docs, react.dev (React 19), TanStack Query v5 docs.

Version note:
- Use the repo's installed Vite major first. This skill uses Vite 8 examples as the default reference point, but do not rewrite working Vite 5/6/7 repo config just to match the examples.
- Treat the examples here as structure and policy guidance unless the task explicitly includes a Vite upgrade.

---

## 1. Bootstrap — one command, correct template

```bash
# Always use react-swc-ts — SWC is faster than Babel for TS transforms
npm create vite@latest my-app -- --template react-swc-ts
cd my-app && npm install
```

Why `react-swc-ts` over `react-ts`:
- SWC is a Rust-based compiler. Vite uses it instead of Babel for transforms.
- Faster HMR and faster cold starts on large TypeScript codebases.
- Official template from Vite, fully supported.

---

## 2. tsconfig — Vite-specific settings that matter

Vite **only transpiles** TypeScript — it does NOT type-check. esbuild/SWC handle
transpilation per-file. This means certain tsconfig fields behave differently than
in a pure `tsc` workflow.

```json
// tsconfig.json — for src/ files
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",      // ← required for Vite. NOT "NodeNext"
    "jsx": "react-jsx",                 // ← no need to import React in every file
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,            // ← REQUIRED: esbuild compiles per-file
    "useDefineForClassFields": true,    // ← standard ECMAScript behavior
    "skipLibCheck": true,
    "noEmit": true,                     // ← Vite handles emit, not tsc
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "baseUrl": ".",
    "paths": {
      "@/*":           ["src/*"],
      "@components/*": ["src/components/*"],
      "@hooks/*":      ["src/hooks/*"],
      "@features/*":   ["src/features/*"],
      "@lib/*":        ["src/lib/*"],
      "@types/*":      ["src/types/*"],
      "@stores/*":     ["src/stores/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}

// tsconfig.node.json — for vite.config.ts itself
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

Critical notes from official Vite docs:
- **`moduleResolution: "bundler"`** — not `"node"` or `"NodeNext"`. Vite resolves
  modules itself, not via Node resolution. This unlocks `allowImportingTsExtensions`.
- **`isolatedModules: true`** — mandatory. esbuild compiles each file in isolation.
  This means `const enum` and implicit type-only imports will break. Use `import type`.
- **`target` is ignored by Vite** — Vite uses esbuild's target, not tsconfig's.
  Set `build.target` in `vite.config.ts` if you need to target older browsers.
- Run **`tsc --noEmit`** in CI separately. Vite never fails on type errors at build time.

---

## 3. vite.config.ts — production-ready baseline

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // Must mirror tsconfig paths exactly
      "@":           resolve(__dirname, "src"),
      "@components": resolve(__dirname, "src/components"),
      "@hooks":      resolve(__dirname, "src/hooks"),
      "@features":   resolve(__dirname, "src/features"),
      "@lib":        resolve(__dirname, "src/lib"),
      "@types":      resolve(__dirname, "src/types"),
      "@stores":     resolve(__dirname, "src/stores"),
    },
  },

  server: {
    port: 3000,
    strictPort: true,  // fail fast instead of silently picking another port
    proxy: {
      // Proxy API calls to your backend during development
      // Eliminates CORS issues in dev without touching production config
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      // Proxy WebSocket connections
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
      },
    },
  },

  build: {
    target: "es2022",           // safe for all modern browsers
    sourcemap: true,            // always — you need these for production debugging
    rollupOptions: {
      output: {
        // Manual chunk splitting — keeps vendor bundle separate from app code
        // Critical for cache efficiency: vendor changes rarely, app code changes often
        manualChunks: {
          vendor:   ["react", "react-dom"],
          tanstack: ["@tanstack/react-query"],
          charts:   ["recharts"],          // or your charting lib
        },
      },
    },
  },

  // Type-check on the fly in dev (optional but useful)
  // Run `tsc --noEmit --watch` in parallel instead for better performance
});
```

---

## 4. Project structure — feature-first, not type-first

Do NOT make `src/components/`, `src/hooks/`, `src/services/` top-level silos.
That structure breaks at scale. Use feature folders.

```
src/
  features/
    options-chain/
      OptionsChain.tsx        ← feature root component
      OptionsChain.test.tsx
      useOptionsChain.ts      ← feature-specific hook
      types.ts                ← types used only by this feature
      index.ts                ← public export only
    order-book/
      OrderBook.tsx
      useOrderBook.ts
      types.ts
      index.ts
    positions/
      ...
  components/
    ui/                       ← truly generic, reusable across features
      Button.tsx
      Badge.tsx
      Spinner.tsx
      index.ts
    layout/
      Sidebar.tsx
      TopBar.tsx
      index.ts
  hooks/
    useWebSocket.ts           ← shared hooks used by 2+ features
    useDebounce.ts
    useLocalStorage.ts
  lib/
    query-client.ts           ← TanStack QueryClient config
    ws-manager.ts             ← WebSocket connection manager
    http.ts                   ← axios/fetch wrapper
  stores/
    ui.store.ts               ← Zustand for UI state (modals, panels, theme)
  types/
    common.ts                 ← branded types, enums shared app-wide
  App.tsx
  main.tsx
  vite-env.d.ts               ← auto-generated, do not edit
```

Rules:
- A feature imports from `@components/ui` and `@hooks` — never from another feature's internals.
- Cross-feature communication goes through shared stores or lifted state in App.tsx.
- `index.ts` per feature exports only what external code should use — everything else is private.

---

## 5. Environment variables — Vite's system

Vite exposes env vars under `import.meta.env`, not `process.env`.
Only variables prefixed with `VITE_` are exposed to client code.

```
.env                  ← base, committed to git
.env.local            ← local overrides, git-ignored
.env.development      ← dev-only values
.env.production       ← production values
```

```bash
# .env
VITE_API_BASE_URL=http://localhost:8080
VITE_WS_URL=ws://localhost:8080/ws

# Variables WITHOUT VITE_ prefix are NEVER exposed to the browser
# DB_PASSWORD=secret  ← safe, never bundled
```

**Always type your env vars** — create `src/vite-env.d.ts` or extend it:

```typescript
// src/env.d.ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_WS_URL:       string;
  readonly VITE_APP_VERSION:  string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

Use built-in constants for environment branching — they are tree-shaken in production:

```typescript
if (import.meta.env.DEV) {
  // This entire block is removed from production builds
  console.debug("Feed connected:", feedId);
}
```

Never use `process.env` in Vite client code. It doesn't exist.

---

## 6. React 19 — what changed, what to use

React 19 is stable as of December 2024. These are the relevant changes:

### 6.1 No more `import React` at the top
With `jsx: "react-jsx"` in tsconfig (automatic JSX transform), you never need:
```typescript
import React from "react"; // ← DELETE this everywhere
```

### 6.2 `use()` — read context and promises conditionally
New in React 19. Unlike all other hooks, `use()` can be called inside conditions.

```typescript
// Reading context conditionally
import { use } from "react";

function Panel({ showDetails }: { showDetails: boolean }) {
  if (!showDetails) return null;
  const theme = use(ThemeContext); // ← valid, hooks can't do this
  return <div className={theme}>...</div>;
}
```

For data-heavy apps, `use()` + Suspense replaces most `isLoading` patterns.

### 6.3 React Compiler — automatic memoization
React 19 ships with the React Compiler (formerly React Forget).
It automatically inserts `useMemo`/`useCallback` optimizations at compile time.

**Consequence: stop manually adding `useMemo`/`useCallback` by default.**
Only add them if you have profiled and confirmed a re-render problem.
Pre-emptive memoization is now noise that the compiler handles better.

```typescript
// BEFORE React Compiler — manual memoization everywhere
const filtered = useMemo(() => quotes.filter(q => q.exchange === id), [quotes, id]);
const handleClick = useCallback(() => onSelect(id), [onSelect, id]);

// WITH React Compiler — just write the code, compiler handles it
const filtered = quotes.filter(q => q.exchange === id);
const handleClick = () => onSelect(id);
```

Enable the compiler in `vite.config.ts` (requires `babel-plugin-react-compiler`):
```typescript
import react from "@vitejs/plugin-react"; // note: NOT react-swc for compiler support
// plugins: [react({ babel: { plugins: ["babel-plugin-react-compiler"] } })]
```

### 6.4 `useActionState` — replaces manual form state
For any form with async submission:

```typescript
import { useActionState } from "react";

async function submitOrder(prevState: OrderState, formData: FormData): Promise<OrderState> {
  const result = await api.placeOrder(formData);
  return result.ok ? { status: "success" } : { status: "error", message: result.error };
}

function OrderForm() {
  const [state, formAction, isPending] = useActionState(submitOrder, { status: "idle" });
  return (
    <form action={formAction}>
      <button disabled={isPending}>
        {isPending ? "Submitting..." : "Place Order"}
      </button>
      {state.status === "error" && <p>{state.message}</p>}
    </form>
  );
}
```

### 6.5 `useOptimistic` — instant UI feedback
For mutation-heavy UIs (placing orders, updating settings):

```typescript
import { useOptimistic } from "react";

function PositionList({ positions }: { positions: Position[] }) {
  const [optimisticPositions, addOptimisticPosition] = useOptimistic(
    positions,
    (state, newPosition: Position) => [...state, newPosition],
  );

  async function handleAddPosition(pos: Position) {
    addOptimisticPosition(pos);      // instantly shows in UI
    await api.positions.add(pos);   // real request in background
    // if fails, React automatically reverts to real positions
  }

  return <>{optimisticPositions.map(p => <PositionRow key={p.id} position={p} />)}</>;
}
```

---

## 7. State management — the split that matters

**The golden rule: server state ≠ client state. Never conflate them.**

```
Server state  → TanStack Query v5   (API data, anything fetched from a URL)
Client state  → Zustand             (UI state: open panels, selected tab, theme)
Local state   → useState/useReducer (component-internal: input value, toggle)
```

Never put API response data in Zustand. Never put modal open/close state in React Query.

### 7.1 TanStack Query v5 — server state

```typescript
// lib/query-client.ts
import { QueryClient, QueryCache } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:           0,               // always refetch on mount (good for live data)
      gcTime:              5 * 60 * 1_000,  // keep unused cache 5 min
      retry:               (failureCount, error) => {
        // Don't retry on auth errors — user needs to log in
        if ((error as { status?: number }).status === 401) return false;
        return failureCount < 3;
      },
      refetchOnWindowFocus: true,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Only surface background errors (data already loaded)
      if (query.state.data !== undefined) {
        console.error("Background fetch failed:", error);
      }
    },
  }),
});
```

**Use query key factories** — centralized, typed, no string magic:

```typescript
// features/options-chain/queries.ts
export const optionsKeys = {
  all:       ()                    => ["options"]           as const,
  exchange:  (exchange: string)    => ["options", exchange] as const,
  symbol:    (symbol: string)      => ["options", "symbol", symbol] as const,
} satisfies Record<string, (...args: unknown[]) => readonly unknown[]>;

// Usage
const { data } = useQuery({
  queryKey: optionsKeys.exchange("deribit"),
  queryFn:  () => api.options.getByExchange("deribit"),
});

// Invalidate all options data
queryClient.invalidateQueries({ queryKey: optionsKeys.all() });
```

### 7.2 Zustand — client/UI state

```typescript
// stores/ui.store.ts
import { create } from "zustand";

interface UIState {
  selectedExchange: string | null;
  sidebarOpen:      boolean;
  activePanel:      "positions" | "orders" | "greeks";
  setExchange:      (exchange: string | null) => void;
  toggleSidebar:    () => void;
  setActivePanel:   (panel: UIState["activePanel"]) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedExchange: null,
  sidebarOpen:      true,
  activePanel:      "positions",
  setExchange:      (exchange) => set({ selectedExchange: exchange }),
  toggleSidebar:    ()         => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setActivePanel:   (panel)    => set({ activePanel: panel }),
}));

// Component usage — select only what you need, prevents unnecessary re-renders
function ExchangeSelector() {
  const selected  = useUIStore((s) => s.selectedExchange);
  const setExchange = useUIStore((s) => s.setExchange);
  // ...
}
```

Never put: `user session`, `API responses`, `WebSocket data` in Zustand.
These all belong to Query or local component state.

---

## 8. Custom hooks — the only place for side effects

All `useEffect`, WebSocket subscriptions, and external subscriptions live in custom hooks.
Components contain zero `useEffect` calls directly.

```typescript
// hooks/useWebSocket.ts
import { useEffect, useRef, useCallback, useState } from "react";

type WSStatus = "connecting" | "open" | "closed" | "error";

interface UseWebSocketOptions<T> {
  url:          string;
  onMessage:    (data: T) => void;
  enabled?:     boolean;
}

export function useWebSocket<T>({ url, onMessage, enabled = true }: UseWebSocketOptions<T>) {
  const wsRef     = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<WSStatus>("connecting");

  const connect = useCallback(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen    = ()  => setStatus("open");
    ws.onclose   = ()  => setStatus("closed");
    ws.onerror   = ()  => setStatus("error");
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data as string) as T);
      } catch {
        // Malformed message from server — log but don't crash
        console.warn("Unparseable WS message:", e.data);
      }
    };

    return ws;
  }, [url, onMessage]);

  useEffect(() => {
    if (!enabled) return;
    const ws = connect();
    return () => ws.close(1000, "Component unmounted");
  }, [connect, enabled]);

  return { status };
}
```

Rules for custom hooks:
- Name always starts with `use`.
- One hook = one concern. Don't build a 200-line mega-hook.
- Return a stable, minimal API. Don't return internal refs or setter functions the consumer
  shouldn't touch.
- Cleanup in `useEffect` return function — always.

---

## 9. Component conventions

### 9.1 Function components only. No class components. Ever.

```typescript
// WRONG
class OptionsTable extends React.Component<Props> { ... }

// RIGHT
function OptionsTable({ quotes, onSelect }: OptionsTableProps) { ... }
export default OptionsTable;
```

### 9.2 Typed props — interface, not inline

```typescript
// WRONG — untyped, impossible to reuse
function QuoteRow({ quote, onSelect }: any) { ... }

// WRONG — inline type, harder to reference elsewhere
function QuoteRow({ quote, onSelect }: { quote: OptionsQuote; onSelect: (q: OptionsQuote) => void }) { ... }

// RIGHT — named interface, co-located with component
interface QuoteRowProps {
  quote:    OptionsQuote;
  onSelect: (quote: OptionsQuote) => void;
  compact?: boolean;
}

function QuoteRow({ quote, onSelect, compact = false }: QuoteRowProps) { ... }
```

### 9.3 Export conventions

```typescript
// Named export for components used across features
export function Button({ ... }: ButtonProps) { ... }

// Default export for page/feature root — matches file name
export default function OptionsChain() { ... }

// NEVER export both default and named for the same component
```

### 9.4 Component file structure — always in this order

```typescript
// 1. Imports (see import order section)
import { useState } from "react";
import type { OptionsQuote } from "@types/common";

// 2. Types/interfaces for this component only
interface Props { ... }

// 3. Constants used in this file
const MAX_ROWS = 100;

// 4. The component
function OptionsTable({ quotes }: Props) {
  // 4a. hooks first
  const [selected, setSelected] = useState<string | null>(null);
  const exchange = useUIStore((s) => s.selectedExchange);

  // 4b. derived values (no hooks, just computation)
  const filtered = quotes.filter(q => q.exchange === exchange);

  // 4c. event handlers
  function handleRowClick(quote: OptionsQuote) {
    setSelected(quote.symbol);
  }

  // 4d. render
  return (
    <table>
      {filtered.map(q => (
        <tr key={q.symbol} onClick={() => handleRowClick(q)}>
          ...
        </tr>
      ))}
    </table>
  );
}

// 5. Export at bottom
export default OptionsTable;
```

---

## 10. Import order — enforce with ESLint or Biome

```typescript
// 1. React first (special case — always at top)
import { useState, useEffect, useRef } from "react";

// 2. External libraries
import { useQuery }    from "@tanstack/react-query";
import { create }      from "zustand";
import { z }           from "zod";

// 3. Internal aliases
import { useUIStore }   from "@stores/ui.store";
import { queryClient }  from "@lib/query-client";
import type { OptionsQuote } from "@types/common";

// 4. Feature-relative imports
import { useOptionsChain } from "./useOptionsChain";
import type { OptionsChainConfig } from "./types";

// 5. Assets (last)
import styles from "./OptionsChain.module.css";
```

One blank line between each group. Remove unused imports immediately.
Use `import type` for anything that's type-only — it's required with `isolatedModules: true`
and documents intent clearly.

---

## 11. What to NEVER do in a Vite + React project

### Build / config
- ❌ `process.env.ANYTHING` in client code — use `import.meta.env.VITE_*`
- ❌ Putting secrets in `VITE_*` env vars — they're bundled into the output
- ❌ Ignoring `tsc --noEmit` in CI — Vite builds succeed even with type errors
- ❌ `moduleResolution: "node"` or `"NodeNext"` — use `"bundler"` for Vite projects
- ❌ `const enum` — esbuild with `isolatedModules: true` can't handle them, use regular `enum` or const objects

### React patterns
- ❌ `import React from "react"` — not needed with automatic JSX transform
- ❌ Class components
- ❌ `useEffect` directly in components — extract to a custom hook
- ❌ Unnecessary `useMemo`/`useCallback` — React Compiler handles this; profile first
- ❌ Storing API response data in Zustand — that's TanStack Query's job
- ❌ Storing UI state in TanStack Query — that's Zustand's job
- ❌ Fetching data with bare `useEffect` + `useState` — use TanStack Query
- ❌ Prop drilling more than 2 levels — use context or a store
- ❌ Mutating state directly: `items.push(x)` — always return new references

### TypeScript in React
- ❌ `React.FC<Props>` — just type props directly, `React.FC` has known issues with generics
- ❌ `any` for event handlers: use `React.MouseEvent<HTMLButtonElement>`, etc.
- ❌ `// @ts-ignore` to suppress errors — fix the type
- ❌ Type assertions on API responses: `data as MyType` — parse with Zod at the boundary

### Performance
- ❌ Rendering large lists without virtualization — use `@tanstack/react-virtual`
- ❌ Heavy computation in render — derive values in hooks or use Web Workers
- ❌ Loading everything eagerly — use `React.lazy` + `Suspense` for route-level splitting

---

## 12. Lazy loading + Suspense — route-level code splitting

```typescript
// App.tsx
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Spinner } from "@components/ui";

// These bundles are loaded only when the route is visited
const OptionsChain = lazy(() => import("@features/options-chain"));
const OrderBook    = lazy(() => import("@features/order-book"));
const Positions    = lazy(() => import("@features/positions"));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/chain"     element={<OptionsChain />} />
          <Route path="/book"      element={<OrderBook />} />
          <Route path="/positions" element={<Positions />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
```

Combine with `manualChunks` in `vite.config.ts` for full control over bundle splitting.

---

## 13. main.tsx — the correct entry point

```typescript
// src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "@lib/query-client";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found in index.html");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>,
);
```

`StrictMode` is mandatory — it surfaces bugs that would otherwise be silent.
`ReactQueryDevtools` is wrapped in `import.meta.env.DEV` — tree-shaken from prod builds.

---

## 14. Recommended stack for a real-time dashboard

| Concern | Library | Why |
|---|---|---|
| Build tool | Vite 8 + react-swc-ts | Official, fastest |
| UI | React 19 | Latest stable |
| Routing | React Router v7 | Official recommendation |
| Server state | TanStack Query v5 | Best-in-class, typed |
| Client/UI state | Zustand v5 | Minimal, no boilerplate |
| Forms | React Hook Form + Zod | Typed, performant |
| HTTP | Axios or native fetch | Axios for interceptors |
| Tables | TanStack Table v8 | Headless, handles huge datasets |
| Virtualization | TanStack Virtual | For lists >100 rows |
| Charts | Recharts or TradingView Lightweight Charts | Lightweight Charts for candlesticks |
| Styling | Tailwind CSS v4 | Utility, no runtime |
| Component library | shadcn/ui | Unstyled Radix primitives, you own the code |
| Validation | Zod | Runtime + TypeScript types from same schema |
| Testing | Vitest + React Testing Library | Native Vite integration |
| Linting | ESLint + @typescript-eslint/recommended-type-checked | Strict TS rules |
| Formatting | Biome | Faster than Prettier, one config |

Do not install Redux. Do not install MobX. Do not install react-query v4 or older.
Do not install `axios` if your only API is WebSocket — fetch is enough for REST.
