# OI by Strike — V2 Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `V1 | V2` toggle to the existing "Open Interest by Strike" card in the Analytics view; V2 is a Bookmap-style live heatmap (time on X, price on Y-right, spot OHLC candles, thin colored heat bands per strike).

**Architecture:** Reuse `lightweight-charts` v5 (already in the repo via `SkewHistory.tsx`). Heat bands are drawn by a custom `ISeriesPrimitive` attached to the candle series, so they share the chart's coordinate system — no overlay div, no manual sync. The card extracts V1 into its own file, adds a shell `OiByStrikeCard` that holds the V1/V2 toggle, and adds `OiHeatmap` (V2). No new server endpoints; consumes existing `/api/chains` (live via `useChainWs`) and existing `/api/spot-candles`.

**Tech Stack:** React 19 + Vite, `lightweight-charts@^5.1.0`, `@tanstack/react-query@^5.91.2`, CSS Modules, Vitest v4, TypeScript strict mode.

**Spec:** `docs/superpowers/specs/2026-04-26-oi-heatmap-v2-design.md`

---

## File map

```
packages/web/src/
  features/analytics/
    AnalyticsView.tsx                          [MODIFY] swap <OiByStrikeChart> for <OiByStrikeCard>; remove inline V1 code
    AnalyticsView.module.css                   [MODIFY] add heatmap-specific classes
    oi-by-strike/                              [NEW DIR]
      index.ts                                 [NEW] re-exports OiByStrikeCard
      OiByStrikeCard.tsx                       [NEW] card shell + V1/V2 toggle
      OiByStrikeCard.test.tsx                  [NEW] toggle wiring smoke test
      OiByStrikeChart.tsx                      [NEW] V1 — moved verbatim from AnalyticsView.tsx
      OiHeatmap.tsx                            [NEW] V2 — chart setup, primitive lifecycle, tooltip wiring
      HeatBandPrimitive.ts                     [NEW] ISeriesPrimitive impl that draws thin heat lines
      oi-heatmap-utils.ts                      [NEW] aggregateHeatRows, computeOpacity, heatColor + lifted aggregateStrikeOi/computeMaxPain
      oi-heatmap-utils.test.ts                 [NEW] unit tests for all pure helpers
      queries.ts                               [NEW] useSpotCandles TanStack Query hook
  shared-types/
    common.ts                                  [MODIFY] add SpotCandle interface
```

The sub-folder is necessary because the card grows from one component to three components + a primitive + helpers, and `AnalyticsView.tsx` is already 600+ lines.

---

## Task 1: Extract V1 to `oi-by-strike/` sub-folder (pure refactor)

**Goal:** Move V1's chart, the `OiStrikeTooltip` helper, and the shared `aggregateStrikeOi` / `computeMaxPain` utilities out of `AnalyticsView.tsx` into the new folder. No behavior change — the page renders identically.

**Files:**
- Create: `packages/web/src/features/analytics/oi-by-strike/index.ts`
- Create: `packages/web/src/features/analytics/oi-by-strike/OiByStrikeChart.tsx`
- Create: `packages/web/src/features/analytics/oi-by-strike/oi-heatmap-utils.ts`
- Modify: `packages/web/src/features/analytics/AnalyticsView.tsx`

- [ ] **Step 1.1: Create `oi-heatmap-utils.ts` with the V1 helpers lifted from `AnalyticsView.tsx`**

Copy the following functions and types from `AnalyticsView.tsx` verbatim, then export them. Do not change any logic in this step.

Move from `AnalyticsView.tsx` lines 23–43 (types) and lines 78–170 (functions):
- `OiMode` type
- `VenueOi`, `ExpiryOi`, `StrikeOi`, `StrikeAcc` interfaces
- `aggregateStrikeOi`
- `computeMaxPain`

```ts
// packages/web/src/features/analytics/oi-by-strike/oi-heatmap-utils.ts
import type { EnrichedChainResponse } from '@shared/enriched';

export type OiMode = 'contracts' | 'notional';

export interface VenueOi {
  venue: string;
  callOi: number;
  putOi: number;
}

export interface ExpiryOi {
  expiry: string;
  callOi: number;
  putOi: number;
}

export interface StrikeOi {
  strike: number;
  callOi: number;
  putOi: number;
  venues: VenueOi[];
  expiries: ExpiryOi[];
}

interface StrikeAcc {
  callOi: number;
  putOi: number;
  venues: Map<string, { callOi: number; putOi: number }>;
  expiries: Map<string, { callOi: number; putOi: number }>;
}

export function aggregateStrikeOi(
  chains: EnrichedChainResponse[],
  spotPrice: number | null,
  mode: OiMode,
): StrikeOi[] {
  const readOi = mode === 'notional'
    ? (q: { openInterestUsd: number | null } | undefined) => q?.openInterestUsd ?? 0
    : (q: { openInterest: number | null } | undefined) => q?.openInterest ?? 0;
  const map = new Map<number, StrikeAcc>();

  for (const chain of chains) {
    for (const strike of chain.strikes) {
      const prev = map.get(strike.strike) ?? { callOi: 0, putOi: 0, venues: new Map(), expiries: new Map() };
      const ep = prev.expiries.get(chain.expiry) ?? { callOi: 0, putOi: 0 };
      for (const [venue, q] of Object.entries(strike.call.venues)) {
        const val = readOi(q);
        prev.callOi += val;
        ep.callOi += val;
        const vp = prev.venues.get(venue) ?? { callOi: 0, putOi: 0 };
        vp.callOi += val;
        prev.venues.set(venue, vp);
      }
      for (const [venue, q] of Object.entries(strike.put.venues)) {
        const val = readOi(q);
        prev.putOi += val;
        ep.putOi += val;
        const vp = prev.venues.get(venue) ?? { callOi: 0, putOi: 0 };
        vp.putOi += val;
        prev.venues.set(venue, vp);
      }
      prev.expiries.set(chain.expiry, ep);
      map.set(strike.strike, prev);
    }
  }

  const band = spotPrice ? spotPrice * 0.3 : Infinity;
  return [...map.entries()]
    .filter(([strike]) => !spotPrice || Math.abs(strike - spotPrice) <= band)
    .filter(([, d]) => d.callOi > 0 || d.putOi > 0)
    .map(([strike, d]) => ({
      strike,
      callOi: d.callOi,
      putOi: d.putOi,
      venues: [...d.venues.entries()]
        .map(([venue, v]) => ({ venue, ...v }))
        .filter((v) => v.callOi > 0 || v.putOi > 0)
        .sort((a, b) => b.callOi + b.putOi - (a.callOi + a.putOi)),
      expiries: [...d.expiries.entries()]
        .map(([expiry, v]) => ({ expiry, ...v }))
        .filter((v) => v.callOi > 0 || v.putOi > 0)
        .sort((a, b) => b.callOi + b.putOi - (a.callOi + a.putOi)),
    }))
    .sort((a, b) => a.strike - b.strike);
}

export function computeMaxPain(chains: EnrichedChainResponse[]): number | null {
  const strikeOi = new Map<number, { callOi: number; putOi: number }>();
  for (const chain of chains) {
    for (const strike of chain.strikes) {
      const prev = strikeOi.get(strike.strike) ?? { callOi: 0, putOi: 0 };
      for (const q of Object.values(strike.call.venues)) prev.callOi += q?.openInterest ?? 0;
      for (const q of Object.values(strike.put.venues)) prev.putOi += q?.openInterest ?? 0;
      strikeOi.set(strike.strike, prev);
    }
  }

  const strikes = [...strikeOi.entries()];
  if (strikes.length === 0) return null;

  let minPayout = Infinity;
  let maxPainStrike: number | null = null;

  for (const [settlement] of strikes) {
    let totalPayout = 0;
    for (const [strike, oi] of strikes) {
      if (settlement > strike) totalPayout += (settlement - strike) * oi.callOi;
      if (settlement < strike) totalPayout += (strike - settlement) * oi.putOi;
    }
    if (totalPayout < minPayout) {
      minPayout = totalPayout;
      maxPainStrike = settlement;
    }
  }

  return maxPainStrike;
}
```

