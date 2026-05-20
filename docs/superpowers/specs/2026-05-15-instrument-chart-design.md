# Per-Instrument Chart on the Chain Page

## Goal

Give traders a per-contract historical chart on the CHAIN view, scoped to "time my entry on this strike." Inline mini chart inside `ExpandedRow` for at-a-glance context, with a one-click pop-out to a draggable floating panel that can be stacked, resized, and persisted across reloads. Per-venue switching is one click — no panel pop-out required. Style mirrors a TradingView-style candle chart that fuses **trade prices** with **mark prices** so illiquid strikes still produce a continuous chart.

## Behavior

- Click a strike row → existing `ExpandedRow` renders → new compact chart slot appears on the left of the per-venue table.
- Inline chart auto-picks the strike's **primary venue** (highest open interest on that contract; falls back to first venue listed if primary is filtered off).
- Inline chart header: symbol · OHLC · change% · range buttons (`1m 5m 15m 1h 4h D W M`, default `1h`) · venue dot strip. Clicking a different venue dot swaps the data source in place. No MA toggle on the inline mini.
- Click `⤢` pop-out on the inline chart → a `FloatingChartPanel` mounts via portal above the chain. The inline chart in the row swaps to a "popped out — click to focus" placeholder so the row layout doesn't shift. Closing the panel re-mounts the inline chart in-place.
- Floating panel header: symbol · OHLC · change% · range buttons · venue dot strip · overlay toggles (`Mark`, `MA9`, `MA20`) · drag handle · minimize · close.
- Multiple panels can be open simultaneously, stacked or tiled. Each is draggable and resizable. Z-order managed by a `zSeq` counter.
- Panels survive reload — state persisted to localStorage via Zustand `persist` middleware.
- Mobile (`useIsMobile`): floating panels disabled; `⤢` opens a full-screen modal instead. Inline mini stays.

## Architecture

```text
packages/web/src/features/chain/
  InstrumentChart.tsx              — pure renderer. lightweight-charts. accepts candles + markLine + MAs.
  InstrumentChartInline.tsx        — wraps InstrumentChart at ~280×160. lives in ExpandedRow gutter.
  FloatingChartPanel.tsx           — large wrapper. drag/resize/minimize. range, venue, overlay controls.
  ChartPanelLayer.tsx              — portal host. reads chartPanels slice, renders all panels.
  use-instrument-candles.ts        — TanStack Query hook. REST bootstrap + live tick from chain cache.
  chart-panels-store.ts            — Zustand slice (panels, openPanel, closePanel, updatePanel, bringToFront).
  ExpandedRow.tsx                  — modified to slot <InstrumentChartInline /> on the left.

packages/web/src/App.tsx           — mount <ChartPanelLayer /> at app shell root.

packages/server/src/routes/instrument-candles.ts   — GET /api/instrument-candles
packages/core/src/services/instrument-candles.ts   — dispatch to venue, merge trade + mark, normalize.
packages/core/src/feeds/<venue>/<client>.ts        — new getTradeCandles() + getMarkCandles() per venue.
```

The renderer (`InstrumentChart`) is the only place lightweight-charts is touched. Inline and panel just wrap it with different dimensions and which chrome is visible. That's what makes pop-out cheap — same renderer config, different shell.

Panel state lives in Zustand, not React, because floating panels need to survive row collapse, route navigation, and reload — all three would lose local React state.

## Data flow

### Backend

One new route, mirrors `routes/spot-candles.ts`:

```text
GET /api/instrument-candles
  ?venue=deribit
  &symbol=BTC-30JUN26-70000-C
  &interval=1h         (1m | 5m | 15m | 1h | 4h | 1d | 1w | 1M)
  &range=7d            (1d | 7d | 30d | max)

→ {
    venue, symbol, interval,
    candles:  [{ ts, o, h, l, c, vol, synthetic }, ...],
    markLine: [{ ts, c }, ...]
  }
```

