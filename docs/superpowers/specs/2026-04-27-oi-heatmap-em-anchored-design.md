# OI by Strike — EM-Anchored Heatmap (V2 Iteration)

**Date:** 2026-04-27
**Status:** Approved design, ready for implementation plan
**Supersedes:** Visual filter and significance logic from `2026-04-26-oi-heatmap-v2-design.md` (V2 plumbing — primitive, candles, toggles — stays).
**Scope:** Replace the live ±30% strip filter on the V2 OI heatmap with an expected-move-anchored model: per-expiry EM cones, significance-ranked strike bands, A3/A4 toggle for the strike selector, and a session-only OI sparkline in the strike tooltip.

## Background

The current V2 heatmap (commit `a017ed0`) renders every strike within `spot ± 30%` as a flat horizontal band across a 90-day candle chart. Two problems:

1. **No time information in the bands.** OI is a live snapshot painted across all 90 days; switching the (now-removed) time-range toggle never changed the bands. The visualization is mislabeled — it is a live profile, not a bookmap.
2. **No significance filter.** Bands cover ~50+ strikes regardless of where actual liquidity sits, producing visual noise that drowns the signal the user actually wants ("where do traders express positioning").

Backend has no OI history (`packages/core/src/services/` only persists IV history, DVOL, spot candles, trades), so a true time-axis bookmap is out of scope for this iteration. This design fixes the live-snapshot rendering by anchoring significance to *what the chain is pricing*.

## Goal

Surface the OI nodes that express trader positioning relative to the market's own implied move per expiry, so a glance at the chart answers: "where do options traders expect this to land, and where are they actually positioned around that?"

## Non-goals

- True time-axis bookmap (deferred — needs an OI history backend service).
- Realized-vs-expected analytic (deferred — separate card; data is available via `iv-history.ts`).
- Persisted OI history across sessions. The session buffer is in-memory only and clears on refresh or close.
- Backend API changes. Reuses `GET /api/chains` (via `useChainWs`) and `GET /api/spot-candles`.
- Global state changes. All controls are card-local.

## Architecture overview

```text
chains, spotPrice
       │
       ▼
oi-em-utils.ts ──► { emByExpiry, significantStrikes, sessionBuffer }
       │
       ├──► HeatBandPrimitive  (existing — receives filtered row set)
       ├──► EmConePrimitive    (new — per-expiry consensus cones)
       └──► OiHeatmap.tsx      (controls + tooltip + legend + buffer ref)
```

Two new pure modules + one new canvas primitive. `OiHeatmap.tsx` shrinks because the algorithmic logic moves out into testable utils.

## EM-Hybrid algorithm (per expiry)

Public surface:

```ts
type EmSource = 'straddle' | 'iv-fallback';

interface ExpectedMove {
  expiry: string;
  dte: number;          // days to expiry
  value: number;        // 1σ expected move in USD
  source: EmSource;
}

function computeExpectedMove(
  chain: EnrichedChainResponse,
  spot: number
): ExpectedMove;
```

Algorithm:

1. **Pick ATM strike for the straddle legs** — the strike with the smallest `|strike − spot|`. Used only by the straddle path (step 4).
2. **Build cross-venue composite mid** — for each ATM leg (call and put), take the *tightest synthetic NBBO* across venues: `bestBid = max(bid across venues)`, `bestAsk = min(ask across venues)`, then `mid = (bestBid + bestAsk) / 2`. If `bestBid > bestAsk` (crossed across venues), treat as a missing leg and fall back to IV.
3. **Always compute `EM_iv` (the anchor)** — independent of the straddle:

   ```text
   EM_iv = spot × ATM_IV_interpolated × √(DTE / 365)
   ```

   `ATM_IV_interpolated` is the linear interpolation, evaluated *at spot*, of the call+put average IV between the two strikes bracketing spot. If spot equals an exact strike, this collapses to that strike's call/put-average IV.
4. **Compute `EM_straddle`:**

   ```text
   EM_straddle = (call_mid + put_mid) × 1.25
   ```

   Brenner–Subrahmanyam approximation for an ATM straddle.
