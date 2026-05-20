# OI by Strike — V2 Heatmap (Bookmap-style)

**Date:** 2026-04-26
**Status:** Approved design, ready for implementation plan
**Scope:** Live-only V2 visualization for the existing "Open Interest by Strike" card. No new persistence, no historical OI store, no trails.

## Goal

Add a second visualization mode to the existing `OiByStrikeChart` card on the Analytics view. The user can toggle between **V1** (today's mirrored bar chart) and **V2** (a Bookmap-style heatmap: time on X, price on Y-right, spot OHLC candles flowing left-to-right, thin colored heat bands at each strike level encoding live OI magnitude and call/put dominance).

V1 stays unchanged. V2 is purely additive.

## Non-goals

- **No OI persistence.** OI history is not stored anywhere in the codebase today. V2's heat bands are computed from the *current* chain snapshot only. The same heat values appear at every X-position; only candles move along the time axis. Bookmap-style heat trails (where each X-column shows that moment's snapshot) are out of scope and require a separate spec/plan cycle that introduces an OI history store.
- **No new server endpoints.** V2 reuses the existing `GET /api/chains` (already feeding V1 via WebSocket through `useChainWs`) and the existing `GET /api/spot-candles`.
- **No global state changes.** All V2 controls are local to the card.

## Visual model

```
┌─ Open Interest by Strike ─────────────────  [V1 | V2]   Max Pain: 78,000 ─┐
│ [Contracts | Notional]   [Calls | Puts | Both]   [24h | 7d | 30d]         │
│ ● 27 APR  ● 28 APR  ● 29 APR  …  (tenor legend, click to hide)            │
│                                                                            │
│  ──────────────────────────────────  candles wander right →   ┃  80,500   │
│                                                                ┃  80,000 ▮│ ← thin red band (put-dominated)
│      ╷ ╶━╮      ╷                                              ┃  79,500  │
│     ╶┴╮  ╰─╮  ╶─┴─╮     ╴╮      ╷                              ┃  79,000 ▮│
│        ╰─╮  ╰─╮    ╰─╮ ╶━╯ ╴╮ ╶─╯                              ┃  78,250  ← SPOT
│          ╰╴   ╰╴      ╰╴    ╰╴                                 ┃  78,000 ▮│ ← thick red band, MP
│                                                                ┃  77,500  │
│                                                                ┃  77,000 ▮│ ← thin green band (call-dominated)
│ ─────────────────────────────────────────────────  time ──────┘  76,500  │
└────────────────────────────────────────────────────────────────────────────┘
```

- **X axis (bottom):** time, last 7 days by default (configurable 24h / 7d / 30d).
- **Y axis (right):** price. Bold axis labels at every strike with non-zero OI. Spot price tagged `SPOT`. Max Pain tagged `MP` and dashed.
- **Candles:** spot OHLC from `/api/spot-candles`, flowing left-to-right.
- **Heat bands:** ~4px-thick horizontal stripes centered on each strike. Color encodes call/put dominance; opacity encodes OI magnitude.

## Encoding rules (settled)

- **Color (encoding A — "two-tone, dominant side wins"):**
  - call OI ≥ put OI at this strike → green base `#00E997`
  - put OI > call OI → red base `#CB3855`
- **Opacity:** `clamp(0.05, 0.95, sqrt(magnitude / maxMagnitude))`. Sqrt because OI is heavy-tailed; linear scaling collapses everything but the dominant strike.
- **Magnitude source:** depends on the toggles —
  - `Contracts` → `openInterest`; `Notional` → `openInterestUsd`.
  - `Calls` → call OI only; `Puts` → put OI only; `Both` → call + put.
- **Strike filter:** `|strike − spot| ≤ spot × 0.3` (matches V1).
- **Tenor inclusion:** the per-expiry legend toggles drive a `hiddenExpiries: Set<string>`. Hidden expiries are excluded from the OI sum at each strike. Same legend / palette as V1.
- **Geometry:** thin lines at each strike (~4px), empty space between strikes. Bookmap-faithful, candles read cleanly. Falloff zones / tiled fills explicitly rejected for V1 of V2; can be revisited later.

## Architecture & file layout

The existing `OiByStrikeChart` (currently inside `AnalyticsView.tsx` at lines 369–550) is extracted to its own file unchanged. A new sibling `OiHeatmap` is added. Both are routed through a thin parent `OiByStrikeCard` that owns the V1/V2 toggle.