Service (`core/services/instrument-candles.ts`) dispatches via `Record<VenueId, fn>` to the per-venue adapter, **fetches trade klines and mark klines in parallel**, and merges per bar:

```text
for each bucket ts:
  trade = tradeCandles[ts]
  mark  = markCandles[ts]
  if trade && trade.vol > 0:
    out.candles[ts] = { ...trade, synthetic: false }
  else if mark:
    out.candles[ts] = { o: mark.o, h: mark.h, l: mark.l, c: mark.c, vol: 0, synthetic: true }
  // else: no bar emitted
  out.markLine[ts] = mark?.c ?? null
```

The two parallel fetches per venue:

| Venue   | Trade klines                          | Mark klines                            |
| ------- | ------------------------------------- | -------------------------------------- |
| Deribit | `get_tradingview_chart_data`          | `get_mark_price_history`               |
| OKX     | `/market/history-candles`             | `/market/mark-price-candlesticks`      |
| Bybit   | `/market/kline`                       | `/market/mark-price-kline`             |
| Gate    | `/options/candlesticks` (mark-based)  | (returns same series for both)         |
| Thalex  | trade kline endpoint                  | mark kline endpoint                    |

Each venue's existing HTTP client in `core/feeds/<venue>/` gets two new methods. No new HTTP plumbing.

Error semantics:

- 404 if the contract isn't listed on that venue.
- 410 if expired and klines are no longer served.
- 501 if the venue adapter doesn't yet implement instrument candles (v1.1 venues).
- 502 if the upstream call fails — same pattern as `spot-candles.ts`.

### Frontend hook

`useInstrumentCandles(venue, symbol, interval, range)`:

- TanStack Query. Cache key `['instrument-candles', venue, symbol, interval, range]`. `staleTime: 30s`, `gcTime: 5m`.
- Live tick of the **current bar**: a selector hooks into the existing chain query cache. When a fresh chain snapshot lands (200ms WS coalesce, `hooks/useChainWs.ts`), the hook reads the matching strike's `mid` price from `chain.strikes[*].call.venues[venue]` (or `.put` based on contract type — see `VenueQuote` in `@oggregator/protocol/ws.ts`) and extends the last candle's `c` + `h/l` accordingly. `VenueQuote` does not carry a separate `markPrice` field; `mid` is the live mark proxy used elsewhere in the app. No new WS endpoint.
- Inline mini and floating panel viewing the same `(venue, symbol, interval, range)` share one fetch via the cache.

## Rendering

Lightweight-charts setup inside `InstrumentChart`:

- One chart container.
- `addCandlestickSeries` for `candles`. Up = green, down = red, matching the existing theme tokens.
- `addLineSeries` for `markLine`. Contrasting muted color, line width 1, no crosshair priority.
- `addLineSeries` × 2 for `MA9` and `MA20` (toggleable). Computed client-side from `candles[*].c` with a simple SMA. Hardcoded periods — no configurability in MVP.
- Synthetic candles (`synthetic: true`) get a muted border and no body fill, so the user can see at a glance which bars are mark-derived vs trade-derived.
- Crosshair on hover. Header OHLC numbers update from the hovered bar; revert to most-recent on mouse-out.
- Compact mode (inline mini) hides the time axis labels and overlay legend; panel mode shows everything.

## State, persistence, performance

Zustand slice (`chart-panels-store.ts`, persisted to localStorage key `chartPanels.v1`):

```ts
type ChartPanel = {
  id: string;                  // `${venue}:${symbol}`
  venue: VenueId;
  symbol: string;              // e.g. BTC-30JUN26-70000-C
  underlying: string;
  expiry: string;
  strike: number;
  type: 'call' | 'put';
  x: number; y: number;        // viewport coords, clamped to viewport on rehydrate
  w: number; h: number;
  range: '1d' | '7d' | '30d' | 'max';
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w' | '1M';
  overlays: { mark: boolean; ma9: boolean; ma20: boolean };
  minimized: boolean;
  zSeq: number;
};
```