- [ ] **Step 1.2: Verify the move is byte-equivalent**

Run: `diff <(sed -n '78,170p' packages/web/src/features/analytics/AnalyticsView.tsx) <(grep -A 1000 "^export function aggregateStrikeOi" packages/web/src/features/analytics/oi-by-strike/oi-heatmap-utils.ts | head -100)` — the function bodies should match. If they differ, re-paste from the source.

- [ ] **Step 1.3: Create `OiByStrikeChart.tsx` by moving V1's component code**

Cut the following sections from `AnalyticsView.tsx` and paste them into a new file `oi-by-strike/OiByStrikeChart.tsx`:
- `EXPIRY_COLORS` constant (lines 272–276)
- `OiStrikeTooltip` component (lines 278–351)
- `useScrollToRef` helper (lines 353–367)
- `OiByStrikeChart` component (lines 369–550)

The new file's imports:

```tsx
// packages/web/src/features/analytics/oi-by-strike/OiByStrikeChart.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EnrichedChainResponse } from '@shared/enriched';

import { fmtUsdCompact, fmtCompact, formatExpiry } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import styles from '../AnalyticsView.module.css';
import {
  aggregateStrikeOi,
  computeMaxPain,
  type OiMode,
  type StrikeOi,
} from './oi-heatmap-utils';

// ... copied EXPIRY_COLORS, OiStrikeTooltip, useScrollToRef, OiByStrikeChart ...

export default OiByStrikeChart;
```

The body of each component is copied verbatim from `AnalyticsView.tsx`. No logic changes. The CSS Module import points up one folder (`'../AnalyticsView.module.css'`).

- [ ] **Step 1.4: Create `oi-by-strike/index.ts` with a single export**

```ts
// packages/web/src/features/analytics/oi-by-strike/index.ts
export { default as OiByStrikeChart } from './OiByStrikeChart';
```

(The `OiByStrikeCard` export is added later in Task 6.)

- [ ] **Step 1.5: Update `AnalyticsView.tsx` to import from the new location**

Remove from `AnalyticsView.tsx`:
- the `OiMode`, `VenueOi`, `ExpiryOi`, `StrikeOi`, `StrikeAcc` interfaces (lines 23–43)
- the `aggregateStrikeOi` and `computeMaxPain` functions (lines 78–170)
- `EXPIRY_COLORS`, `OiStrikeTooltip`, `useScrollToRef`, `OiByStrikeChart` (lines 272–550)

Add this import at the top of `AnalyticsView.tsx`:

```tsx
import { OiByStrikeChart } from './oi-by-strike';
```

The JSX on line 591 (`<OiByStrikeChart chains={chains} spotPrice={spotPrice} />`) stays unchanged — same component, different import.

- [ ] **Step 1.6: Run typecheck**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: PASS, zero errors.

- [ ] **Step 1.7: Run tests**

Run: `pnpm --filter @oggregator/web test`
Expected: PASS, no new failures vs. main.

- [ ] **Step 1.8: Manual smoke test**

Run: `pnpm dev`, open `http://localhost:5173`, navigate to Analytics. The "Open Interest by Strike" card must look and behave **identically** to before. Toggle Contracts/Notional, hover rows, hide expiries, switch underlying. All should work as before.

- [ ] **Step 1.9: Commit**

```bash
git add packages/web/src/features/analytics/
git commit -m "$(cat <<'EOF'
refactor(web): extract V1 OI by Strike chart to oi-by-strike subfolder

No behavior change — splits AnalyticsView.tsx into:
- oi-by-strike/OiByStrikeChart.tsx (V1 component)
- oi-by-strike/oi-heatmap-utils.ts (shared aggregateStrikeOi, computeMaxPain)
- oi-by-strike/index.ts

Prepares for V2 heatmap (next).
EOF
)"
```

---

## Task 2: Add `SpotCandle` type and `useSpotCandles` hook

**Goal:** Web-side type for the existing `/api/spot-candles` response, plus a TanStack Query hook the V2 component will consume.

**Files:**
- Modify: `packages/web/src/shared-types/common.ts`
- Create: `packages/web/src/features/analytics/oi-by-strike/queries.ts`

- [ ] **Step 2.1: Add `SpotCandle` and `SpotCandlesResponse` to `shared-types/common.ts`**

Append the following to the end of `packages/web/src/shared-types/common.ts`:

```ts
// Mirrors core's SpotCandle in packages/core/src/services/spot-candles.ts.
// Web does not depend on @oggregator/core; types are duplicated by convention.
export interface SpotCandle {
  timestamp: number;  // milliseconds, UTC
  open: number;
  high: number;
  low: number;
  close: number;
}

export type SpotCandleCurrency = 'BTC' | 'ETH';
export type SpotCandleResolutionSec = 60 | 300 | 1800 | 3600 | 14400 | 86400;

export interface SpotCandlesResponse {
  currency: SpotCandleCurrency;
  resolution: SpotCandleResolutionSec;
  count: number;
  candles: SpotCandle[];
}
```

- [ ] **Step 2.2: Create `oi-by-strike/queries.ts` with the `useSpotCandles` hook**

```ts
// packages/web/src/features/analytics/oi-by-strike/queries.ts
import { useQuery } from '@tanstack/react-query';

import { fetchJson } from '@lib/http';
import type {
  SpotCandleCurrency,
  SpotCandleResolutionSec,
  SpotCandlesResponse,
} from '@shared/common';

export function useSpotCandles(
  currency: SpotCandleCurrency,
  resolution: SpotCandleResolutionSec,
  buckets: number,
) {
  return useQuery({
    queryKey: ['spot-candles', currency, resolution, buckets],
    queryFn: () =>
      fetchJson<SpotCandlesResponse>(
        `/spot-candles?currency=${currency}&resolution=${resolution}&buckets=${buckets}`,
      ),
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev: SpotCandlesResponse | undefined) => prev,
  });
}
```

- [ ] **Step 2.3: Run typecheck**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: PASS.

- [ ] **Step 2.4: Commit**

```bash
git add packages/web/src/shared-types/common.ts packages/web/src/features/analytics/oi-by-strike/queries.ts
git commit -m "feat(web): add SpotCandle types and useSpotCandles query hook"
```

---

## Task 3: TDD `aggregateHeatRows`

**Goal:** Pure helper that produces one `HeatRow` per strike, scoped by `mode`, `side`, and `hiddenExpiries`. Drives the heat band rendering.

**Files:**
- Modify: `packages/web/src/features/analytics/oi-by-strike/oi-heatmap-utils.ts`
- Create: `packages/web/src/features/analytics/oi-by-strike/oi-heatmap-utils.test.ts`

- [ ] **Step 3.1: Write the failing test file**