```
packages/web/src/features/analytics/
  AnalyticsView.tsx                  // unchanged behavior — renders <OiByStrikeCard chains spotPrice currency />
  oi-by-strike/
    index.ts                         // re-exports OiByStrikeCard only
    OiByStrikeCard.tsx               // NEW — card shell + V1/V2 toggle + max-pain badge
    OiByStrikeChart.tsx              // V1 — moved verbatim from AnalyticsView.tsx (no behavior change)
    OiHeatmap.tsx                    // V2 — lightweight-charts setup + state + primitive lifecycle
    HeatBandPrimitive.ts             // NEW — implements ISeriesPrimitive<Time>; draws thin colored lines per strike
    oi-heatmap-utils.ts              // NEW — pure helpers (aggregateHeatRows, computeOpacity, heatColor)
    oi-heatmap-utils.test.ts         // NEW — vitest unit tests for the pure helpers
    OiByStrikeCard.test.tsx          // NEW — toggle wiring smoke test
    queries.ts                       // NEW — useSpotCandles() TanStack Query hook
```

Rationale for the sub-folder: the card grows from one component to three components plus a primitive plus helpers. `AnalyticsView.tsx` is already 600+ lines; pulling V1 out as part of this work keeps it from getting worse and matches how `surface/` is already organized.

## Data flow

**Inputs (no new endpoints):**
- `chains: EnrichedChainResponse[]` — already passed into the existing card from `AnalyticsView`. Live, WS-driven via `useChainWs.ts`.
- `GET /api/spot-candles?currency=BTC&resolution=3600&buckets=168` — already exists. New TanStack Query hook `useSpotCandles(currency, resolution, buckets)` with `staleTime: 30_000` and refetch-on-focus.

**Pure helpers (`oi-heatmap-utils.ts`):**

```ts
type Side = 'calls' | 'puts' | 'both';
type Mode = 'contracts' | 'notional';

interface HeatRow {
  strike: number;
  callOi: number;
  putOi: number;
  magnitude: number;             // depends on side
  dominant: 'call' | 'put';      // tie → 'call'
}

function aggregateHeatRows(
  chains: EnrichedChainResponse[],
  spotPrice: number | null,
  mode: Mode,
  hiddenExpiries: Set<string>,
  side: Side,
): HeatRow[];

function computeOpacity(magnitude: number, maxMagnitude: number): number;
function heatColor(row: HeatRow, maxMagnitude: number): string;  // returns rgba
```

