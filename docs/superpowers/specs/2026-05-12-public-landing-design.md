# Public Landing — Percept-Style Oggregator Site

**Status:** Approved (Percept-style adaptation for public acquisition)
**Date:** 2026-05-12
**Surface:** `apps/landing/` + root workspace config

## Goal

Create a separate public-facing landing site for Oggregator that closely follows the visual rhythm, restraint, and section pacing of the provided `percept.one` references, while adapting the product story to a crypto options aggregator.

This site is a lead-capture funnel first and a product handoff second:

1. Capture visitor email addresses for future promotions, product drops, and access campaigns.
2. Position Oggregator as a premium, institutional-grade crypto options platform.
3. Hand qualified users off to the trading options aggregator after intent is established.

The site should feel quiet, confident, and expensive rather than loud, over-animated, or dashboard-cluttered.

## Non-goals

- No authenticated dashboard behavior in this app.
- No live trading flow, wallet connection, or order entry on the landing page.
- No real-time production data dependency in phase 1. Initial visuals use polished demo data.
- No attempt to merge this public site into `packages/web`.
- No generic exchange-style landing page with hero charts everywhere. The reference's restraint is intentional.
- No TradFi cross-asset framing such as SPY, QQQ, or NVDA. The product language remains crypto-options native.

## Design objective

The public site should behave like a Percept-style acquisition page adapted to Oggregator:

- Minimal header
- Thin live market strip
- Large typographic hero with one accent line
- One primary CTA
- One dominant idea per section
- Spacious matte-dark panels
- Product credibility revealed progressively as the user scrolls

The page should communicate:

- fragmented crypto options liquidity is hard to monitor manually
- Oggregator unifies venue context and routing signals
- vol, skew, tenor, open interest, and cross-venue spreads are core primitives
- users should request access first, then graduate into the product

## Reference adaptation rules

The implementation should **clone the composition and pacing** of the supplied Percept screenshots, not their literal branding or copy.

Keep:

- the oversized centered hero headline
- the thin scrolling market tape
- the pill-shaped secondary buttons
- the section cadence of headline -> support copy -> premium panel
- the restrained dark palette with sparse accent usage
- the split sections with left-copy/right-panel and alternating layouts

Adapt:

- all market content to crypto options
- all proof points to Oggregator capabilities
- all CTA language to lead capture and access requests
- all visual accents to the existing Oggregator palette
- all code panels to examples relevant to routing, quotes, and feeds

## Information architecture

### 1. Top market strip

A thin ticker fixed at the top of the page. It conveys a live-network feeling before the user reads any headline.

Example items:

- `BTC 30D IV`
- `ETH 25D RR`
- `XRP ATM IV`
- `BNB OI`
- `SOL term structure`
- `best venue spread`

This should be rendered as demo data in phase 1, and the component contract should support phase 2 live binding.

### 2. Minimal header

- Left: Oggregator wordmark/logo
- Right: `Docs` and `Request Access` pill buttons

No full marketing navbar. The page should keep users focused on the CTA rather than browsing.

### 3. Hero

The hero follows the last screenshot most closely.

Composition:

- one enormous two-line or three-line headline
- one accent-colored line within that headline
- one centered CTA
- one small trust sentence underneath

Recommended headline direction:

```txt
Stop venue hopping.
Start routing smarter.
```

Copy variants may change during implementation, but the centered headline + accent-line structure is fixed.

Primary CTA:

- `Request Access`

Trust line:

- `LIVE IV. CROSS-VENUE LIQUIDITY. DESK-GRADE CONTEXT.`

Hero intentionally does **not** contain the 3D vol surface. The reference is strongest when the hero is mostly typography and breathing room.

### 4. Market context section

This mirrors the `Market context, pre-installed.` reference.

Left side:

- oversized product message about fragmented crypto options markets
- two short supporting paragraphs explaining aggregated context and venue normalization

Right side:

- tall matte stats panel
- four high-signal crypto-options rows

Recommended panel metrics:

- `BTC 30D ATM IV`
- `ETH 25D RR`
- `XRP front expiry premium`
- `BNB open interest`

### 5. Rendering / analytics section

This mirrors the `See the walls.` section, but uses Oggregator's core vol analytics instead of orderbook walls.

Centered headline direction:

```txt
See the surface.
```

Support copy explains:

- implied volatility across strike and tenor
- skew and regime context
- venue-aware visualization
- liquidity discovery without opening multiple terminals

Primary visual:

- a large premium panel containing the animated 3D volatility surface
- stats rail above the panel