5. **Quality gates** — fall back to `EM_iv` if **any** fails:
   - Either leg has missing or zero bid or ask.
   - Relative spread on either leg `(ask − bid) / mid > 0.05`.
   - Deviation cap: `|EM_straddle − EM_iv| / EM_iv > 0.50`.
6. **Output:**
   - `value` = `EM_straddle` if all gates pass, else `EM_iv`.
   - `source` = `'straddle'` or `'iv-fallback'` accordingly.

Tunables live in a single config object so they're trivially adjustable:

```ts
const EM_HYBRID = {
  spreadToleranceRel: 0.05,
  deviationCapRel: 0.50,
  straddleMultiplier: 1.25,
} as const;
```

## Strike significance filter

Toggle in the controls row (next to Calls/Puts/Both):

- **`A3` (default)** — per-expiry top-K within EM band.
  - For each visible expiry: keep the top `K = 5` strikes by OI, restricted to the band `[spot − 2·EM, spot + 2·EM]` where `EM = EM(expiry)`.
  - Union across all visible expiries → final strike set.
  - Guarantees every visible expiry contributes its strongest nodes; bounded total of `K × visibleExpiries` strikes.

- **`A4` BETA** — statistical outliers per expiry.
  - For each visible expiry: keep strikes where `OI > mean + 1.5σ` of that expiry's OI distribution (over the same `±2·EM` band).
  - Union across visible expiries.
  - Toggle is visually badged "BETA" to communicate it is experimental.

Tunables in a single config:

```ts
const STRIKE_FILTER = {
  topK: 5,
  outlierSigma: 1.5,
  emBandMultiplier: 2,
} as const;
```

The filter operates on the existing `aggregateHeatRows` output — it is a post-filter, not a replacement, so the rest of the row pipeline (call/put split, dominant side, magnitude for opacity) stays unchanged.

## EM consensus cone (V-2 visual)

New `EmConePrimitive` modeled directly on `HeatBandPrimitive`:

- For each visible expiry, fill a quadrilateral that:
  - At `t = now` (left edge of the cone) pinches to `spot`.
  - At `t = expiry` opens to the interval `[spot − EM(expiry), spot + EM(expiry)]` for the ±1σ band, and `[spot − 2·EM, spot + 2·EM]` for the ±2σ band.
- The two bands are filled with the expiry's legend color:
  - ±1σ: alpha ~0.10.
  - ±2σ: alpha ~0.05 (drawn under ±1σ).
- Cones beyond the visible time range are clipped to the chart bounds.
- If `source === 'iv-fallback'`, render the cone outline as a 1px dashed line in the same color so it is visually obvious which expiries are using the IV anchor instead of the straddle.

The primitive receives `{ expiries: { ts, em, color, source }[], spot, nowMs }` and re-renders on `requestUpdate` like the existing primitive.

## Session-only OI history buffer

In-memory, ref-held. Lives in `OiHeatmap.tsx` (or a small dedicated hook `useSessionOiBuffer`):

- Shape: `Map<strike, { ts: number; oi: number }[]>` with a per-strike cap (e.g., 1440 entries ≈ 24h at 1-minute resolution).
- Sample on every chain update; only push if the strike's OI changed from the previous sample (deduplication).
- Cleared on unmount and on currency change.

**Phase 1 use:** drives a sparkline in the strike tooltip — "OI this session: ▁▃▆█▆" — so hovering a strike answers "did this position build up or unwind while I was watching?"

**Not** used for time-axis rendering yet. That stays a deliberate non-goal — the visual remains a live profile with cones, not a bookmap, until a backend OI history service exists.

## Tooltip & InfoTip changes

Strike tooltip (existing `HeatTooltip`) gains:

- **Per-expiry EM badge** in each expiry row: `±$X.XK · straddle` or `±$X.XK · iv` so the source is visible inline.
- **Inside / outside classifier** at the top: "Strike is **inside ±1σ** for: 27 APR, 29 APR" or "**outside ±2σ** for all visible expiries."
- **Session sparkline** at the bottom: 24-bucket sparkline of total OI for this strike across the session buffer.