Actions: `openPanel(args)` (id-deduped — if already open, focuses via `bringToFront`), `closePanel(id)`, `updatePanel(id, patch)`, `bringToFront(id)`.

Floating panels render into a single `<div id="chart-panel-layer">` portal target mounted once at the app shell. Avoids z-index war with row expansion and the existing calculator FAB.

Drag/resize uses native pointer events + CSS transform; no external lib. Positions clamped to viewport on every move and on rehydrate (handles users opening on a smaller screen than they saved on).

Performance: lightweight-charts is ~50KB and handles 10k candles trivially. 10 panels at once stays under ~10MB. After rehydrate, fetches are debounced 200ms to let the chain WS reconnect and prime the cache — avoids a fetch storm on reload.

## Error handling & edge cases

- **Primary venue has no klines for that strike** (newly listed, etc.): pick the next venue with that contract by OI. If none, render empty-state "No history yet" with the live mark-only chip.
- **Venue toggled off in chain filter but pinned in an open panel**: panel header shows the venue dot in muted state with a "filtered out" tooltip; chart keeps rendering. Doesn't get force-closed — the user opened it deliberately.
- **Network failure**: inline shows a 1-line muted "—" with retry icon. Panel shows the existing `EmptyState` component with retry. Don't tear down the panel.
- **Contract expired** (410 response): chart freezes on last available candle with an `EXPIRED` badge in the header. Panel stays open so users can compare frozen vs live charts.
- **Adapter unimplemented** (501): inline chart shows "Historical chart unavailable for this venue — switch venue" with the venue switcher prominent. No fake fallback.
- **Reload restoration**: persisted panels rehydrate but pause fetches 200ms to let the chain WS prime.

## Scope

### MVP — one PR

- `InstrumentChart`, `InstrumentChartInline`, `FloatingChartPanel`, `ChartPanelLayer`
- `useInstrumentCandles`, `chartPanels` Zustand slice
- `GET /api/instrument-candles` + `instrumentCandlesService`
- **Deribit adapter only** (~85% of BTC/ETH options volume). Other venues return 501 and the inline chart shows the "switch venue" empty state.
- **Both endpoints in v1**: Deribit trade klines AND mark klines, merged per the rule above. Non-negotiable — without the merge, illiquid strikes show a gappy broken-looking chart.
- Candlestick rendering + mark overlay line + MA9 + MA20 + range buttons + venue dot strip + OHLC header.

### v1.1 — one PR per venue

OKX, Bybit, Gate, Thalex adapter methods. Same merge logic, no frontend changes.

### v2 — separate spec

- Per-contract IV history. None of the venues expose this; would require persisting mark-IV snapshots from the existing chain WS into a ring buffer + downsampled store. Forward-only.
- Real browser window pop-out via `window.open()` + BroadcastChannel for state sync. The panel API is already designed to support this — the `↗ window` button slots into the header.

### Out of scope, full stop

Drawing tools, full TradingView-style indicator browser, alerts, cross-venue overlay on one chart, multi-contract overlay, configurable MA periods. All easy to add later precisely because the renderer accepts arrays of series and the panel state is a clean object.

## Open questions

- **Symbol normalization across venues**: the user-facing symbol on the chain is venue-agnostic (`BTC 30JUN26 70000 C`), but each venue uses its own format (`BTC-30JUN26-70000-C` Deribit, `BTC-USD-300626-70000-C` OKX, etc.). The route accepts the venue's native symbol. The frontend hook is responsible for mapping `(underlying, expiry, strike, type)` → venue symbol using the existing per-venue metadata the chain already carries. Confirm before implementation that this mapping is already available on the strike rows.
- **Mark-line color in dark theme**: needs a token pick that contrasts both red and green candles. Probably yellow/amber (matches MA20 in the reference screenshot) but should be set when wiring CSS.