```ts
// packages/web/src/features/analytics/oi-by-strike/oi-heatmap-utils.test.ts
import { describe, it, expect } from 'vitest';
import type { EnrichedChainResponse } from '@shared/enriched';

import { aggregateHeatRows } from './oi-heatmap-utils';

function venueQuote(openInterest: number, openInterestUsd: number) {
  return {
    bid: null, ask: null, mid: null,
    iv: null, delta: null, gamma: null, vega: null, theta: null, rho: null,
    openInterest,
    openInterestUsd,
    volume24h: null,
    volume24hUsd: null,
    feeBps: null,
    timestamp: 0,
  };
}

function chain(expiry: string, dte: number, strikes: Array<{
  strike: number;
  call?: { venue: string; oi: number; oiUsd: number };
  put?: { venue: string; oi: number; oiUsd: number };
}>): EnrichedChainResponse {
  return {
    underlying: 'BTC',
    expiry,
    dte,
    strikes: strikes.map((s) => ({
      strike: s.strike,
      call: { venues: s.call ? { [s.call.venue]: venueQuote(s.call.oi, s.call.oiUsd) } : {} },
      put:  { venues: s.put  ? { [s.put.venue]:  venueQuote(s.put.oi,  s.put.oiUsd)  } : {} },
    })),
    stats: { forwardPriceUsd: null, atmIv: null, atmStrike: null, rr25d: null, bfly25d: null },
  } as unknown as EnrichedChainResponse;
}

describe('aggregateHeatRows', () => {
  it('returns empty array when chains is empty', () => {
    expect(aggregateHeatRows([], 80_000, 'contracts', new Set(), 'both')).toEqual([]);
  });

  it('filters strikes outside spot ± 30%', () => {
    const c = chain('2026-04-30', 4, [
      { strike: 50_000, call: { venue: 'deribit', oi: 10, oiUsd: 100_000 } },  // -37.5% → out
      { strike: 80_000, call: { venue: 'deribit', oi: 20, oiUsd: 200_000 } },  // 0% → in
      { strike: 110_000, call: { venue: 'deribit', oi: 30, oiUsd: 300_000 } }, // +37.5% → out
    ]);
    const rows = aggregateHeatRows([c], 80_000, 'contracts', new Set(), 'both');
    expect(rows.map((r) => r.strike)).toEqual([80_000]);
  });

  it('mode "contracts" sums openInterest; mode "notional" sums openInterestUsd', () => {
    const c = chain('2026-04-30', 4, [
      { strike: 80_000, call: { venue: 'deribit', oi: 5, oiUsd: 500_000 } },
    ]);
    const contracts = aggregateHeatRows([c], 80_000, 'contracts', new Set(), 'both');
    const notional  = aggregateHeatRows([c], 80_000, 'notional',  new Set(), 'both');
    expect(contracts[0]!.callOi).toBe(5);
    expect(notional[0]!.callOi).toBe(500_000);
  });

  it('side "calls" puts only call OI in magnitude; "puts" only put OI; "both" sums them', () => {
    const c = chain('2026-04-30', 4, [
      {
        strike: 80_000,
        call: { venue: 'deribit', oi: 7, oiUsd: 70 },
        put:  { venue: 'deribit', oi: 3, oiUsd: 30 },
      },
    ]);
    const calls = aggregateHeatRows([c], 80_000, 'contracts', new Set(), 'calls');
    const puts  = aggregateHeatRows([c], 80_000, 'contracts', new Set(), 'puts');
    const both  = aggregateHeatRows([c], 80_000, 'contracts', new Set(), 'both');
    expect(calls[0]!.magnitude).toBe(7);
    expect(puts[0]!.magnitude).toBe(3);
    expect(both[0]!.magnitude).toBe(10);
  });

  it('dominant is "call" when callOi >= putOi, "put" otherwise', () => {
    const tied = chain('2026-04-30', 4, [
      {
        strike: 80_000,
        call: { venue: 'deribit', oi: 5, oiUsd: 50 },
        put:  { venue: 'deribit', oi: 5, oiUsd: 50 },
      },
    ]);
    const callDom = chain('2026-04-30', 4, [
      {
        strike: 80_000,
        call: { venue: 'deribit', oi: 10, oiUsd: 100 },
        put:  { venue: 'deribit', oi: 1, oiUsd: 10 },
      },
    ]);
    const putDom = chain('2026-04-30', 4, [
      {
        strike: 80_000,
        call: { venue: 'deribit', oi: 1, oiUsd: 10 },
        put:  { venue: 'deribit', oi: 10, oiUsd: 100 },
      },
    ]);
    expect(aggregateHeatRows([tied],    80_000, 'contracts', new Set(), 'both')[0]!.dominant).toBe('call');
    expect(aggregateHeatRows([callDom], 80_000, 'contracts', new Set(), 'both')[0]!.dominant).toBe('call');
    expect(aggregateHeatRows([putDom],  80_000, 'contracts', new Set(), 'both')[0]!.dominant).toBe('put');
  });

  it('excludes hidden expiries from the OI sum', () => {
    const a = chain('2026-04-27', 1, [{ strike: 80_000, call: { venue: 'deribit', oi: 4, oiUsd: 40 } }]);
    const b = chain('2026-04-28', 2, [{ strike: 80_000, call: { venue: 'deribit', oi: 6, oiUsd: 60 } }]);
    const all   = aggregateHeatRows([a, b], 80_000, 'contracts', new Set(),               'both');
    const onlyA = aggregateHeatRows([a, b], 80_000, 'contracts', new Set(['2026-04-28']), 'both');
    expect(all[0]!.callOi).toBe(10);
    expect(onlyA[0]!.callOi).toBe(4);
  });

  it('returns empty array when every expiry is hidden', () => {
    const a = chain('2026-04-27', 1, [{ strike: 80_000, call: { venue: 'deribit', oi: 4, oiUsd: 40 } }]);
    const rows = aggregateHeatRows([a], 80_000, 'contracts', new Set(['2026-04-27']), 'both');
    expect(rows).toEqual([]);
  });

  it('returns rows sorted ascending by strike', () => {
    const c = chain('2026-04-30', 4, [
      { strike: 79_000, call: { venue: 'deribit', oi: 1, oiUsd: 10 } },
      { strike: 81_000, call: { venue: 'deribit', oi: 1, oiUsd: 10 } },
      { strike: 80_000, call: { venue: 'deribit', oi: 1, oiUsd: 10 } },
    ]);
    const rows = aggregateHeatRows([c], 80_000, 'contracts', new Set(), 'both');
    expect(rows.map((r) => r.strike)).toEqual([79_000, 80_000, 81_000]);
  });
});
```

- [ ] **Step 3.2: Run the test to verify it fails**

Run: `pnpm --filter @oggregator/web test -- oi-heatmap-utils`
Expected: FAIL with "aggregateHeatRows is not a function" or similar.

- [ ] **Step 3.3: Implement `aggregateHeatRows` in `oi-heatmap-utils.ts`**

Append to `packages/web/src/features/analytics/oi-by-strike/oi-heatmap-utils.ts`:

```ts
export type HeatSide = 'calls' | 'puts' | 'both';

export interface HeatRow {
  strike: number;
  callOi: number;
  putOi: number;
  magnitude: number;
  dominant: 'call' | 'put';
}

export function aggregateHeatRows(
  chains: EnrichedChainResponse[],
  spotPrice: number | null,
  mode: OiMode,
  hiddenExpiries: Set<string>,
  side: HeatSide,
): HeatRow[] {
  const readOi = mode === 'notional'
    ? (q: { openInterestUsd: number | null } | undefined) => q?.openInterestUsd ?? 0
    : (q: { openInterest: number | null } | undefined) => q?.openInterest ?? 0;

  const map = new Map<number, { callOi: number; putOi: number }>();

  for (const chain of chains) {
    if (hiddenExpiries.has(chain.expiry)) continue;
    for (const strike of chain.strikes) {
      const acc = map.get(strike.strike) ?? { callOi: 0, putOi: 0 };
      for (const q of Object.values(strike.call.venues)) acc.callOi += readOi(q);
      for (const q of Object.values(strike.put.venues))  acc.putOi  += readOi(q);
      map.set(strike.strike, acc);
    }
  }

  const band = spotPrice ? spotPrice * 0.3 : Infinity;
  const rows: HeatRow[] = [];
  for (const [strike, { callOi, putOi }] of map.entries()) {
    if (callOi <= 0 && putOi <= 0) continue;
    if (spotPrice && Math.abs(strike - spotPrice) > band) continue;
    const magnitude = side === 'calls' ? callOi : side === 'puts' ? putOi : callOi + putOi;
    if (magnitude <= 0) continue;
    rows.push({
      strike,
      callOi,
      putOi,
      magnitude,
      dominant: callOi >= putOi ? 'call' : 'put',
    });
  }
  return rows.sort((a, b) => a.strike - b.strike);
}
```