`InfoTip` (in `OiByStrikeCard.tsx`) rewritten to explain:

- EM-Hybrid: straddle-based EM with IV-anchored fallback when quotes are wide or stale.
- A3 vs A4 BETA toggle and what each selects.
- V-2 cone interpretation (±1σ / ±2σ per expiry, dashed outline = IV fallback).
- Session-only buffer caveat (resets on refresh, BTC/ETH only).

## Files touched

| File | Change |
| --- | --- |
| `packages/web/src/features/analytics/oi-by-strike/oi-em-utils.ts` *(new)* | `computeExpectedMove`, `selectSignificantStrikes`, `EM_HYBRID`, `STRIKE_FILTER`, types |
| `packages/web/src/features/analytics/oi-by-strike/oi-em-utils.test.ts` *(new)* | Edge cases: wide spread, missing leg, IV fallback, deviation cap, A3/A4 selection behavior, EM band clipping |
| `packages/web/src/features/analytics/oi-by-strike/EmConePrimitive.ts` *(new)* | Canvas primitive for V-2 cones (modeled on `HeatBandPrimitive`) |
| `packages/web/src/features/analytics/oi-by-strike/oi-heatmap-utils.ts` | Unchanged. Filter is composed downstream. |
| `packages/web/src/features/analytics/oi-by-strike/HeatBandPrimitive.ts` | Unchanged. Receives filtered row set. |
| `packages/web/src/features/analytics/oi-by-strike/OiHeatmap.tsx` | Wire EM utils + cone primitive, add A3/A4 toggle, session buffer ref, attach `EmConePrimitive` alongside `HeatBandPrimitive` |
| `packages/web/src/features/analytics/oi-by-strike/OiByStrikeCard.tsx` | InfoTip text rewrite |
| `packages/web/src/features/analytics/oi-by-strike/OiByStrikeCard.test.tsx` | Add test for A3/A4 toggle visibility, BETA badge |
| `packages/web/src/features/analytics/AnalyticsView.module.css` | Styles for cone (no DOM — primitive is canvas), A3/A4 toggle BETA badge, sparkline cells, EM source badge |

## Testing plan

`vitest` (per `.pi/skills/vitest-2026/SKILL.md`):

- **EM-Hybrid:** zero/missing legs, leg with `bid > ask`, leg with 8% spread (gate fail), leg with 3% spread (gate pass), straddle deviating 70% from IV (gate fail), straddle deviating 20% (gate pass). Assert `source` field for each.
- **ATM IV interpolation:** spot equals exact strike (no interpolation), spot midway between strikes, spot near far OTM with sparse strikes.
- **A3 selection:** chain with 3 expiries × 20 strikes each, K=5 → expect ≤15 unique strikes in result, all within `±2·EM(expiry)` of spot for at least one expiry.
- **A4 selection:** flat OI distribution → expect empty/near-empty set; peaked distribution → expect peak strike.
- **Session buffer:** dedup behavior, cap enforcement, clears on currency change.

Manual UI verification per `.pi/skills/vite-react-ts-2026/SKILL.md`:

- Cones render and pinch correctly at "now"; hide when expiry passes.
- Dashed outline appears on expiries with `source === 'iv-fallback'`.
- A3 ↔ A4 toggle changes the band set live.
- Sparkline appears in tooltip after the buffer has at least 2 samples.
- InfoTip text reads cleanly and explains the toggle.

## Future work

- **V-3 fallback toggle.** If cone density becomes unreadable with 5+ visible expiries, add a "front-month only" toggle that hides cones for non-front expiries (cones still appear in tooltip metadata).
- **OI history backend.** A `packages/core/src/services/oi-history.ts` snapshot service + `GET /api/oi-history` would unlock true time-axis bookmap rendering. The session buffer logic is structured so it can transparently swap to backend data once the endpoint exists.
- **Realized-vs-expected card.** Separate analytic using `iv-history.ts` to backtest "did spot land inside the EM cone implied N days before expiry?" Belongs in its own card so this one stays focused on live positioning.