Recommended proof metrics:

- `91 deltas`
- `7 venues`
- `sub-second refresh`
- `interactive tenor map`

### 6. Built for desks section

This mirrors `Built for Architects.` but adapts the audience from developers to professional options users and quant-minded teams.

Left side:

- headline about desks, PMs, and execution teams
- copy around routing, quote normalization, venue comparison, and clean analytics

Right side:

- a code-style or terminal-style panel
- content shows typed output such as normalized quote snapshots, best venue selection, or route comparison payloads

This section should make the product feel programmable and systematic without turning the whole site into docs.

### 7. Bring your own data section

This mirrors the split layout of `Bring your own data.`

Left side:

- code block or feed example
- e.g. ingesting proprietary venue snapshots, custom feeds, or risk signals

Right side:

- large headline about mixing Oggregator data with internal desk data
- body copy about WebSocket feeds, REST APIs, and internal models

This keeps the page credible for sophisticated users who already run their own systems.

### 8. Social proof / partner quotes

This section adapts the testimonial-card layout from the screenshot set.

Three cards max per row on desktop, each with:

- company / desk / user identity
- one concise quote
- founder / PM / trader attribution
- no external link in phase 1

The tone should be serious and compact, not startup-cutesy.

### 9. Final CTA / email capture

The page ends with a quiet, focused acquisition block.

Content:

- short headline
- one-line value promise
- email input + request access button
- small supporting note about updates, promotions, and product access

Suggested body:

`Get product updates, desk notes, and early access to the options aggregator.`

## Visual system

### Palette

Base the new site on the existing Oggregator dark palette rather than Percept's orange-first palette.

Use existing web tokens as the source of truth:

- `--bg-base`
- `--bg-surface`
- `--bg-elevated`
- `--text-primary`
- `--text-secondary`
- `--accent-primary`
- `--color-profit`
- `--color-loss`
- `--color-iv`

Marketing-site adaptation:

- page background stays near-black / charcoal matte
- primary accent becomes Oggregator teal
- profit/loss remain green/red in ticker and data chips only
- IV violet is reserved for analytics accents and surface highlights
- avoid broad neon washes; use accent sparingly

### Typography

The Percept references rely on scale and weight more than ornament.

Recommended stack:

- headings: a heavy grotesk such as `Inter Tight` or similar compressed/impactful sans
- body: same sans at lower contrast
- data labels / ticker / code: `IBM Plex Mono` or equivalent mono

Rules:

- headlines should be very large, blunt, and tightly spaced
- labels should be small uppercase mono with generous tracking
- body copy should stay muted and compact
- mono is for precision surfaces, not paragraph content

### Panels and shapes

- large rounded panels (`24px` to `36px` radius)
- matte surfaces instead of glossy cards
- thin low-contrast borders
- soft ambient shadows
- subtle internal gradients only where needed to add depth

This should feel like premium terminal hardware, not glassmorphism-heavy consumer fintech.

### Motion

Motion should be sparse and deliberate:

- slow ticker movement
- section fade / translate reveals on scroll
- minimal button hover bloom
- gentle numeric transitions in stat panels
- animated 3D vol surface deeper in the page

Avoid:

- constant floating objects
- aggressive parallax in the hero
- obvious shimmer effects across the entire page

## Technical architecture

### App structure

Create a new standalone app:

```txt
apps/landing/
```

This requires expanding `pnpm-workspace.yaml` from:

```yaml
packages:
  - 'packages/*'
```

to include:

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

The landing site should remain operationally separate from `packages/web`.

## Stack

- `Next.js` App Router
- `TypeScript`
- `Tailwind CSS`
- `Framer Motion`
- `React Three Fiber` for the 3D vol section
- native Next.js form handling + `zod` validation for the lead form

Why this stack:

- Next.js provides a clean public-site boundary, metadata, and SEO
- Tailwind matches the reference's precision spacing workflow well
- Framer Motion is enough for premium reveal motion without overbuilding
- R3F gives us a controlled, branded vol-surface implementation rather than depending on Plotly inside marketing sections

## Data strategy

Phase 1 uses polished demo data only.

Reasoning:

- less code
- no public dependency on backend uptime
- no caching/rate-limit work on day one
- no need to expose internal APIs immediately

Every market-facing component should accept typed props so phase 2 can wire real data without redesigning the component tree.

## Lead capture flow

Primary conversion is email collection.

Initial flow:

1. user clicks `Request Access`
2. modal or inline capture appears
3. user submits email
4. site shows confirmation state
5. captured lead becomes eligible for future promotions, updates, and aggregator access messaging