- [ ] **Step 3.4: Run the test to verify it passes**

Run: `pnpm --filter @oggregator/web test -- oi-heatmap-utils`
Expected: all `aggregateHeatRows` tests PASS.

- [ ] **Step 3.5: Commit**

```bash
git add packages/web/src/features/analytics/oi-by-strike/oi-heatmap-utils.ts packages/web/src/features/analytics/oi-by-strike/oi-heatmap-utils.test.ts
git commit -m "feat(web): add aggregateHeatRows helper for OI heatmap"
```

---

## Task 4: TDD `computeOpacity`

**Goal:** Sqrt-scaled magnitude → alpha in `[0.05, 0.95]`.

- [ ] **Step 4.1: Add the failing tests**

Append to `oi-heatmap-utils.test.ts`:

```ts
import { computeOpacity } from './oi-heatmap-utils';

describe('computeOpacity', () => {
  it('returns the floor 0.05 for magnitude 0', () => {
    expect(computeOpacity(0, 100)).toBeCloseTo(0.05, 5);
  });

  it('returns the ceiling 0.95 for magnitude == maxMagnitude', () => {
    expect(computeOpacity(100, 100)).toBeCloseTo(0.95, 5);
  });

  it('produces ~0.5 for magnitude == 0.25 × max (sqrt curve sanity)', () => {
    const v = computeOpacity(25, 100);
    expect(v).toBeGreaterThan(0.45);
    expect(v).toBeLessThan(0.55);
  });

  it('returns the floor when maxMagnitude is 0 (no NaN)', () => {
    expect(computeOpacity(0,   0)).toBeCloseTo(0.05, 5);
    expect(computeOpacity(100, 0)).toBeCloseTo(0.05, 5);
  });

  it('clamps inputs above max to the ceiling', () => {
    expect(computeOpacity(200, 100)).toBeCloseTo(0.95, 5);
  });
});
```

- [ ] **Step 4.2: Run tests to verify failure**

Run: `pnpm --filter @oggregator/web test -- oi-heatmap-utils`
Expected: new tests FAIL with "computeOpacity is not a function".

- [ ] **Step 4.3: Implement `computeOpacity`**

Append to `oi-heatmap-utils.ts`:

```ts
const OPACITY_FLOOR = 0.05;
const OPACITY_CEILING = 0.95;

export function computeOpacity(magnitude: number, maxMagnitude: number): number {
  if (maxMagnitude <= 0) return OPACITY_FLOOR;
  const ratio = Math.max(0, Math.min(1, magnitude / maxMagnitude));
  return OPACITY_FLOOR + Math.sqrt(ratio) * (OPACITY_CEILING - OPACITY_FLOOR);
}
```

- [ ] **Step 4.4: Run tests to verify pass**

Run: `pnpm --filter @oggregator/web test -- oi-heatmap-utils`
Expected: all PASS.

- [ ] **Step 4.5: Commit**

```bash
git add packages/web/src/features/analytics/oi-by-strike/
git commit -m "feat(web): add computeOpacity helper (sqrt scaling, clamped)"
```

---

## Task 5: TDD `heatColor`

**Goal:** Build an `rgba(...)` string from a `HeatRow` using the existing call/put palette and the computed alpha.

- [ ] **Step 5.1: Add the failing tests**

Append to `oi-heatmap-utils.test.ts`:

```ts
import { heatColor } from './oi-heatmap-utils';
import type { HeatRow } from './oi-heatmap-utils';

function row(dominant: 'call' | 'put', magnitude: number): HeatRow {
  return {
    strike: 80_000,
    callOi: dominant === 'call' ? magnitude : 0,
    putOi:  dominant === 'put'  ? magnitude : 0,
    magnitude,
    dominant,
  };
}

describe('heatColor', () => {
  it('returns an rgba string with green channel dominant for call rows', () => {
    const out = heatColor(row('call', 100), 100);
    // #00E997 = rgb(0, 233, 151)
    expect(out).toMatch(/^rgba\(0,\s*233,\s*151,\s*[0-9.]+\)$/);
  });

  it('returns an rgba string with red channel dominant for put rows', () => {
    const out = heatColor(row('put', 100), 100);
    // #CB3855 = rgb(203, 56, 85)
    expect(out).toMatch(/^rgba\(203,\s*56,\s*85,\s*[0-9.]+\)$/);
  });

  it('embeds the computed alpha (0.95 at max magnitude)', () => {
    const out = heatColor(row('call', 100), 100);
    const m = out.match(/rgba\(0,\s*233,\s*151,\s*([0-9.]+)\)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(0.95, 2);
  });

  it('embeds the floor alpha (0.05) when magnitude is 0', () => {
    const out = heatColor(row('call', 0), 100);
    const m = out.match(/rgba\(0,\s*233,\s*151,\s*([0-9.]+)\)/);
    expect(Number(m![1])).toBeCloseTo(0.05, 2);
  });
});
```

- [ ] **Step 5.2: Run tests to verify failure**

Run: `pnpm --filter @oggregator/web test -- oi-heatmap-utils`
Expected: heatColor tests FAIL.

- [ ] **Step 5.3: Implement `heatColor`**

Append to `oi-heatmap-utils.ts`:

```ts
const CALL_RGB = '0, 233, 151';   // #00E997
const PUT_RGB  = '203, 56, 85';   // #CB3855

export function heatColor(row: HeatRow, maxMagnitude: number): string {
  const alpha = computeOpacity(row.magnitude, maxMagnitude);
  const rgb = row.dominant === 'call' ? CALL_RGB : PUT_RGB;
  return `rgba(${rgb}, ${alpha.toFixed(3)})`;
}
```

- [ ] **Step 5.4: Run tests to verify pass**

Run: `pnpm --filter @oggregator/web test -- oi-heatmap-utils`
Expected: all PASS.

- [ ] **Step 5.5: Commit**

```bash
git add packages/web/src/features/analytics/oi-by-strike/
git commit -m "feat(web): add heatColor helper (call/put palette, sqrt alpha)"
```

---

## Task 6: Implement `HeatBandPrimitive`

**Goal:** A `lightweight-charts` v5 `ISeriesPrimitive` that draws a thin (~4px) horizontal heat line at every strike's Y coordinate using `heatColor`. Uses the series' `priceToCoordinate` captured during the `attached` lifecycle hook.

**Files:**
- Create: `packages/web/src/features/analytics/oi-by-strike/HeatBandPrimitive.ts`

- [ ] **Step 6.1: Create `HeatBandPrimitive.ts`**