**Shared with V1:** the V1 hover tooltip (`OiStrikeTooltip`) needs the per-venue and per-expiry breakdown (`StrikeOi[]` from V1's `aggregateStrikeOi`). To reuse the tooltip in V2, both `aggregateStrikeOi` and `computeMaxPain` are lifted from `AnalyticsView.tsx` into `oi-heatmap-utils.ts` as part of the V1 extraction step. V1's `OiByStrikeChart.tsx` imports them from the new utils file; V2's `OiHeatmap.tsx` does the same. No behavioral change to V1 — just the import path.

```ts
// also exported from oi-heatmap-utils.ts
function aggregateStrikeOi(...): StrikeOi[];     // unchanged from V1
function computeMaxPain(...): number | null;     // unchanged from V1
```

**Component flow (`OiHeatmap.tsx`):**

```
OiHeatmap (props: chains, spotPrice, currency)
  ├─ useSpotCandles(currency, resolutionFromTimeRange, bucketsFromTimeRange)
  ├─ useState: mode (Contracts/Notional)
  ├─ useState: side (Calls/Puts/Both, default Both)
  ├─ useState: hiddenExpiries: Set<string>
  ├─ useState: timeRange ('24h' | '7d' | '30d', default '7d')
  ├─ useMemo: heatRows = aggregateHeatRows(chains, spotPrice, mode, hidden, side)
  ├─ useMemo: maxPain  = computeMaxPain(filteredChains)   // shared util, lifted from V1
  ├─ chart instance + candle series in useEffect (mount/unmount only)
  ├─ effect: when candles arrive → series.setData(candles)
  ├─ effect: when heatRows / spot / maxPain change →
  │     primitive.update(heatRows)
  │     diff strike priceLines (add new, remove gone)
  │     update SPOT and MP price lines
  └─ effect: subscribeCrosshairMove → derive nearest strike, drive V1's <OiStrikeTooltip>
```

**Time range mapping:**

| Range | resolution (sec) | buckets |
|-------|------------------|---------|
| 24h   | 1800 (30m)       | 48      |
| 7d    | 3600 (1h)        | 168 ← default |
| 30d   | 14400 (4h)       | 180     |

(All within the existing `/api/spot-candles` `MAX_BUCKETS=500` guard and the supported resolution list.)

## HeatBandPrimitive

A `lightweight-charts` v5 pane primitive attached to the candle series. Owns no React state; receives `HeatRow[]` via `update(...)`. Draws into the chart's own canvas, so pan/zoom/resize/DPR are handled automatically by the lib.

```ts
class HeatBandPrimitive implements ISeriesPrimitive<Time> {
  private rows: HeatRow[] = [];
  private maxMagnitude = 1;

  update(rows: HeatRow[]): void;
  paneViews(): IPrimitivePaneView[];   // single view that draws all bands
}
```

Render routine (inside the pane view's `renderer().draw(target)`):

```
target.useBitmapCoordinateSpace(scope => {
  const { context: ctx, bitmapSize } = scope;
  for (const row of rows) {
    const y = priceToCoordinate(row.strike);
    if (y === null) continue;                 // off-screen → skip
    ctx.fillStyle = heatColor(row, maxMagnitude);
    ctx.fillRect(0, y - 2, bitmapSize.width, 4);
  }
});
```

**Bold strike axis labels, SPOT marker, MP marker:** *not* part of the primitive — implemented as native `priceLine`s on the candle series so they pick up the axis font, antialiasing, and Y-axis placement automatically. SPOT line is solid; MP line is dashed; strike lines are invisible (`lineVisible: false`) but expose `axisLabelVisible: true` so only the bold label shows.

**Strike-line diff:** the component holds a `Map<number, IPriceLine>` of currently-rendered strike lines. On every `heatRows` change it computes added/removed strike sets and calls `series.createPriceLine(...)` / `series.removePriceLine(...)` only on the delta — avoids flicker on every render.

**Fallback (recorded for the implementer):** if v5's primitives API can't expose a clean `priceToCoordinate` inside the renderer, fall back to a sibling overlay `<canvas>` synced via `series.priceToCoordinate()` on `subscribeCrosshairMove` / resize. No other part of the design changes.

**Tooltip:** the existing V1 `OiStrikeTooltip` is reused verbatim. Hover detection uses `chart.subscribeCrosshairMove(...)` to find the nearest strike to the crosshair price; when the crosshair leaves the plot, the tooltip hides.

## Card layout & toggle behavior

**Header row** (single line, in `OiByStrikeCard`):

```
[Open Interest by Strike]              [V1 | V2]   [Max Pain: 78,000]
```

The `V1 | V2` segmented control reuses the existing `oiToggle` styling (already used for Contracts/Notional in V1). Default is V1 — opening the Analytics tab keeps today's behavior unchanged.

**V2 body controls** (replace V1's row when V2 is active):

```
[Contracts | Notional]   [Calls | Puts | Both]   [24h | 7d | 30d]
● 27 APR  ● 28 APR  ● 29 APR  …
```

Same legend chips and palette as V1 (`EXPIRY_COLORS`).

**Persistence:** all V2 toggle state (`mode`, `side`, `timeRange`, `hiddenExpiries`) is local component state. Switching underlying remounts the card via `key={underlying}` and resets state. Not stored in Zustand — these are card-local prefs, not app-wide.

## States & error handling

- **Candles loading** → skeleton over the chart area; heat lines hidden until first candle render.
- **Spot-candles 503 (service not ready)** → inline notice "Spot history unavailable" with a manual retry button. Heat bands and strike axis labels still render — the chart shows price scale + heat without candles. React Query's background refetch (30s) will recover automatically.
- **Spot-candles 502 (upstream fetch failed)** → same UI; React Query's exponential backoff handles transient cases.
- **Network drop** → React Query retries with backoff; UI keeps the skeleton until first success.
- **Empty filter set** (every expiry hidden) → small inline message: "All expiries hidden — re-enable one in the legend below." Candles continue rendering.
- **No chains data** → covered by `AnalyticsView`'s parent-level `<Spinner>` (existing).
- **Spot drift outside visible price range** → strike's `priceToCoordinate` returns null; band is skipped that frame. No layout breakage.
- **Magnitude outliers** → `clamp(0.05, 0.95)` on opacity ensures the floor stays visible even when one strike dominates.
- **Cleanup** → chart instance + primitive disposed in `useEffect` cleanup. Pattern copied from `SkewHistory.tsx`.
- **React 19 strict mode double-mount** → handled the same way `SkewHistory.tsx` already handles it (idempotent setup inside `useEffect`, dispose on unmount).

## Testing

Following `.pi/skills/vitest-2026/SKILL.md` and the project's existing pattern (`features/surface/` tests pure helpers, not canvas chart components).

**Unit tests — `oi-heatmap-utils.test.ts`:**

- `aggregateHeatRows`
  - filters strikes outside `spot ± 30%`
  - excludes hidden expiries from the sum
  - `mode='notional'` sums `openInterestUsd`; `mode='contracts'` sums `openInterest`
  - `side='calls'` ignores put OI in `magnitude`; `'puts'` ignores call OI; `'both'` sums both
  - `dominant === 'call'` when `callOi > putOi`, `'put'` otherwise (tie → `'call'`)
  - empty chains → empty array
  - all expiries hidden → empty array
- `computeOpacity`
  - input 0 → 0.05 (floor)
  - input `maxMagnitude` → 0.95 (ceiling)
  - mid value `0.25 × max` → ≈ 0.5 (sqrt curve sanity)
  - `maxMagnitude === 0` → returns floor (no NaN, no division by zero)
- `heatColor`
  - dominant `'call'` → green base `#00E997` with computed alpha
  - dominant `'put'` → red base `#CB3855` with computed alpha
  - returns a parseable `rgba(...)` string

Fixtures: small hand-crafted `EnrichedChainResponse[]` shaped exactly like the existing `OiSummary` / V1 chart consume. No upstream API fixtures needed — these helpers operate on the already-normalized internal type.

**Component tests:**

- `OiByStrikeCard.test.tsx` — toggle wiring smoke test:
  - mounts the card with `chains=[]` and asserts both `V1` and `V2` toggle buttons render
  - clicks `V2` and asserts the V2 controls (`Calls | Puts | Both`, `24h | 7d | 30d`) appear
  - clicks back to `V1` and asserts V1's bar list reappears
- **No component test for `OiHeatmap` itself.** Canvas-based rendering is not meaningfully testable in jsdom; this matches `SkewHistory`'s existing pattern (it has utility tests but no component test).

**Manual verification before claiming done** (per `.pi/skills/vite-react-ts-2026/SKILL.md` dev-server rule):

- `pnpm dev`, open Analytics, verify V2 renders with live BTC chain
- toggle Calls / Puts / Both, verify color flips and opacity changes
- hide / unhide expiries, verify heat updates without flicker
- switch underlying to ETH, verify card remounts cleanly
- resize window, verify lines stay sharp on retina
- kill spot-candles service (503), verify inline error + retry path
- 24h / 7d / 30d toggle changes the candle density appropriately

**`pnpm precommit`** (typecheck + test) must pass before any commit.

## Open implementation notes (not blocking design approval)

- The pane primitive's draw routine should call `target.useBitmapCoordinateSpace(...)` for crisp lines; the renderer must not assume CSS pixel coordinates.
- `lightweight-charts` v5's price-line label color/font is set via `priceScale().applyOptions({ textColor, fontSize })`. Bolding requires `fontFamily` ending in a bold variant or a custom font face — confirm at build time which approach the existing app theme already uses.
- If the v5 primitives API turns out to lack a clean `priceToCoordinate` inside the renderer scope, drop to the sibling-overlay-canvas fallback. No design changes required; just a different file holding the canvas.

## Out of scope (separate spec/plan cycles)

- **OI history persistence.** A Postgres-backed `oi-history-store` mirroring `iv-history-store`, plus an in-memory rolling buffer for warm-path queries, plus a `GET /api/oi-history` endpoint. Independent backend project.
- **V2 trails mode.** A UI sub-toggle on V2 (`Live | Trails`) that consumes the OI history endpoint and renders evolving heat columns instead of constant stripes. Only viable after the persistence project lands.