Phase 1 storage:

- simple Next.js route handler
- persist lead payloads to a minimal server-side store or email sink
- log a minimal source attribute alongside the payload

The lead form should not mention wallet connection or sign-in.

## Component architecture

```txt
apps/landing/
  app/
    page.tsx
    layout.tsx
    globals.css
  components/
    TopTicker.tsx
    LandingHeader.tsx
    HeroStatement.tsx
    MarketContextSection.tsx
    VolSurfaceShowcase.tsx
    DeskWorkflowSection.tsx
    BringYourOwnDataSection.tsx
    TestimonialsGrid.tsx
    LeadCaptureSection.tsx
    Footer.tsx
  lib/
    copy.ts
    demo-data.ts
    motion.ts
    theme.ts
  components/three/
    VolSurfaceCanvas.tsx
    SurfaceMesh.tsx
    SurfaceParticles.tsx
```

Each section should be independently composable and fed by typed content/data props.

## 3D volatility surface roadmap

The user originally asked for a 3D volatility surface background. The approved design keeps the hero restrained and relocates the 3D treatment into a dedicated product section.

### Phase 1 — stylized product surface

- build a branded demo mesh in R3F
- animate a smooth surface representing strike vs tenor vs IV
- add subtle depth shading and soft accent edges
- keep interaction limited to gentle mouse parallax

### Phase 2 — richer market feel

- add particle depth to imply liquidity layers
- add hover affordances or subtle raycast highlights
- introduce slow regime variation in the mesh

### Phase 3 — real data binding

- map actual surface snapshots from backend output
- transform existing surface data into the marketing renderer's format
- keep the visual shell but swap demo arrays for real values

## Content examples

These are directional, not locked final copy.

### Hero

```txt
Stop venue hopping.
Start routing smarter.
```

### Market context

```txt
Market context,
pre-installed.
```

### Surface section

```txt
See the surface.
```

### Desk section

```txt
Built for desks.
```

### Data section

```txt
Bring your own data.
```

## Responsive behavior

- Mobile preserves the same headline-first hierarchy.
- Ticker remains visible but simplified.
- Split sections collapse to single-column with the copy first.
- CTA remains visible without requiring deep scroll.
- The 3D surface panel may reduce interaction complexity on smaller screens.

The mobile version should still feel premium, not like a shrunken desktop page.

## Accessibility and performance

- maintain strong text contrast across dark surfaces
- respect `prefers-reduced-motion`
- keep hero largely HTML/CSS, not canvas-driven
- lazy-load heavy 3D sections below the fold
- ship static/demo data inline where reasonable
- keep above-the-fold JS small and deterministic

Performance priority order:

1. hero paint speed
2. ticker smoothness
3. section transition polish
4. 3D showcase complexity

## Implementation phases

### Phase 1 — shell and conversion

- add `apps/landing`
- configure workspace and scripts
- implement ticker, header, hero, and email CTA
- implement typography, spacing, and panel system

### Phase 2 — Percept-style sections

- build market context split section
- build desk workflow split section
- build bring-your-own-data split section
- build testimonial section

### Phase 3 — 3D analytics showcase

- add R3F vol surface section
- tune motion, lighting, and copy integration
- ensure responsive degradation on mobile

### Phase 4 — conversion plumbing

- wire lead capture endpoint
- add success / error states
- connect the submission path to the chosen lead sink

### Phase 5 — live upgrades

- bind live ticker data
- bind real IV / skew / OI values
- bind real surface snapshots

## Testing and validation

### Manual

- desktop visual check against reference pacing
- mobile visual check
- reduced-motion check
- CTA flow check
- form error / success check
- section spacing and headline wrap review

### Automated

- basic component render tests for CTA and form states
- zod validation tests for lead payloads
- smoke test for landing page route

## Open items resolved by defaults

| Decision | Default chosen |
|---|---|
| Public app location | `apps/landing/` |
| Primary conversion | email capture |
| Data source in phase 1 | demo data |
| Hero style | Percept-style typography-first hero |
| 3D surface placement | dedicated lower section, not hero |
| Market scope | crypto only |
| Ticker symbols | BTC / ETH / XRP / BNB / SOL |
| Header actions | `Docs` + `Request Access` |
| Secondary conversion | handoff into the trading aggregator after lead capture |

## Out of scope

- authenticated user flows
- wallet connection UX
- full CRM automation
- live production data ingestion for day-one marketing launch
- reworking `packages/web` to host marketing routes
- cloning Percept branding assets, copy, or logos directly