```ts
// packages/web/src/features/analytics/oi-by-strike/HeatBandPrimitive.ts
import type {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  ISeriesApi,
  SeriesType,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

import { heatColor, type HeatRow } from './oi-heatmap-utils';

const BAND_THICKNESS_PX = 4;

class HeatBandRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly rows: HeatRow[],
    private readonly maxMagnitude: number,
    private readonly priceToY: (price: number) => number | null,
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      const { context: ctx, bitmapSize, verticalPixelRatio } = scope;
      const halfHeightPx = (BAND_THICKNESS_PX / 2) * verticalPixelRatio;

      for (const row of this.rows) {
        const yMedia = this.priceToY(row.strike);
        if (yMedia === null) continue;
        const yBitmap = yMedia * verticalPixelRatio;
        ctx.fillStyle = heatColor(row, this.maxMagnitude);
        ctx.fillRect(0, yBitmap - halfHeightPx, bitmapSize.width, halfHeightPx * 2);
      }
    });
  }
}

class HeatBandPaneView implements IPrimitivePaneView {
  constructor(
    private readonly rows: HeatRow[],
    private readonly maxMagnitude: number,
    private readonly priceToY: (price: number) => number | null,
  ) {}

  renderer(): IPrimitivePaneRenderer {
    return new HeatBandRenderer(this.rows, this.maxMagnitude, this.priceToY);
  }
}

export class HeatBandPrimitive
  implements ISeriesPrimitive<Time>
{
  private rows: HeatRow[] = [];
  private maxMagnitude = 1;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  attached(param: SeriesAttachedParameter<Time>): void {
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.series = null;
    this.requestUpdate = null;
  }

  update(rows: HeatRow[]): void {
    this.rows = rows;
    this.maxMagnitude = rows.reduce((m, r) => (r.magnitude > m ? r.magnitude : m), 1);
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this.series) return [];
    const series = this.series;
    const priceToY = (price: number): number | null => series.priceToCoordinate(price);
    return [new HeatBandPaneView(this.rows, this.maxMagnitude, priceToY)];
  }
}
```

- [ ] **Step 6.2: Run typecheck**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: PASS. If it fails on `fancy-canvas` import resolution, change the import to `import type { CanvasRenderingTarget2D } from 'fancy-canvas/canvas-rendering-target';` or inline the type as `interface CanvasRenderingTarget2D { useBitmapCoordinateSpace<T>(f: (scope: { context: CanvasRenderingContext2D; bitmapSize: { width: number; height: number }; verticalPixelRatio: number }) => T): T; }`.

- [ ] **Step 6.3: Commit**

```bash
git add packages/web/src/features/analytics/oi-by-strike/HeatBandPrimitive.ts
git commit -m "feat(web): add HeatBandPrimitive for OI heatmap rendering"
```

---

## Task 7: Add CSS for the heatmap layout

**Goal:** Card-level layout for V2: header with V1/V2 toggle, controls row, legend row, fixed-height chart container.

**Files:**
- Modify: `packages/web/src/features/analytics/AnalyticsView.module.css`

- [ ] **Step 7.1: Append heatmap-specific classes**

Append to the bottom of `AnalyticsView.module.css`:

```css
/* ── OI Heatmap (V2) ───────────────────────────────── */

.oiVersionToggle {
  display: flex;
  gap: 0;
}

.heatControls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.heatChartWrap {
  position: relative;
  width: 100%;
  height: 480px;
  background: var(--bg-base, #0a0c10);
  border-radius: var(--radius-sm);
}

.heatChartCanvas {
  width: 100%;
  height: 100%;
}

.heatStatusOverlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-dim);
  pointer-events: none;
}

.heatStatusOverlay button {
  pointer-events: auto;
  background: transparent;
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  cursor: pointer;
}

.heatStatusOverlay button:hover {
  border-color: var(--text-primary);
}
```

- [ ] **Step 7.2: Verify CSS compiles**

Run: `pnpm --filter @oggregator/web build`
Expected: build succeeds; no CSS Module errors.

- [ ] **Step 7.3: Commit**

```bash
git add packages/web/src/features/analytics/AnalyticsView.module.css
git commit -m "feat(web): add CSS for OI heatmap card"
```

---

## Task 8: Implement `OiHeatmap` (V2) component

**Goal:** Set up a `lightweight-charts` instance with a candle series, attach `HeatBandPrimitive`, manage all V2 state, render toggles + tenor legend + chart, hook the V1 tooltip into the crosshair, and handle empty/loading/error states.

**Files:**
- Create: `packages/web/src/features/analytics/oi-by-strike/OiHeatmap.tsx`

- [ ] **Step 8.1: Add the time-range mapping helper at the top of the file**

```tsx
// packages/web/src/features/analytics/oi-by-strike/OiHeatmap.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
} from 'lightweight-charts';

import type { EnrichedChainResponse } from '@shared/enriched';
import type { SpotCandleCurrency, SpotCandleResolutionSec } from '@shared/common';
import { fmtUsdCompact, fmtCompact, formatExpiry } from '@lib/format';

import styles from '../AnalyticsView.module.css';
import { HeatBandPrimitive } from './HeatBandPrimitive';
import {
  aggregateHeatRows,
  aggregateStrikeOi,
  computeMaxPain,
  type HeatSide,
  type OiMode,
  type StrikeOi,
} from './oi-heatmap-utils';
import { useSpotCandles } from './queries';

const EXPIRY_COLORS = [
  '#00E997', '#CB3855', '#50D2C1', '#F0B90B', '#0052FF',
  '#F7A600', '#25FAAF', '#8B5CF6', '#EC4899', '#6366F1',
  '#A855F7', '#14B8A6',
];

type TimeRange = '24h' | '7d' | '30d';

interface RangeParams {
  resolution: SpotCandleResolutionSec;
  buckets: number;
}

const TIME_RANGE: Record<TimeRange, RangeParams> = {
  '24h': { resolution: 1800,  buckets: 48 },
  '7d':  { resolution: 3600,  buckets: 168 },
  '30d': { resolution: 14400, buckets: 180 },
};
```

- [ ] **Step 8.2: Implement the component body**

Continue the same file:

