# Alpha pricing — work progress

Branch: `feat/alpha-ev-vrp-svi`
Started: 2026-05-05

## Goal

Upgrade Alpha page math: real-world probability, VRP edge, EV gating, SVI surface fit, residual-z richness signal. One file per concern (SRP), TDD throughout.

## File map

| Concern | Where | Why |
|---|---|---|
| Risk-neutral & real-world POP | `packages/web/src/lib/analytics/blackScholes.ts` | Existing pricing math lives here |
| Realized vol (close-to-close, annualized) | `packages/core/src/services/realized-vol.ts` | New service, kebab-case to match `spot-candles.ts` / `iv-history.ts` |
| VRP wiring | `packages/server/src/routes/surface.ts` + `packages/core/src/core/enrichment.ts` | Surface response is the natural carrier for ATM IV + RV |
| EV gate | `packages/web/src/lib/analytics/verticalSpread.ts` + `SignalCard.tsx` | Replaces R/R + POP gate |
| SVI fit | `packages/core/src/services/svi-fit.ts` | New, isolated module |
| SVI residuals + z-score | `packages/core/src/core/enrichment.ts` (per strike) + Alpha web inset | Per-strike richness signal |

## Status

- [x] Step 1 — `realWorldPop()` in blackScholes  (TDD ✓)
- [x] Step 2 — `realizedVol()` in core  (TDD ✓)
- [x] Step 3 — VRP in surface response  (server-enriched, VrpChip rendered)
- [x] Step 4 — EV gate in SignalCard  (TDD ✓, 195 tests)
- [ ] Step 5 — SVI fit per expiry  ← IN PROGRESS
- [ ] Step 6 — SVI residuals + z-score richness

## Step 5 design notes

Using **Zeliade quasi-explicit** SVI calibration (De Marco–Martini):
- Raw SVI: `w(k) = a + b·(ρ·(k−m) + √((k−m)² + σ²))`, total variance.
- For fixed (m, σ), linearize: `w = a + (bρ)·(k−m) + b·√((k−m)²+σ²)` is LINEAR in (a, p=bρ, q=b).
- Solve (a, p, q) with constrained linear LSQ. Recover ρ=p/q, b=q.
- Outer 2D optimization over (m, σ) via Nelder-Mead simplex.
- No-butterfly arbitrage (Martini-Mingone 2020): b≥0, |ρ|<1, σ>0, a+b·σ·√(1−ρ²)≥0.

## Notes for resumption

- IV convention is **fractions** internally (0.50 = 50%). Display layer multiplies by 100.
- `EnrichedStrike` is exported from `@oggregator/protocol`, not core. Adding fields to it requires a cross-package change.
- `SpotCandleService.getCandles(currency, resolutionSec, count)` returns `SpotCandle[]` — that's the input source for RV.
- Surface route already has 30d/60d/90d ATM IV via `IvHistoryResponse`. Reuse that for VRP.
- Project uses Zod schemas as source of truth for I/O boundaries. No casts.