```tsx
interface Props {
  chains: EnrichedChainResponse[];
  spotPrice: number | null;
  currency: SpotCandleCurrency;
}

export default function OiHeatmap({ chains, spotPrice, currency }: Props) {
  const [mode, setMode] = useState<OiMode>('contracts');
  const [side, setSide] = useState<HeatSide>('both');
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(new Set());
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const primitiveRef = useRef<HeatBandPrimitive | null>(null);
  const strikeLinesRef = useRef<Map<number, IPriceLine>>(new Map());
  const spotLineRef = useRef<IPriceLine | null>(null);
  const maxPainLineRef = useRef<IPriceLine | null>(null);

  const range = TIME_RANGE[timeRange];
  const { data: candleData, isLoading: candlesLoading, error: candlesError, refetch } =
    useSpotCandles(currency, range.resolution, range.buckets);

  const sortedExpiries = useMemo(() => chains.map((c) => c.expiry).sort(), [chains]);
  const expiryColorMap = useMemo(
    () => new Map(sortedExpiries.map((exp, i) => [exp, EXPIRY_COLORS[i % EXPIRY_COLORS.length]!])),
    [sortedExpiries],
  );

  const heatRows = useMemo(
    () => aggregateHeatRows(chains, spotPrice, mode, hiddenExpiries, side),
    [chains, spotPrice, mode, hiddenExpiries, side],
  );

  // Tooltip needs venue/expiry breakdown (re-uses V1 aggregation).
  const fullStrikeData = useMemo(
    () => aggregateStrikeOi(
      chains.filter((c) => !hiddenExpiries.has(c.expiry)),
      spotPrice,
      mode,
    ),
    [chains, hiddenExpiries, spotPrice, mode],
  );

  const maxPain = useMemo(
    () => computeMaxPain(chains.filter((c) => !hiddenExpiries.has(c.expiry))),
    [chains, hiddenExpiries],
  );

  // ── Chart lifecycle (mount/unmount only) ────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9aa0a6',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: '#1A1A1A' }, horzLines: { color: '#1A1A1A' } },
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: '#1F2937', timeVisible: true, secondsVisible: false },
      crosshair: {
        horzLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
        vertLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#00E997',
      downColor: '#CB3855',
      wickUpColor: '#00E997',
      wickDownColor: '#CB3855',
      borderVisible: false,
      priceLineVisible: false,
    });

    const primitive = new HeatBandPrimitive();
    series.attachPrimitive(primitive);

    chartRef.current = chart;
    seriesRef.current = series;
    primitiveRef.current = primitive;

    const onCrosshair = chart.subscribeCrosshairMove((param) => {
      if (param.point === undefined || param.time === undefined) {
        setHoveredStrike(null);
        setTooltipPos(null);
        return;
      }
      const price = series.coordinateToPrice(param.point.y);
      if (price === null) return;
      // nearest strike in heatRows (linear scan — small N)
      let nearest: number | null = null;
      let bestDist = Infinity;
      for (const row of heatRowsRef.current) {
        const d = Math.abs(row.strike - price);
        if (d < bestDist) { bestDist = d; nearest = row.strike; }
      }
      setHoveredStrike(nearest);
      setTooltipPos({ x: param.point.x, y: param.point.y });
    });

    return () => {
      onCrosshair; // subscribeCrosshairMove returns void in v5, no manual unsubscribe needed
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      primitiveRef.current = null;
      strikeLinesRef.current.clear();
      spotLineRef.current = null;
      maxPainLineRef.current = null;
    };
  }, []);

  // Keep a ref of latest heatRows so the crosshair callback can read it without re-subscribing.
  const heatRowsRef = useRef(heatRows);
  useEffect(() => { heatRowsRef.current = heatRows; }, [heatRows]);

  // ── Push candle data ──────────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !candleData) return;
    const data = candleData.candles.map((c) => ({
      time: Math.floor(c.timestamp / 1000) as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    series.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [candleData]);

  // ── Push heat rows to the primitive ───────────────────────────
  useEffect(() => {
    primitiveRef.current?.update(heatRows);
  }, [heatRows]);

  // ── Diff strike axis labels ───────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const next = new Set(heatRows.map((r) => r.strike));
    const lines = strikeLinesRef.current;

    // remove
    for (const [strike, line] of lines.entries()) {
      if (!next.has(strike)) {
        series.removePriceLine(line);
        lines.delete(strike);
      }
    }
    // add
    for (const row of heatRows) {
      if (lines.has(row.strike)) continue;
      const line = series.createPriceLine({
        price: row.strike,
        color: 'transparent',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        lineVisible: false,
        axisLabelVisible: true,
        title: row.strike.toLocaleString(),
        axisLabelColor: row.dominant === 'call' ? '#0E3D2C' : '#3D0E1A',
        axisLabelTextColor: row.dominant === 'call' ? '#00E997' : '#CB3855',
      });
      lines.set(row.strike, line);
    }
  }, [heatRows]);

  // ── SPOT and MP price lines ───────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (spotLineRef.current) {
      series.removePriceLine(spotLineRef.current);
      spotLineRef.current = null;
    }
    if (spotPrice != null) {
      spotLineRef.current = series.createPriceLine({
        price: spotPrice,
        color: '#50D2C1',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `${Math.round(spotPrice).toLocaleString()} SPOT`,
      });
    }
  }, [spotPrice]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (maxPainLineRef.current) {
      series.removePriceLine(maxPainLineRef.current);
      maxPainLineRef.current = null;
    }
    if (maxPain != null) {
      maxPainLineRef.current = series.createPriceLine({
        price: maxPain,
        color: '#F0B90B',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${maxPain.toLocaleString()} MP`,
      });
    }
  }, [maxPain]);

  const toggleExpiry = (expiry: string) => {
    setHiddenExpiries((prev) => {
      const next = new Set(prev);
      if (next.has(expiry)) next.delete(expiry);
      else next.add(expiry);
      return next;
    });
  };

  const fmt = mode === 'notional' ? fmtUsdCompact : fmtCompact;
  const hovered = hoveredStrike != null
    ? fullStrikeData.find((s) => s.strike === hoveredStrike) ?? null
    : null;
  const allHidden = hiddenExpiries.size > 0 && hiddenExpiries.size === sortedExpiries.length;

  return (
    <div>
      <div className={styles.heatControls}>
        <div className={styles.oiToggle}>
          <button className={styles.oiToggleBtn} data-active={mode === 'contracts' || undefined} onClick={() => setMode('contracts')}>Contracts</button>
          <button className={styles.oiToggleBtn} data-active={mode === 'notional'  || undefined} onClick={() => setMode('notional')}>Notional</button>
        </div>
        <div className={styles.oiToggle}>
          <button className={styles.oiToggleBtn} data-active={side === 'calls' || undefined} onClick={() => setSide('calls')}>Calls</button>
          <button className={styles.oiToggleBtn} data-active={side === 'puts'  || undefined} onClick={() => setSide('puts')}>Puts</button>
          <button className={styles.oiToggleBtn} data-active={side === 'both'  || undefined} onClick={() => setSide('both')}>Both</button>
        </div>
        <div className={styles.oiToggle}>
          {(['24h', '7d', '30d'] as TimeRange[]).map((r) => (
            <button key={r} className={styles.oiToggleBtn} data-active={timeRange === r || undefined} onClick={() => setTimeRange(r)}>{r}</button>
          ))}
        </div>
      </div>

      <div className={styles.curveLegend}>
        {sortedExpiries.map((expiry) => {
          const active = !hiddenExpiries.has(expiry);
          return (
            <button
              key={expiry}
              type="button"
              className={styles.curveLegendItem}
              data-active={active || undefined}
              onClick={() => toggleExpiry(expiry)}
            >
              <span className={styles.curveLegendDot} style={{ background: expiryColorMap.get(expiry) }} />
              {formatExpiry(expiry)}
            </button>
          );
        })}
      </div>

      <div className={styles.heatChartWrap}>
        <div className={styles.heatChartCanvas} ref={containerRef} />

        {candlesLoading && !candleData && (
          <div className={styles.heatStatusOverlay}>Loading spot history…</div>
        )}
        {candlesError && (
          <div className={styles.heatStatusOverlay}>
            <div>Spot history unavailable</div>
            <button onClick={() => refetch()}>Retry</button>
          </div>
        )}
        {allHidden && (
          <div className={styles.heatStatusOverlay}>
            All expiries hidden — re-enable one in the legend above.
          </div>
        )}

        {hovered && tooltipPos && (
          <HeatTooltip
            data={hovered}
            tooltipPos={tooltipPos}
            expiryColorMap={expiryColorMap}
            fmt={fmt}
          />
        )}
      </div>
    </div>
  );
}

function HeatTooltip({
  data,
  tooltipPos,
  expiryColorMap,
  fmt,
}: {
  data: StrikeOi;
  tooltipPos: { x: number; y: number };
  expiryColorMap: Map<string, string>;
  fmt: (v: number | null | undefined) => string;
}) {
  return (
    <div
      className={styles.oiTooltip}
      style={{ left: tooltipPos.x + 16, top: tooltipPos.y - 8 }}
    >
      <div className={styles.oiTooltipTitle}>{data.strike.toLocaleString()}</div>
      <div className={styles.oiTooltipColumns}>
        {data.venues.length > 0 && (
          <div className={styles.oiTooltipCol}>
            <div className={styles.oiTooltipSection}>By Venue</div>
            <div className={styles.oiTooltipHeader}><span /><span>Calls</span><span>Puts</span></div>
            {data.venues.map((v) => (
              <div key={v.venue} className={styles.oiTooltipRow}>
                <span className={styles.oiTooltipVenue}>{v.venue}</span>
                <span className={styles.oiCall}>{fmt(v.callOi)}</span>
                <span className={styles.oiPut}>{fmt(v.putOi)}</span>
              </div>
            ))}
          </div>
        )}
        {data.expiries.length > 1 && (
          <div className={styles.oiTooltipCol}>
            <div className={styles.oiTooltipSection}>By Expiry</div>
            <div className={styles.oiTooltipHeader}><span /><span>Calls</span><span>Puts</span></div>
            {data.expiries.map((ep) => (
              <div key={ep.expiry} className={styles.oiTooltipRow}>
                <span className={styles.oiTooltipVenue}>
                  <span className={styles.oiTooltipDot} style={{ background: expiryColorMap.get(ep.expiry) }} />
                  {ep.expiry}
                </span>
                <span className={styles.oiCall}>{fmt(ep.callOi)}</span>
                <span className={styles.oiPut}>{fmt(ep.putOi)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8.3: Run typecheck**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: PASS. Likely error to fix: `ISeriesApi<'Candlestick', Time>` may need `'Candlestick'` typed via `SeriesType['Candlestick']` — check the actual type on `chart.addSeries(CandlestickSeries, ...)` return.

If `series.attachPrimitive` rejects `HeatBandPrimitive` for variance reasons, type the primitive as `ISeriesPrimitive<Time>` at the local `const primitive: ISeriesPrimitive<Time> = new HeatBandPrimitive();` and cast at attach.

- [ ] **Step 8.4: Commit**

```bash
git add packages/web/src/features/analytics/oi-by-strike/OiHeatmap.tsx
git commit -m "feat(web): add OiHeatmap V2 component (lightweight-charts + heat primitive)"
```

---

## Task 9: Implement `OiByStrikeCard` shell + smoke test

**Goal:** A small parent component that owns the `V1 | V2` toggle and the Max-Pain badge, routes to the appropriate child, and is the only export from the sub-folder consumed by `AnalyticsView`.

**Files:**
- Create: `packages/web/src/features/analytics/oi-by-strike/OiByStrikeCard.tsx`
- Create: `packages/web/src/features/analytics/oi-by-strike/OiByStrikeCard.test.tsx`
- Modify: `packages/web/src/features/analytics/oi-by-strike/index.ts`

- [ ] **Step 9.1: Write the failing component test**

```tsx
// packages/web/src/features/analytics/oi-by-strike/OiByStrikeCard.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import OiByStrikeCard from './OiByStrikeCard';

// Stub lightweight-charts so the canvas chart never tries to mount in jsdom.
vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => ({
      attachPrimitive: () => undefined,
      setData: () => undefined,
      createPriceLine: () => ({}),
      removePriceLine: () => undefined,
      coordinateToPrice: () => null,
    }),
    subscribeCrosshairMove: () => undefined,
    timeScale: () => ({ fitContent: () => undefined }),
    remove: () => undefined,
  }),
  ColorType: { Solid: 'solid' },
  LineStyle: { Solid: 0, Dashed: 1, Dotted: 2 },
  CandlestickSeries: 'CandlestickSeries',
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('OiByStrikeCard', () => {
  beforeEach(() => {
    // useSpotCandles will call fetch via fetchJson; stub it.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ currency: 'BTC', resolution: 3600, count: 0, candles: [] }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders V1 by default and shows the V1/V2 toggle', () => {
    render(wrap(<OiByStrikeCard chains={[]} spotPrice={null} currency="BTC" />));
    expect(screen.getByRole('button', { name: 'V1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'V2' })).toBeTruthy();
    // V1 controls present
    expect(screen.getByRole('button', { name: 'Contracts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notional'  })).toBeTruthy();
    // V2-only side toggle absent
    expect(screen.queryByRole('button', { name: 'Calls' })).toBeNull();
  });

  it('switches to V2 when V2 is clicked, exposing the Calls/Puts/Both and time-range toggles', () => {
    render(wrap(<OiByStrikeCard chains={[]} spotPrice={null} currency="BTC" />));
    fireEvent.click(screen.getByRole('button', { name: 'V2' }));
    expect(screen.getByRole('button', { name: 'Calls' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Puts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Both' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '24h' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '7d' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '30d' })).toBeTruthy();
  });

  it('switches back to V1 when V1 is clicked', () => {
    render(wrap(<OiByStrikeCard chains={[]} spotPrice={null} currency="BTC" />));
    fireEvent.click(screen.getByRole('button', { name: 'V2' }));
    fireEvent.click(screen.getByRole('button', { name: 'V1' }));
    expect(screen.getByRole('button', { name: 'Contracts' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Calls' })).toBeNull();
  });
});
```

- [ ] **Step 9.2: Run the test to verify failure**

Run: `pnpm --filter @oggregator/web test -- OiByStrikeCard`
Expected: FAIL with "Cannot find module './OiByStrikeCard'".

- [ ] **Step 9.3: Implement `OiByStrikeCard.tsx`**

```tsx
// packages/web/src/features/analytics/oi-by-strike/OiByStrikeCard.tsx
import { useState } from 'react';
import type { EnrichedChainResponse } from '@shared/enriched';
import type { SpotCandleCurrency } from '@shared/common';

import styles from '../AnalyticsView.module.css';
import OiByStrikeChart from './OiByStrikeChart';
import OiHeatmap from './OiHeatmap';
import { computeMaxPain } from './oi-heatmap-utils';

type Version = 'v1' | 'v2';

interface Props {
  chains: EnrichedChainResponse[];
  spotPrice: number | null;
  currency: SpotCandleCurrency;
}

export default function OiByStrikeCard({ chains, spotPrice, currency }: Props) {
  const [version, setVersion] = useState<Version>('v1');
  const maxPain = computeMaxPain(chains);

  return (
    <div className={styles.card} style={{ position: 'relative' }}>
      <div className={styles.oiHeader}>
        <div className={styles.cardTitle}>Open Interest by Strike</div>
        <div className={styles.oiControls}>
          <div className={styles.oiToggle}>
            <button
              className={styles.oiToggleBtn}
              data-active={version === 'v1' || undefined}
              onClick={() => setVersion('v1')}
            >
              V1
            </button>
            <button
              className={styles.oiToggleBtn}
              data-active={version === 'v2' || undefined}
              onClick={() => setVersion('v2')}
            >
              V2
            </button>
          </div>
          {maxPain != null && (
            <div className={styles.maxPainBadge}>
              Max Pain: <strong>{maxPain.toLocaleString()}</strong>
            </div>
          )}
        </div>
      </div>

      {version === 'v1'
        ? <OiByStrikeChart chains={chains} spotPrice={spotPrice} />
        : <OiHeatmap chains={chains} spotPrice={spotPrice} currency={currency} />}
    </div>
  );
}
```

> Note: `OiByStrikeChart` (V1) currently renders its own card wrapper (`<div className={styles.card}>`). Since `OiByStrikeCard` now provides the wrapper, **strip the outer `.card` wrapper from `OiByStrikeChart.tsx`** so it doesn't double-wrap. Specifically: in `OiByStrikeChart.tsx`, change the top-level returned JSX from `<div className={styles.card} ref={cardRef} style={{ position: 'relative' }}>...</div>` to just `<>...</>`. Move the `cardRef` and tooltip positioning logic accordingly — since the parent now owns `position: relative`, tooltip coordinates remain card-relative.
>
> Move the original V1 header (the `<div className={styles.oiHeader}>` block containing the title, contracts/notional toggle, and max-pain badge) into a slimmer V1-only header that **only** contains the contracts/notional toggle. The title and max-pain badge are now rendered by `OiByStrikeCard` and must not appear twice. Keep V1's tenor legend and bar list intact.

- [ ] **Step 9.4: Update `OiByStrikeChart.tsx` to remove the card wrapper, title, and max-pain badge**

In `packages/web/src/features/analytics/oi-by-strike/OiByStrikeChart.tsx`:
1. Change the outer wrapper from `<div className={styles.card} ref={cardRef} style={{ position: 'relative' }}>` to `<div ref={cardRef} style={{ position: 'relative' }}>`.
2. Remove the `<div className={styles.cardTitle}>Open Interest by Strike</div>` element.
3. Remove the `{maxPain != null && (<div className={styles.maxPainBadge}>...)}` element.
4. Keep the `<div className={styles.oiControls}>` wrapper holding the Contracts/Notional toggle. (The `oiHeader` flex container can be kept; it just no longer contains a title.)

- [ ] **Step 9.5: Update `index.ts` to export `OiByStrikeCard`**

```ts
// packages/web/src/features/analytics/oi-by-strike/index.ts
export { default as OiByStrikeCard } from './OiByStrikeCard';
export { default as OiByStrikeChart } from './OiByStrikeChart';
```

- [ ] **Step 9.6: Run the smoke test to verify pass**

Run: `pnpm --filter @oggregator/web test -- OiByStrikeCard`
Expected: 3/3 PASS.

- [ ] **Step 9.7: Run full test suite**

Run: `pnpm --filter @oggregator/web test`
Expected: all previously-passing tests still pass.

- [ ] **Step 9.8: Commit**

```bash
git add packages/web/src/features/analytics/oi-by-strike/
git commit -m "feat(web): add OiByStrikeCard shell with V1/V2 toggle"
```

---

## Task 10: Wire `OiByStrikeCard` into `AnalyticsView`

**Goal:** Replace the V1-direct usage in `AnalyticsView.tsx` with the new card. Pass `currency` (the underlying) so the heatmap can fetch the right spot candles.

**Files:**
- Modify: `packages/web/src/features/analytics/AnalyticsView.tsx`

- [ ] **Step 10.1: Swap the import and the JSX**

In `packages/web/src/features/analytics/AnalyticsView.tsx`:

Replace the import:

```tsx
// before
import { OiByStrikeChart } from './oi-by-strike';
// after
import { OiByStrikeCard } from './oi-by-strike';
```

Replace the JSX usage (currently `<OiByStrikeChart chains={chains} spotPrice={spotPrice} />`):

```tsx
<OiByStrikeCard
  chains={chains}
  spotPrice={spotPrice}
  currency={underlying as 'BTC' | 'ETH'}
/>
```

> Note: `/api/spot-candles` only supports BTC and ETH. If the user is on SOL, the heatmap should still render but the candle endpoint will return 400. We let `useSpotCandles` surface that as an error and rely on the existing error overlay. The `as 'BTC' | 'ETH'` is a type assertion only — the runtime SOL-error path is exercised by the overlay.

- [ ] **Step 10.2: Typecheck and test**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: PASS.

Run: `pnpm --filter @oggregator/web test`
Expected: all PASS.

- [ ] **Step 10.3: Commit**

```bash
git add packages/web/src/features/analytics/AnalyticsView.tsx
git commit -m "feat(web): wire OiByStrikeCard into AnalyticsView"
```

---

## Task 11: Manual verification + final precommit

**Goal:** Verify the live UX before claiming done.

- [ ] **Step 11.1: Start the stack**

Run: `pnpm dev`
Expected: server on :3100, web on :5173, both healthy. Wait for readiness logs (~5–15s as adapters bootstrap per the server CLAUDE.md).

- [ ] **Step 11.2: Open Analytics tab**

Browser: `http://localhost:5173`. Switch to Analytics. Verify:
- The "Open Interest by Strike" card shows `V1 | V2` toggle and Max-Pain badge in its header.
- V1 is selected by default and renders identically to before.

- [ ] **Step 11.3: Switch to V2**

Click `V2`. Verify:
- Three control groups appear: Contracts/Notional, Calls/Puts/Both, 24h/7d/30d.
- Tenor legend (chips) appears below the controls.
- Chart loads spot candles within ~1s; candles flow left-to-right.
- Thin colored heat bands appear at strike levels: green where calls dominate, red where puts dominate.
- Bold strike labels appear on the right axis.
- A SPOT label and an MP (dashed) label are rendered on the right axis.

- [ ] **Step 11.4: Exercise the toggles**

- Switch Calls / Puts / Both → band colors flip to single-side or back to dominant.
- Switch Contracts / Notional → band intensity should re-scale (numeric magnitudes change).
- Switch 24h / 7d / 30d → candle density changes; heat bands do not move.
- Click expiries in the legend on/off → heat opacity updates without flicker. Hide all → "All expiries hidden" overlay appears.

- [ ] **Step 11.5: Tooltip + crosshair**

Hover the chart. Verify the V1 tooltip pops up with venue and expiry breakdown for the strike nearest the crosshair.

- [ ] **Step 11.6: Underlying switch**

Switch the underlying picker to ETH. Verify the V2 chart remounts and renders ETH candles + ETH strikes correctly.

- [ ] **Step 11.7: Window resize**

Resize the browser window. Verify heat lines stay sharp, no shimmer, no jitter on retina.

- [ ] **Step 11.8: Server-side error path**

Stop the spot-candles upstream by killing the server (`Ctrl+C` the dev server) and restarting it; while it bootstraps, V2 should show "Spot history unavailable" with a Retry button. Click Retry once it's ready — chart should populate.

- [ ] **Step 11.9: Run precommit**

Run: `pnpm precommit`
Expected: typecheck + tests both PASS.

- [ ] **Step 11.10: Final commit (no-op if nothing changed)**

If the manual verification surfaced any small fixes, commit them with a focused message. Otherwise nothing to do.

```bash
git status
# if clean: skip
# if dirty: commit the fix with a descriptive message
```

---

## Self-review against spec

**Spec coverage:**
- ✅ V1/V2 toggle on existing card → Task 9 (OiByStrikeCard)
- ✅ Bookmap-style layout (X=time, Y-right=price, candles, thin heat bands) → Task 8 (OiHeatmap)
- ✅ Encoding A (call-green / put-red, sqrt opacity) → Tasks 4, 5, 6
- ✅ Tenor legend toggles control OI sum → Task 8 (`hiddenExpiries` state, passed to `aggregateHeatRows`)
- ✅ Calls / Puts / Both side toggle → Task 8 (`side` state)
- ✅ Contracts / Notional toggle → Task 8 (`mode` state)
- ✅ 24h / 7d / 30d time range → Task 8 (`timeRange` state, `TIME_RANGE` mapping)
- ✅ Bold strike axis labels with SPOT and MP markers → Task 8 (price lines)
- ✅ Strike line diff (no flicker) → Task 8 (Step 8.2 strikeLinesRef diff)
- ✅ V1 tooltip reused in V2 → Task 8 (HeatTooltip uses fullStrikeData from aggregateStrikeOi)
- ✅ Empty filter / loading / 503 handling → Task 8 status overlay
- ✅ Strike filter spot ± 30% → Task 3 (aggregateHeatRows)
- ✅ No new server endpoints → Tasks 2, 8 use only `/api/spot-candles` + existing `/api/chains` data via prop
- ✅ Pure-helper unit tests → Tasks 3, 4, 5
- ✅ Toggle smoke test → Task 9
- ✅ Manual verification → Task 11
- ✅ V1 behavior unchanged → Task 1 (refactor) + Task 9.4 (header de-duplication)

**Out-of-scope items deliberately excluded:**
- OI history persistence (separate spec)
- Trails mode (separate spec, depends on persistence)

**Type / signature consistency check:**
- `aggregateHeatRows(chains, spotPrice, mode, hiddenExpiries, side)` — used identically in Tasks 3 and 8. ✅
- `computeOpacity(magnitude, maxMagnitude)` — Tasks 4 and 5 (heatColor) and 6 (HeatBandPrimitive) call it the same way. ✅
- `heatColor(row, maxMagnitude)` — Tasks 5 and 6 match. ✅
- `HeatBandPrimitive.update(rows: HeatRow[])` — Tasks 6 and 8 match. ✅
- `useSpotCandles(currency, resolution, buckets)` — Tasks 2 and 8 match. ✅
- `OiByStrikeCard` props `{ chains, spotPrice, currency }` — Tasks 9 and 10 match. ✅

**Placeholder scan:** no TBD / TODO / "implement later" in any code block. All steps contain runnable code or explicit literal values.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-26-oi-heatmap-v2.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
