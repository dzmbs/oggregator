# Per-Instrument Chart on the Chain Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-contract historical chart on the CHAIN page. Inline mini chart inside `ExpandedRow`; one-click pop-out to a draggable, resizable, persistent floating panel. Candles fuse trade and mark prices server-side so illiquid strikes stay continuous.

**Architecture:** Backend adds `/api/instrument-candles` mirroring the `spot-candles` pattern in `core/services/`. A per-venue dispatch (Deribit only in MVP) fetches trade and mark klines in parallel and merges them per bar. Frontend wraps lightweight-charts in a single `InstrumentChart` renderer used by both the inline mini and the floating panel. Panel state lives in a Zustand slice with `persist` middleware. Pop-out moves the chart by swapping the inline node to a placeholder bound to the panel id.

**Tech Stack:** Fastify + Zod (server), `@oggregator/core` services, TanStack Query v5 + Zustand v5 + lightweight-charts 5 (web), Vitest v4, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-05-15-instrument-chart-design.md`

---

## File map

```text
packages/protocol/src/
  instrument-candles.ts                        [NEW] shared types: InstrumentCandle, InstrumentCandlesResponse,
                                                     InstrumentCandleInterval, InstrumentCandleRange

packages/core/src/
  services/instrument-candles.ts               [NEW] dispatch + merge + cache. Deribit adapter inline.
  services/instrument-candles.test.ts          [NEW] merge-rule unit tests
  index.ts                                     [MODIFY] re-export InstrumentCandleService

packages/server/src/
  services.ts                                  [MODIFY] instantiate + export instrumentCandleService
  routes/instrument-candles.ts                 [NEW] GET /api/instrument-candles route
  routes/index.ts                              [MODIFY] register route

packages/web/src/
  shared-types/instrument-candles.ts           [NEW] mirrors protocol types (kept manually in sync per repo convention)
  features/chain/
    instrument-symbol.ts                       [NEW] (underlying, expiry, strike, type, venue) → native symbol
    instrument-symbol.test.ts                  [NEW] per-venue formatting unit tests
    chart-panels-store.ts                      [NEW] Zustand slice with persist
    chart-panels-store.test.ts                 [NEW] open/close/bringToFront/clamp tests
    use-instrument-candles.ts                  [NEW] TanStack Query hook + live-tick selector
    use-instrument-candles.test.ts             [NEW] live-tick selector test against fake chain cache
    InstrumentChart.tsx                        [NEW] lightweight-charts renderer (candles + mark + MAs)
    InstrumentChart.module.css                 [NEW]
    InstrumentChartInline.tsx                  [NEW] compact wrapper for ExpandedRow gutter
    InstrumentChartInline.module.css           [NEW]
    FloatingChartPanel.tsx                     [NEW] draggable/resizable panel with chrome
    FloatingChartPanel.module.css              [NEW]
    ChartPanelLayer.tsx                        [NEW] portal host; reads store, renders panels
    ExpandedRow.tsx                            [MODIFY] slot <InstrumentChartInline /> on the left
    ExpandedRow.module.css                     [MODIFY] grid adjustments for chart slot
  App.tsx                                      [MODIFY] mount <ChartPanelLayer /> once at root
```

Files grouped by responsibility, not technical layer. `InstrumentChart` is the only place lightweight-charts is touched.

---

## Task 1: Shared candle types in `@oggregator/protocol`

**Goal:** Define the on-the-wire types both server and web consume.

**Files:**
- Create: `packages/protocol/src/instrument-candles.ts`
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1.1: Create the types file**

```ts
// packages/protocol/src/instrument-candles.ts
import { z } from 'zod';
import { VenueIdSchema } from './ws.js';

export const InstrumentCandleIntervalSchema = z.enum([
  '1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M',
]);
export type InstrumentCandleInterval = z.infer<typeof InstrumentCandleIntervalSchema>;

export const InstrumentCandleRangeSchema = z.enum(['1d', '7d', '30d', 'max']);
export type InstrumentCandleRange = z.infer<typeof InstrumentCandleRangeSchema>;

export const InstrumentCandleSchema = z.object({
  ts: z.number(),                       // milliseconds, UTC, bucket start
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  vol: z.number(),                      // trade volume; 0 for synthetic bars
  synthetic: z.boolean(),               // true when bar is mark-filled (no trades)
});
export type InstrumentCandle = z.infer<typeof InstrumentCandleSchema>;

export const InstrumentMarkPointSchema = z.object({
  ts: z.number(),
  c: z.number(),
});
export type InstrumentMarkPoint = z.infer<typeof InstrumentMarkPointSchema>;

export const InstrumentCandlesResponseSchema = z.object({
  venue: VenueIdSchema,
  symbol: z.string(),
  interval: InstrumentCandleIntervalSchema,
  candles: z.array(InstrumentCandleSchema),
  markLine: z.array(InstrumentMarkPointSchema),
});
export type InstrumentCandlesResponse = z.infer<typeof InstrumentCandlesResponseSchema>;
```

- [ ] **Step 1.2: Re-export from the protocol barrel**

Append to `packages/protocol/src/index.ts`:

```ts
export * from './instrument-candles.js';
```

- [ ] **Step 1.3: Typecheck**

Run: `pnpm --filter @oggregator/protocol typecheck`
Expected: PASS

- [ ] **Step 1.4: Commit**

```bash
git add packages/protocol/src/instrument-candles.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): types for /api/instrument-candles payloads"
```

---

## Task 2: Deribit kline fetchers + merge rule (unit-tested)

**Goal:** Build the service that fetches Deribit trade klines + mark klines and merges them per bar. Pure logic + HTTP call. No route yet.

**Files:**
- Create: `packages/core/src/services/instrument-candles.ts`
- Create: `packages/core/src/services/instrument-candles.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 2.1: Write the failing merge-rule test**

```ts
// packages/core/src/services/instrument-candles.test.ts
import { describe, it, expect } from 'vitest';
import { mergeTradeAndMark } from './instrument-candles.js';

describe('mergeTradeAndMark', () => {
  it('uses trade bar when vol > 0', () => {
    const trade = [{ ts: 1, o: 10, h: 11, l: 9, c: 10.5, vol: 5 }];
    const mark = [{ ts: 1, o: 9, h: 12, l: 8, c: 11, vol: 0 }];
    const out = mergeTradeAndMark(trade, mark);
    expect(out.candles).toEqual([
      { ts: 1, o: 10, h: 11, l: 9, c: 10.5, vol: 5, synthetic: false },
    ]);
    expect(out.markLine).toEqual([{ ts: 1, c: 11 }]);
  });

  it('falls back to mark when trade vol is 0', () => {
    const trade = [{ ts: 1, o: 0, h: 0, l: 0, c: 0, vol: 0 }];
    const mark = [{ ts: 1, o: 9, h: 12, l: 8, c: 11, vol: 0 }];
    const out = mergeTradeAndMark(trade, mark);
    expect(out.candles).toEqual([
      { ts: 1, o: 9, h: 12, l: 8, c: 11, vol: 0, synthetic: true },
    ]);
  });

  it('fills mark-only buckets that have no trade bucket', () => {
    const trade: [] = [];
    const mark = [
      { ts: 1, o: 1, h: 1, l: 1, c: 1, vol: 0 },
      { ts: 2, o: 2, h: 2, l: 2, c: 2, vol: 0 },
    ];
    const out = mergeTradeAndMark(trade, mark);
    expect(out.candles.map((c) => c.synthetic)).toEqual([true, true]);
    expect(out.markLine.map((m) => m.c)).toEqual([1, 2]);
  });

  it('drops trade buckets with no matching mark bucket', () => {
    const trade = [{ ts: 1, o: 10, h: 11, l: 9, c: 10.5, vol: 5 }];
    const mark: [] = [];
    const out = mergeTradeAndMark(trade, mark);
    expect(out.candles).toEqual([]);
    expect(out.markLine).toEqual([]);
  });

  it('emits buckets in ascending ts order', () => {
    const trade = [{ ts: 2, o: 2, h: 2, l: 2, c: 2, vol: 1 }];
    const mark = [
      { ts: 1, o: 1, h: 1, l: 1, c: 1, vol: 0 },
      { ts: 2, o: 1.5, h: 2.5, l: 1.5, c: 2.5, vol: 0 },
    ];
    const out = mergeTradeAndMark(trade, mark);
    expect(out.candles.map((c) => c.ts)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `pnpm --filter @oggregator/core test instrument-candles -t mergeTradeAndMark`
Expected: FAIL with `mergeTradeAndMark is not a function` or module-not-found.

- [ ] **Step 2.3: Implement the service shell + merge rule**

```ts
// packages/core/src/services/instrument-candles.ts
import { z } from 'zod';
import { DERIBIT_REST_BASE_URL } from '../feeds/shared/endpoints.js';
import { feedLogger } from '../utils/logger.js';
import type {
  InstrumentCandle,
  InstrumentCandlesResponse,
  InstrumentCandleInterval,
  InstrumentCandleRange,
  InstrumentMarkPoint,
} from '@oggregator/protocol';

const log = feedLogger('instrument-candles');

interface RawCandle {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  vol: number;
}

export function mergeTradeAndMark(
  trade: readonly RawCandle[],
  mark: readonly RawCandle[],
): { candles: InstrumentCandle[]; markLine: InstrumentMarkPoint[] } {
  const tradeByTs = new Map(trade.map((c) => [c.ts, c]));
  const candles: InstrumentCandle[] = [];
  const markLine: InstrumentMarkPoint[] = [];
  for (const m of mark) {
    markLine.push({ ts: m.ts, c: m.c });
    const t = tradeByTs.get(m.ts);
    if (t && t.vol > 0) {
      candles.push({ ts: t.ts, o: t.o, h: t.h, l: t.l, c: t.c, vol: t.vol, synthetic: false });
    } else {
      candles.push({ ts: m.ts, o: m.o, h: m.h, l: m.l, c: m.c, vol: 0, synthetic: true });
    }
  }
  candles.sort((a, b) => a.ts - b.ts);
  markLine.sort((a, b) => a.ts - b.ts);
  return { candles, markLine };
}
```

- [ ] **Step 2.4: Run the test to verify it passes**

Run: `pnpm --filter @oggregator/core test instrument-candles`
Expected: PASS — 5 tests.

- [ ] **Step 2.5: Add the Deribit fetcher + range/interval mapping**

Append to `packages/core/src/services/instrument-candles.ts`:

```ts
const INTERVAL_TO_DERIBIT: Record<InstrumentCandleInterval, string> = {
  '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240',
  '1d': '1D', '1w': '1D', '1M': '1D',
  // Deribit's smallest natural multi-day unit is 1D; week/month aggregation is
  // done client-side via downsample if needed. MVP keeps server response as
  // 1D buckets when 1w/1M is requested and the renderer downsamples.
};

const RANGE_TO_MS: Record<InstrumentCandleRange, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  'max': 365 * 24 * 60 * 60 * 1000,  // hard cap; Deribit refuses unbounded.
};

const TradingViewSchema = z.object({
  result: z.object({
    status: z.string(),
    ticks: z.array(z.number()),
    open: z.array(z.number()),
    high: z.array(z.number()),
    low: z.array(z.number()),
    close: z.array(z.number()),
    volume: z.array(z.number()).optional(),
  }),
});

const MarkHistorySchema = z.object({
  result: z.array(z.tuple([z.number(), z.number()])),  // [ts, mark]
});

async function fetchDeribitTrade(
  symbol: string, interval: InstrumentCandleInterval, range: InstrumentCandleRange,
): Promise<RawCandle[]> {
  const now = Date.now();
  const start = now - RANGE_TO_MS[range];
  const url = new URL('/api/v2/public/get_tradingview_chart_data', DERIBIT_REST_BASE_URL);
  url.searchParams.set('instrument_name', symbol);
  url.searchParams.set('resolution', INTERVAL_TO_DERIBIT[interval]);
  url.searchParams.set('start_timestamp', String(start));
  url.searchParams.set('end_timestamp', String(now));
  const res = await fetch(url);
  if (res.status === 404) throw new InstrumentCandlesError('not_found', `Deribit: ${symbol}`);
  if (!res.ok) throw new InstrumentCandlesError('upstream', `Deribit ${res.status}`);
  const parsed = TradingViewSchema.parse(await res.json());
  const r = parsed.result;
  if (r.status === 'no_data') return [];
  return r.ticks.map((ts, i) => ({
    ts,
    o: r.open[i],
    h: r.high[i],
    l: r.low[i],
    c: r.close[i],
    vol: r.volume?.[i] ?? 0,
  }));
}

async function fetchDeribitMark(
  symbol: string, _interval: InstrumentCandleInterval, range: InstrumentCandleRange,
): Promise<RawCandle[]> {
  // get_mark_price_history returns raw tick-level marks. The service buckets
  // them client-side at the interval below, since Deribit does not bucket
  // mark history.
  const now = Date.now();
  const start = now - RANGE_TO_MS[range];
  const url = new URL('/api/v2/public/get_mark_price_history', DERIBIT_REST_BASE_URL);
  url.searchParams.set('instrument_name', symbol);
  url.searchParams.set('start_timestamp', String(start));
  url.searchParams.set('end_timestamp', String(now));
  const res = await fetch(url);
  if (res.status === 404) throw new InstrumentCandlesError('not_found', `Deribit: ${symbol}`);
  if (!res.ok) throw new InstrumentCandlesError('upstream', `Deribit ${res.status}`);
  const parsed = MarkHistorySchema.parse(await res.json());
  return bucketTicks(parsed.result, intervalMs(_interval));
}

const INTERVAL_TO_MS: Record<InstrumentCandleInterval, number> = {
  '1m': 60_000, '5m': 5 * 60_000, '15m': 15 * 60_000,
  '1h': 60 * 60_000, '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000, '1w': 7 * 24 * 60 * 60_000, '1M': 30 * 24 * 60 * 60_000,
};
function intervalMs(i: InstrumentCandleInterval): number { return INTERVAL_TO_MS[i]; }

function bucketTicks(ticks: ReadonlyArray<[number, number]>, bucketMs: number): RawCandle[] {
  const out = new Map<number, RawCandle>();
  for (const [ts, v] of ticks) {
    const b = Math.floor(ts / bucketMs) * bucketMs;
    const cur = out.get(b);
    if (!cur) out.set(b, { ts: b, o: v, h: v, l: v, c: v, vol: 0 });
    else {
      cur.h = Math.max(cur.h, v);
      cur.l = Math.min(cur.l, v);
      cur.c = v;
    }
  }
  return [...out.values()].sort((a, b) => a.ts - b.ts);
}

export class InstrumentCandlesError extends Error {
  constructor(public readonly code: 'not_found' | 'expired' | 'unsupported_venue' | 'upstream', message: string) {
    super(message);
  }
}
```

- [ ] **Step 2.6: Add bucketing unit test**

Append to `packages/core/src/services/instrument-candles.test.ts`:

```ts
import { bucketTicks } from './instrument-candles.js';

describe('bucketTicks (internal export for test)', () => {
  it('aggregates ticks into bucketed candles preserving high/low/close', () => {
    const ticks: [number, number][] = [
      [60_000, 10],
      [60_500, 12],
      [61_000, 9],
      [120_000, 8],
      [121_000, 11],
    ];
    const out = bucketTicks(ticks, 60_000);
    expect(out).toEqual([
      { ts: 60_000, o: 10, h: 12, l: 9, c: 9, vol: 0 },
      { ts: 120_000, o: 8, h: 11, l: 8, c: 11, vol: 0 },
    ]);
  });
});
```

For this to work, export `bucketTicks` from the service. Change `function bucketTicks` to `export function bucketTicks` in the service file.

- [ ] **Step 2.7: Run tests; all should pass**

Run: `pnpm --filter @oggregator/core test instrument-candles`
Expected: PASS — 6 tests.

- [ ] **Step 2.8: Commit**

```bash
git add packages/core/src/services/instrument-candles.ts packages/core/src/services/instrument-candles.test.ts
git commit -m "feat(core): instrument-candles service — Deribit trade+mark merge"
```

---

## Task 3: Service class + cache + venue dispatch

**Goal:** Wrap the fetchers in a `SpotCandleService`-style class with a TTL cache and a single `getCandles` entry point that dispatches by venue.

**Files:**
- Modify: `packages/core/src/services/instrument-candles.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 3.1: Append the service class to `instrument-candles.ts`**

```ts
import type { VenueId } from '@oggregator/protocol';

interface CacheEntry {
  fetchedAt: number;
  response: InstrumentCandlesResponse;
}

export class InstrumentCandleService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 30_000;
  private ready = false;

  async start(): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getCandles(
    venue: VenueId,
    symbol: string,
    interval: InstrumentCandleInterval,
    range: InstrumentCandleRange,
  ): Promise<InstrumentCandlesResponse> {
    const key = `${venue}:${symbol}:${interval}:${range}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.fetchedAt < this.cacheTtlMs) return hit.response;

    if (venue !== 'deribit') {
      throw new InstrumentCandlesError('unsupported_venue', `Venue ${venue} not yet supported`);
    }

    const [trade, mark] = await Promise.all([
      fetchDeribitTrade(symbol, interval, range),
      fetchDeribitMark(symbol, interval, range),
    ]);
    const merged = mergeTradeAndMark(trade, mark);
    const response: InstrumentCandlesResponse = {
      venue, symbol, interval,
      candles: merged.candles,
      markLine: merged.markLine,
    };
    this.cache.set(key, { fetchedAt: Date.now(), response });
    log.debug({ venue, symbol, interval, range, count: merged.candles.length }, 'instrument-candles fetched');
    return response;
  }
}

export const instrumentCandleService = new InstrumentCandleService();
```

- [ ] **Step 3.2: Re-export from core barrel**

Append to `packages/core/src/index.ts`:

```ts
export {
  InstrumentCandleService,
  instrumentCandleService,
  InstrumentCandlesError,
} from './services/instrument-candles.js';
```

- [ ] **Step 3.3: Typecheck**

Run: `pnpm --filter @oggregator/core typecheck`
Expected: PASS.

- [ ] **Step 3.4: Commit**

```bash
git add packages/core/src/services/instrument-candles.ts packages/core/src/index.ts
git commit -m "feat(core): InstrumentCandleService with TTL cache + venue dispatch"
```

---

## Task 4: `GET /api/instrument-candles` route

**Goal:** Expose the service over HTTP, mirroring `routes/spot-candles.ts`. Validate inputs at the boundary, translate `InstrumentCandlesError.code` to HTTP status.

**Files:**
- Create: `packages/server/src/routes/instrument-candles.ts`
- Modify: `packages/server/src/services.ts`
- Modify: `packages/server/src/routes/index.ts`

- [ ] **Step 4.1: Instantiate the service in `services.ts`**

Read the file and find where `spotCandleService` is constructed and started. Add alongside it:

```ts
// near the top, with other imports:
import { InstrumentCandleService } from '@oggregator/core';

// in the services object / construction block:
export const instrumentCandleService = new InstrumentCandleService();
export const isInstrumentCandlesReady = () => instrumentCandleService.isReady();

// in the start() function, after spotCandleService.start():
await instrumentCandleService.start();
```

(If `services.ts` uses a different export pattern than free-standing exports, follow the existing style there — read it first.)

- [ ] **Step 4.2: Create the route**

```ts
// packages/server/src/routes/instrument-candles.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  InstrumentCandleIntervalSchema,
  InstrumentCandleRangeSchema,
  VenueIdSchema,
} from '@oggregator/protocol';
import { InstrumentCandlesError } from '@oggregator/core';
import { instrumentCandleService, isInstrumentCandlesReady } from '../services.js';

const QuerySchema = z.object({
  venue: VenueIdSchema,
  symbol: z.string().min(1).max(64),
  interval: InstrumentCandleIntervalSchema,
  range: InstrumentCandleRangeSchema,
});

export async function instrumentCandlesRoute(app: FastifyInstance) {
  app.get<{ Querystring: Record<string, string> }>('/instrument-candles', async (req, reply) => {
    if (!isInstrumentCandlesReady()) {
      return reply.status(503).send({ error: 'Instrument candles service not ready' });
    }
    const parse = QuerySchema.safeParse(req.query);
    if (!parse.success) {
      return reply.status(400).send({ error: 'Invalid query', issues: parse.error.issues });
    }
    const { venue, symbol, interval, range } = parse.data;
    try {
      const response = await instrumentCandleService.getCandles(venue, symbol, interval, range);
      return response;
    } catch (err) {
      if (err instanceof InstrumentCandlesError) {
        const status =
          err.code === 'not_found' ? 404 :
          err.code === 'expired' ? 410 :
          err.code === 'unsupported_venue' ? 501 :
          502;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
      req.log.warn({ err: String(err), venue, symbol }, 'instrument-candles failed');
      return reply.status(502).send({ error: 'Upstream candle fetch failed' });
    }
  });
}
```

- [ ] **Step 4.3: Register the route**

In `packages/server/src/routes/index.ts`, find the existing `spotCandlesRoute` registration and add:

```ts
import { instrumentCandlesRoute } from './instrument-candles.js';

// alongside the existing register block:
await app.register(instrumentCandlesRoute, { prefix: '/api' });
```

- [ ] **Step 4.4: Smoke test the route locally**

Run the server: `pnpm --filter @oggregator/server dev` (in another shell).

Then:

```bash
curl 'http://localhost:3100/api/instrument-candles?venue=deribit&symbol=BTC-27JUN26-70000-C&interval=1h&range=7d'
```

Expected: 200 with `{ venue, symbol, interval, candles: [...], markLine: [...] }`. If the strike is currently delisted, try a near-ATM strike from `curl http://localhost:3100/api/chains?underlying=BTC` first.

- [ ] **Step 4.5: Commit**

```bash
git add packages/server/src/routes/instrument-candles.ts packages/server/src/routes/index.ts packages/server/src/services.ts
git commit -m "feat(server): GET /api/instrument-candles route"
```

---

## Task 5: Frontend `instrument-symbol.ts` helper

**Goal:** Map `(underlying, expiry, strike, type, venue)` → the venue's native instrument symbol. Required by the hook to call the API. Deribit-only logic in MVP; other venues throw `not_supported` for now.

**Files:**
- Create: `packages/web/src/features/chain/instrument-symbol.ts`
- Create: `packages/web/src/features/chain/instrument-symbol.test.ts`

- [ ] **Step 5.1: Write the failing tests**

```ts
// packages/web/src/features/chain/instrument-symbol.test.ts
import { describe, it, expect } from 'vitest';
import { toVenueSymbol, NotSupportedVenueError } from './instrument-symbol.js';

describe('toVenueSymbol', () => {
  it('formats Deribit BTC call', () => {
    expect(toVenueSymbol({
      venue: 'deribit', underlying: 'BTC', expiry: '2026-06-27',
      strike: 70000, type: 'call',
    })).toBe('BTC-27JUN26-70000-C');
  });

  it('formats Deribit ETH put', () => {
    expect(toVenueSymbol({
      venue: 'deribit', underlying: 'ETH', expiry: '2026-09-26',
      strike: 3000, type: 'put',
    })).toBe('ETH-26SEP26-3000-P');
  });

  it('drops trailing zero on fractional strikes', () => {
    expect(toVenueSymbol({
      venue: 'deribit', underlying: 'SOL', expiry: '2026-05-30',
      strike: 1.14, type: 'call',
    })).toBe('SOL-30MAY26-1.14-C');
  });

  it('throws NotSupportedVenueError for unsupported venues', () => {
    expect(() =>
      toVenueSymbol({ venue: 'okx', underlying: 'BTC', expiry: '2026-06-27', strike: 70000, type: 'call' }),
    ).toThrow(NotSupportedVenueError);
  });
});
```

- [ ] **Step 5.2: Run the tests to verify they fail**

Run: `pnpm --filter @oggregator/web test instrument-symbol`
Expected: FAIL (module not found).

- [ ] **Step 5.3: Implement the helper**

```ts
// packages/web/src/features/chain/instrument-symbol.ts
import type { VenueId } from '@oggregator/protocol';

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

export class NotSupportedVenueError extends Error {
  constructor(public readonly venue: VenueId) {
    super(`Instrument symbol formatting not implemented for venue: ${venue}`);
  }
}

interface ToVenueSymbolArgs {
  venue: VenueId;
  underlying: string;
  expiry: string;            // ISO date (YYYY-MM-DD)
  strike: number;
  type: 'call' | 'put';
}

export function toVenueSymbol(args: ToVenueSymbolArgs): string {
  switch (args.venue) {
    case 'deribit':
      return formatDeribit(args);
    default:
      throw new NotSupportedVenueError(args.venue);
  }
}

function formatDeribit({ underlying, expiry, strike, type }: ToVenueSymbolArgs): string {
  const d = new Date(expiry + 'T00:00:00Z');
  const day = String(d.getUTCDate());
  const mon = MONTHS[d.getUTCMonth()];
  const yr = String(d.getUTCFullYear()).slice(-2);
  const strikeStr = Number.isInteger(strike) ? String(strike) : String(strike);
  return `${underlying}-${day}${mon}${yr}-${strikeStr}-${type === 'call' ? 'C' : 'P'}`;
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `pnpm --filter @oggregator/web test instrument-symbol`
Expected: PASS — 4 tests.

- [ ] **Step 5.5: Commit**

```bash
git add packages/web/src/features/chain/instrument-symbol.ts packages/web/src/features/chain/instrument-symbol.test.ts
git commit -m "feat(web): instrument-symbol helper for venue-native symbols"
```

---

## Task 6: `chart-panels-store.ts` Zustand slice

**Goal:** Floating panel state with `persist` to localStorage. Includes id-deduped `openPanel`, `closePanel`, `updatePanel`, `bringToFront`, and viewport-clamp on rehydrate.

**Files:**
- Create: `packages/web/src/features/chain/chart-panels-store.ts`
- Create: `packages/web/src/features/chain/chart-panels-store.test.ts`

- [ ] **Step 6.1: Write the failing tests**

```ts
// packages/web/src/features/chain/chart-panels-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useChartPanelsStore } from './chart-panels-store.js';

const samplePanel = {
  venue: 'deribit' as const,
  symbol: 'BTC-27JUN26-70000-C',
  underlying: 'BTC',
  expiry: '2026-06-27',
  strike: 70000,
  type: 'call' as const,
};

beforeEach(() => {
  useChartPanelsStore.setState({ panels: [], zCounter: 0 });
});

describe('chart-panels-store', () => {
  it('openPanel adds a new panel', () => {
    useChartPanelsStore.getState().openPanel(samplePanel);
    expect(useChartPanelsStore.getState().panels).toHaveLength(1);
  });

  it('openPanel is id-deduped — same venue+symbol focuses, does not duplicate', () => {
    const s = useChartPanelsStore.getState();
    s.openPanel(samplePanel);
    s.openPanel(samplePanel);
    expect(useChartPanelsStore.getState().panels).toHaveLength(1);
  });

  it('bringToFront sets the highest zSeq', () => {
    const s = useChartPanelsStore.getState();
    s.openPanel(samplePanel);
    s.openPanel({ ...samplePanel, strike: 65000, symbol: 'BTC-27JUN26-65000-C' });
    const [a, b] = useChartPanelsStore.getState().panels;
    expect(b.zSeq).toBeGreaterThan(a.zSeq);
    s.bringToFront(a.id);
    const [a2, b2] = useChartPanelsStore.getState().panels;
    expect(a2.zSeq).toBeGreaterThan(b2.zSeq);
  });

  it('closePanel removes by id', () => {
    const s = useChartPanelsStore.getState();
    s.openPanel(samplePanel);
    const id = useChartPanelsStore.getState().panels[0].id;
    s.closePanel(id);
    expect(useChartPanelsStore.getState().panels).toHaveLength(0);
  });

  it('updatePanel merges patch by id', () => {
    const s = useChartPanelsStore.getState();
    s.openPanel(samplePanel);
    const id = useChartPanelsStore.getState().panels[0].id;
    s.updatePanel(id, { x: 100, y: 200, range: '30d' });
    const p = useChartPanelsStore.getState().panels[0];
    expect(p.x).toBe(100);
    expect(p.y).toBe(200);
    expect(p.range).toBe('30d');
  });

  it('clampToViewport keeps panels inside window dims', () => {
    const s = useChartPanelsStore.getState();
    s.openPanel(samplePanel);
    const id = useChartPanelsStore.getState().panels[0].id;
    s.updatePanel(id, { x: 9999, y: 9999 });
    s.clampToViewport(1280, 720);
    const p = useChartPanelsStore.getState().panels[0];
    expect(p.x).toBeLessThanOrEqual(1280 - p.w);
    expect(p.y).toBeLessThanOrEqual(720 - p.h);
  });
});
```

- [ ] **Step 6.2: Run the tests to verify they fail**

Run: `pnpm --filter @oggregator/web test chart-panels-store`
Expected: FAIL (module not found).

- [ ] **Step 6.3: Implement the store**

```ts
// packages/web/src/features/chain/chart-panels-store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VenueId, InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';

export interface ChartPanel {
  id: string;                // `${venue}:${symbol}`
  venue: VenueId;
  symbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  type: 'call' | 'put';
  x: number; y: number;
  w: number; h: number;
  range: InstrumentCandleRange;
  interval: InstrumentCandleInterval;
  overlays: { mark: boolean; ma9: boolean; ma20: boolean };
  minimized: boolean;
  zSeq: number;
}

interface OpenPanelArgs {
  venue: VenueId;
  symbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  type: 'call' | 'put';
}

interface ChartPanelsState {
  panels: ChartPanel[];
  zCounter: number;
  openPanel: (args: OpenPanelArgs) => string;
  closePanel: (id: string) => void;
  updatePanel: (id: string, patch: Partial<ChartPanel>) => void;
  bringToFront: (id: string) => void;
  clampToViewport: (vw: number, vh: number) => void;
}

const DEFAULT_W = 560;
const DEFAULT_H = 360;
const DEFAULT_OVERLAYS = { mark: true, ma9: true, ma20: true } as const;

function makeId(venue: VenueId, symbol: string): string {
  return `${venue}:${symbol}`;
}

export const useChartPanelsStore = create<ChartPanelsState>()(
  persist(
    (set, get) => ({
      panels: [],
      zCounter: 0,
      openPanel: (args) => {
        const id = makeId(args.venue, args.symbol);
        const existing = get().panels.find((p) => p.id === id);
        if (existing) {
          get().bringToFront(id);
          return id;
        }
        const z = get().zCounter + 1;
        const offset = (get().panels.length % 6) * 24;
        const panel: ChartPanel = {
          id,
          ...args,
          x: 80 + offset,
          y: 80 + offset,
          w: DEFAULT_W,
          h: DEFAULT_H,
          range: '7d',
          interval: '1h',
          overlays: { ...DEFAULT_OVERLAYS },
          minimized: false,
          zSeq: z,
        };
        set({ panels: [...get().panels, panel], zCounter: z });
        return id;
      },
      closePanel: (id) => set({ panels: get().panels.filter((p) => p.id !== id) }),
      updatePanel: (id, patch) =>
        set({
          panels: get().panels.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        }),
      bringToFront: (id) => {
        const z = get().zCounter + 1;
        set({
          panels: get().panels.map((p) => (p.id === id ? { ...p, zSeq: z } : p)),
          zCounter: z,
        });
      },
      clampToViewport: (vw, vh) =>
        set({
          panels: get().panels.map((p) => ({
            ...p,
            x: Math.max(0, Math.min(p.x, vw - p.w)),
            y: Math.max(0, Math.min(p.y, vh - p.h)),
          })),
        }),
    }),
    { name: 'chartPanels.v1' },
  ),
);
```

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `pnpm --filter @oggregator/web test chart-panels-store`
Expected: PASS — 6 tests.

- [ ] **Step 6.5: Commit**

```bash
git add packages/web/src/features/chain/chart-panels-store.ts packages/web/src/features/chain/chart-panels-store.test.ts
git commit -m "feat(web): chart-panels Zustand slice with persist + viewport clamp"
```

---

## Task 7: `use-instrument-candles.ts` hook

**Goal:** TanStack Query hook with REST bootstrap, plus a separate live-tick selector that extends the last candle using the chain cache's live `mid` from `VenueQuote`.

**Files:**
- Create: `packages/web/src/features/chain/use-instrument-candles.ts`
- Create: `packages/web/src/features/chain/use-instrument-candles.test.ts`

- [ ] **Step 7.1: Write the failing live-tick selector test**

The hook combines REST data + live mid. The selector is the pure piece — test it.

```ts
// packages/web/src/features/chain/use-instrument-candles.test.ts
import { describe, it, expect } from 'vitest';
import { applyLiveTick } from './use-instrument-candles.js';
import type { InstrumentCandle } from '@oggregator/protocol';

const base: InstrumentCandle[] = [
  { ts: 1, o: 10, h: 11, l: 9, c: 10.5, vol: 5, synthetic: false },
  { ts: 2, o: 10.5, h: 12, l: 10, c: 11, vol: 3, synthetic: false },
];

describe('applyLiveTick', () => {
  it('extends last candle close and updates h/l when mid moves outside band', () => {
    const out = applyLiveTick(base, 13);
    expect(out[out.length - 1].c).toBe(13);
    expect(out[out.length - 1].h).toBe(13);
  });

  it('lowers low when mid drops below previous low', () => {
    const out = applyLiveTick(base, 8);
    expect(out[out.length - 1].l).toBe(8);
    expect(out[out.length - 1].c).toBe(8);
  });

  it('returns original array reference when no live mid', () => {
    const out = applyLiveTick(base, null);
    expect(out).toBe(base);
  });

  it('returns original when candle list is empty', () => {
    const out = applyLiveTick([], 10);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 7.2: Run tests — verify they fail**

Run: `pnpm --filter @oggregator/web test use-instrument-candles`
Expected: FAIL (module not found).

- [ ] **Step 7.3: Implement the hook + selector**

```ts
// packages/web/src/features/chain/use-instrument-candles.ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type {
  InstrumentCandle,
  InstrumentCandleInterval,
  InstrumentCandleRange,
  InstrumentCandlesResponse,
  VenueId,
} from '@oggregator/protocol';
import { http } from '@lib/http';
import type { EnrichedChain } from '@shared/enriched';

export function applyLiveTick(
  candles: readonly InstrumentCandle[],
  liveMid: number | null,
): InstrumentCandle[] {
  if (liveMid == null || candles.length === 0) return candles as InstrumentCandle[];
  const last = candles[candles.length - 1];
  const next: InstrumentCandle = {
    ...last,
    c: liveMid,
    h: Math.max(last.h, liveMid),
    l: Math.min(last.l, liveMid),
  };
  return [...candles.slice(0, -1), next];
}

interface UseInstrumentCandlesArgs {
  venue: VenueId;
  symbol: string;
  interval: InstrumentCandleInterval;
  range: InstrumentCandleRange;
  enabled?: boolean;
  // Optional live-tick inputs — the caller passes the matching strike's mid.
  liveMid?: number | null;
}

export function useInstrumentCandles({
  venue, symbol, interval, range, enabled = true, liveMid = null,
}: UseInstrumentCandlesArgs) {
  const query = useQuery<InstrumentCandlesResponse>({
    queryKey: ['instrument-candles', venue, symbol, interval, range],
    queryFn: async () => {
      const url = `/api/instrument-candles?venue=${venue}&symbol=${encodeURIComponent(symbol)}&interval=${interval}&range=${range}`;
      return http<InstrumentCandlesResponse>(url);
    },
    enabled,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const candles = useMemo(
    () => applyLiveTick(query.data?.candles ?? [], liveMid),
    [query.data?.candles, liveMid],
  );

  return {
    ...query,
    candles,
    markLine: query.data?.markLine ?? [],
  };
}

// Helper for callers: read the live mid for (venue, strike, type) out of the
// chain query cache. EnrichedStrike uses .call / .put. VenueQuote.mid is the
// live mark proxy used elsewhere in the app.
export function useLiveMidFromChain(
  underlying: string,
  expiry: string,
  strike: number,
  type: 'call' | 'put',
  venue: VenueId,
): number | null {
  const qc = useQueryClient();
  const chain = qc.getQueryData<EnrichedChain>(['chain', underlying, expiry]);
  if (!chain) return null;
  const row = chain.strikes.find((s) => s.strike === strike);
  if (!row) return null;
  const side = type === 'call' ? row.call : row.put;
  return side.venues[venue]?.mid ?? null;
}
```

(If `http` lives at a different path than `@lib/http`, adjust the import — check `packages/web/src/lib/`.)

- [ ] **Step 7.4: Run tests to verify they pass**

Run: `pnpm --filter @oggregator/web test use-instrument-candles`
Expected: PASS — 4 tests.

- [ ] **Step 7.5: Commit**

```bash
git add packages/web/src/features/chain/use-instrument-candles.ts packages/web/src/features/chain/use-instrument-candles.test.ts
git commit -m "feat(web): useInstrumentCandles hook + applyLiveTick selector"
```

---

## Task 8: `InstrumentChart.tsx` renderer

**Goal:** The pure lightweight-charts renderer. Renders candles + mark overlay + MA9 + MA20. Crosshair updates OHLC header values. Supports `compact` mode to hide axes/legend.

**Files:**
- Create: `packages/web/src/features/chain/InstrumentChart.tsx`
- Create: `packages/web/src/features/chain/InstrumentChart.module.css`

- [ ] **Step 8.1: Implement the renderer**

```tsx
// packages/web/src/features/chain/InstrumentChart.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import type { InstrumentCandle, InstrumentMarkPoint } from '@oggregator/protocol';
import styles from './InstrumentChart.module.css';

export interface InstrumentChartProps {
  candles: readonly InstrumentCandle[];
  markLine: readonly InstrumentMarkPoint[];
  overlays: { mark: boolean; ma9: boolean; ma20: boolean };
  compact?: boolean;
}

interface HoverOhlc { o: number; h: number; l: number; c: number; ts: number | null }

function sma(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export default function InstrumentChart({ candles, markLine, overlays, compact = false }: InstrumentChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma9SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const [hover, setHover] = useState<HoverOhlc | null>(null);

  // Init chart once
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#a0a0a0' },
      grid: { vertLines: { visible: false }, horzLines: { color: '#1a1a1a' } },
      timeScale: { visible: !compact, borderVisible: false, timeVisible: true },
      rightPriceScale: { visible: true, borderVisible: false },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#ef4444',
      borderUpColor: '#10b981', borderDownColor: '#ef4444',
      wickUpColor: '#10b981', wickDownColor: '#ef4444',
    });
    markSeriesRef.current = chart.addSeries(LineSeries, { color: '#fbbf24', lineWidth: 1, priceLineVisible: false });
    ma9SeriesRef.current = chart.addSeries(LineSeries, { color: '#a855f7', lineWidth: 1, priceLineVisible: false });
    ma20SeriesRef.current = chart.addSeries(LineSeries, { color: '#facc15', lineWidth: 1, priceLineVisible: false });

    chart.subscribeCrosshairMove((p) => {
      if (!p.time || !candleSeriesRef.current) { setHover(null); return; }
      const data = p.seriesData.get(candleSeriesRef.current);
      if (!data || !('open' in data)) { setHover(null); return; }
      setHover({
        o: data.open as number,
        h: data.high as number,
        l: data.low as number,
        c: data.close as number,
        ts: typeof p.time === 'number' ? p.time : null,
      });
    });

    return () => { chart.remove(); chartRef.current = null; };
  }, [compact]);

  // Set candle data
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const customStyleData = candles.map((c) => ({
      time: (c.ts / 1000) as unknown as number,
      open: c.o, high: c.h, low: c.l, close: c.c,
      // Synthetic bars: muted; rendered via color override.
      ...(c.synthetic
        ? { color: '#6b7280', borderColor: '#6b7280', wickColor: '#6b7280' }
        : {}),
    }));
    candleSeriesRef.current.setData(customStyleData as never);
  }, [candles]);

  // Mark overlay
  useEffect(() => {
    if (!markSeriesRef.current) return;
    if (!overlays.mark) { markSeriesRef.current.setData([]); return; }
    markSeriesRef.current.setData(
      markLine.map((m) => ({ time: (m.ts / 1000) as unknown as number, value: m.c })),
    );
  }, [markLine, overlays.mark]);

  // MA9 / MA20
  const closes = useMemo(() => candles.map((c) => c.c), [candles]);
  const ma9 = useMemo(() => sma(closes, 9), [closes]);
  const ma20 = useMemo(() => sma(closes, 20), [closes]);

  useEffect(() => {
    if (!ma9SeriesRef.current) return;
    if (!overlays.ma9) { ma9SeriesRef.current.setData([]); return; }
    ma9SeriesRef.current.setData(
      candles.flatMap((c, i) => ma9[i] == null ? [] : [{ time: (c.ts / 1000) as unknown as number, value: ma9[i] as number }]),
    );
  }, [ma9, candles, overlays.ma9]);

  useEffect(() => {
    if (!ma20SeriesRef.current) return;
    if (!overlays.ma20) { ma20SeriesRef.current.setData([]); return; }
    ma20SeriesRef.current.setData(
      candles.flatMap((c, i) => ma20[i] == null ? [] : [{ time: (c.ts / 1000) as unknown as number, value: ma20[i] as number }]),
    );
  }, [ma20, candles, overlays.ma20]);

  const displayOhlc = hover ?? (candles.length > 0
    ? { o: candles[candles.length-1].o, h: candles[candles.length-1].h, l: candles[candles.length-1].l, c: candles[candles.length-1].c, ts: null }
    : null);

  return (
    <div className={styles.wrap}>
      {!compact && displayOhlc && (
        <div className={styles.ohlcStrip}>
          <span>O {displayOhlc.o.toFixed(4)}</span>
          <span>H {displayOhlc.h.toFixed(4)}</span>
          <span>L {displayOhlc.l.toFixed(4)}</span>
          <span>C {displayOhlc.c.toFixed(4)}</span>
        </div>
      )}
      <div ref={ref} className={styles.chart} />
    </div>
  );
}
```

- [ ] **Step 8.2: Create the CSS**

```css
/* packages/web/src/features/chain/InstrumentChart.module.css */
.wrap { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 140px; }
.ohlcStrip {
  display: flex; gap: 12px; padding: 2px 6px;
  font: var(--font-mono); font-size: 11px; color: var(--color-muted);
}
.chart { flex: 1; min-height: 0; }
```

- [ ] **Step 8.3: Manual smoke check via Storybook-style page or temporary mount**

Skipping — verified end-to-end in Task 9 once the inline wrapper is wired.

- [ ] **Step 8.4: Commit**

```bash
git add packages/web/src/features/chain/InstrumentChart.tsx packages/web/src/features/chain/InstrumentChart.module.css
git commit -m "feat(web): InstrumentChart renderer — candles + mark + MAs + crosshair"
```

---

## Task 9: `InstrumentChartInline.tsx` + slot into `ExpandedRow`

**Goal:** Compact wrapper that lives in the ExpandedRow left gutter. Auto-picks primary venue, renders a venue dot strip, range buttons, pop-out button.

**Files:**
- Create: `packages/web/src/features/chain/InstrumentChartInline.tsx`
- Create: `packages/web/src/features/chain/InstrumentChartInline.module.css`
- Modify: `packages/web/src/features/chain/ExpandedRow.tsx`
- Modify: `packages/web/src/features/chain/ExpandedRow.module.css`

- [ ] **Step 9.1: Implement the inline wrapper**

```tsx
// packages/web/src/features/chain/InstrumentChartInline.tsx
import { useMemo, useState } from 'react';
import type { EnrichedSide, VenueId, InstrumentCandleInterval } from '@oggregator/protocol';
import { VENUES } from '@lib/venue-meta';
import InstrumentChart from './InstrumentChart.js';
import { useInstrumentCandles, useLiveMidFromChain } from './use-instrument-candles.js';
import { toVenueSymbol, NotSupportedVenueError } from './instrument-symbol.js';
import { useChartPanelsStore } from './chart-panels-store.js';
import styles from './InstrumentChartInline.module.css';

interface Props {
  underlying: string;
  expiry: string;          // ISO YYYY-MM-DD
  strike: number;
  type: 'call' | 'put';
  side: EnrichedSide;
  activeVenues: readonly VenueId[];
}

const INTERVALS: InstrumentCandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'];

function pickPrimaryVenue(side: EnrichedSide, active: readonly VenueId[]): VenueId | null {
  const entries = (Object.entries(side.venues) as [VenueId, { openInterest: number | null }][])
    .filter(([v]) => active.includes(v));
  if (entries.length === 0) return null;
  entries.sort((a, b) => (b[1].openInterest ?? 0) - (a[1].openInterest ?? 0));
  return entries[0][0];
}

function safeSymbol(args: { venue: VenueId; underlying: string; expiry: string; strike: number; type: 'call' | 'put' }): { symbol: string | null; unsupported: boolean } {
  try { return { symbol: toVenueSymbol(args), unsupported: false }; }
  catch (e) {
    if (e instanceof NotSupportedVenueError) return { symbol: null, unsupported: true };
    throw e;
  }
}

export default function InstrumentChartInline({ underlying, expiry, strike, type, side, activeVenues }: Props) {
  const initialVenue = useMemo(() => pickPrimaryVenue(side, activeVenues), [side, activeVenues]);
  const [venue, setVenue] = useState<VenueId | null>(initialVenue);
  const [interval, setInterval] = useState<InstrumentCandleInterval>('1h');
  const openPanel = useChartPanelsStore((s) => s.openPanel);

  // Compute symbol up front so hooks below are called unconditionally.
  const { symbol, unsupported } = useMemo(
    () => (venue ? safeSymbol({ venue, underlying, expiry, strike, type }) : { symbol: null, unsupported: false }),
    [venue, underlying, expiry, strike, type],
  );

  const panelId = venue && symbol ? `${venue}:${symbol}` : null;
  const isPoppedOut = useChartPanelsStore((s) => panelId != null && s.panels.some((p) => p.id === panelId));

  // Hooks below run on every render. `enabled` gates the network call.
  const liveMid = useLiveMidFromChain(underlying, expiry, strike, type, venue ?? ('deribit' as VenueId));
  const { candles, markLine, isLoading, error } = useInstrumentCandles({
    venue: venue ?? ('deribit' as VenueId),
    symbol: symbol ?? '',
    interval,
    range: '7d',
    liveMid: venue ? liveMid : null,
    enabled: !!venue && !!symbol && !isPoppedOut,
  });

  // Now branch on render output.
  if (!venue) {
    return <div className={styles.empty}>No venue with this strike</div>;
  }
  if (unsupported) {
    return (
      <div className={styles.empty}>
        Historical chart unavailable for {VENUES[venue]?.shortLabel ?? venue} — switch venue
        <VenueDotStrip venues={Object.keys(side.venues) as VenueId[]} active={venue} onSwitch={setVenue} />
      </div>
    );
  }
  if (isPoppedOut) {
    return <div className={styles.placeholder}>popped out — click panel to focus</div>;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.intervals}>
          {INTERVALS.map((i) => (
            <button key={i} type="button" data-active={interval === i} onClick={() => setInterval(i)}>
              {i}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.popOut}
          aria-label="Pop out chart"
          onClick={() => symbol && openPanel({ venue, symbol, underlying, expiry, strike, type })}
        >⤢</button>
      </div>
      <VenueDotStrip venues={Object.keys(side.venues) as VenueId[]} active={venue} onSwitch={setVenue} />
      {isLoading && <div className={styles.empty}>…</div>}
      {error && <div className={styles.empty}>—</div>}
      {!isLoading && !error && (
        <InstrumentChart
          candles={candles}
          markLine={markLine}
          overlays={{ mark: true, ma9: false, ma20: false }}
          compact
        />
      )}
    </div>
  );
}

function VenueDotStrip({ venues, active, onSwitch }: {
  venues: VenueId[]; active: VenueId; onSwitch: (v: VenueId) => void;
}) {
  return (
    <div className={styles.dots}>
      {venues.map((v) => (
        <button key={v} type="button" data-active={v === active} onClick={() => onSwitch(v)} title={v}>
          {VENUES[v]?.shortLabel ?? v}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 9.2: Create the inline CSS**

```css
/* packages/web/src/features/chain/InstrumentChartInline.module.css */
.wrap {
  display: flex; flex-direction: column; gap: 4px;
  width: 280px; height: 200px;
  padding: 6px;
  border-right: 1px solid var(--color-border);
}
.header { display: flex; justify-content: space-between; align-items: center; }
.intervals { display: flex; gap: 2px; }
.intervals button {
  font: var(--font-mono); font-size: 10px;
  padding: 1px 4px; background: transparent;
  color: var(--color-muted); border: none; cursor: pointer;
}
.intervals button[data-active="true"] { color: var(--color-text); background: var(--color-surface-2); }
.popOut {
  background: transparent; border: none; cursor: pointer; color: var(--color-muted);
  font-size: 12px; padding: 0 4px;
}
.popOut:hover { color: var(--color-text); }
.dots { display: flex; gap: 4px; flex-wrap: wrap; }
.dots button {
  font: var(--font-mono); font-size: 9px; padding: 1px 4px;
  background: transparent; border: 1px solid var(--color-border); color: var(--color-muted);
  cursor: pointer;
}
.dots button[data-active="true"] { color: var(--color-text); border-color: var(--color-accent); }
.empty, .placeholder {
  font: var(--font-mono); font-size: 11px; color: var(--color-muted);
  padding: 8px; text-align: center;
}
```

- [ ] **Step 9.3: Slot into `ExpandedRow.tsx`**

Read the current `ExpandedRow.tsx`. The default export receives `strike, callSide, putSide, myIv, activeVenues, atmStrike, atmConsensusForward`. Add `expiry: string; underlying: string;` to its props (the caller `ChainTable.tsx` already has these — pass through).

Then inside the `expanded` container, wrap the existing `sides` block with a left slot:

```tsx
import InstrumentChartInline from './InstrumentChartInline.js';

// in ExpandedRow's render, replace the outer wrapper:
return (
  <div className={styles.expanded}>
    {atmConsensusForward != null && atmStrike != null && (
      <div className={styles.consensusLine}>
        CONSENSUS F @ ATM {atmStrike.toLocaleString()}: {fmtUsd(atmConsensusForward)}
      </div>
    )}

    <div className={styles.layout}>
      <div className={styles.chartSlot}>
        <InstrumentChartInline
          underlying={underlying}
          expiry={expiry}
          strike={strike}
          type="call"
          side={callSide}
          activeVenues={activeVenues as VenueId[]}
        />
      </div>

      <div className={styles.sides}>
        {/* …existing call side / strike channel / put side… */}
      </div>
    </div>
  </div>
);
```

Update the parent `ChainTable.tsx` to pass `underlying` and `expiry` to `ExpandedRow`. (Read `ChainTable.tsx` first — these may already be in scope.)

- [ ] **Step 9.4: Update `ExpandedRow.module.css`**

Add the layout containers — read the existing file first and adjust grid; do not blow it away.

```css
/* append to ExpandedRow.module.css */
.layout { display: flex; gap: 8px; }
.chartSlot { flex: 0 0 auto; }
.sides { flex: 1 1 auto; }   /* keep the existing styles for .sides; this just makes it fill */
```

- [ ] **Step 9.5: Typecheck + manual verify**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: PASS.

Run the dev server, open the chain page, expand a Deribit BTC ATM strike. Expected: inline chart appears on the left of the venue tables, shows ~7d of candles + mark line, live last-candle ticks as chain updates land.

- [ ] **Step 9.6: Commit**

```bash
git add packages/web/src/features/chain/InstrumentChartInline.tsx \
        packages/web/src/features/chain/InstrumentChartInline.module.css \
        packages/web/src/features/chain/ExpandedRow.tsx \
        packages/web/src/features/chain/ExpandedRow.module.css \
        packages/web/src/features/chain/ChainTable.tsx
git commit -m "feat(web): inline instrument chart in ExpandedRow"
```

---

## Task 10: `FloatingChartPanel` + `ChartPanelLayer` + pop-out flow

**Goal:** Drag/resize floating panel that mounts via portal at the app root. Reads the store, renders one panel per entry, brings to front on click.

**Files:**
- Create: `packages/web/src/features/chain/FloatingChartPanel.tsx`
- Create: `packages/web/src/features/chain/FloatingChartPanel.module.css`
- Create: `packages/web/src/features/chain/ChartPanelLayer.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 10.1: Implement `FloatingChartPanel`**

```tsx
// packages/web/src/features/chain/FloatingChartPanel.tsx
import { useEffect, useRef, useState } from 'react';
import type { ChartPanel } from './chart-panels-store.js';
import { useChartPanelsStore } from './chart-panels-store.js';
import { useInstrumentCandles, useLiveMidFromChain } from './use-instrument-candles.js';
import InstrumentChart from './InstrumentChart.js';
import { VENUES } from '@lib/venue-meta';
import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';
import styles from './FloatingChartPanel.module.css';

const INTERVALS: InstrumentCandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'];
const RANGES: InstrumentCandleRange[] = ['1d', '7d', '30d', 'max'];

interface DragState { startX: number; startY: number; panelX: number; panelY: number }
interface ResizeState { startX: number; startY: number; w: number; h: number }

export default function FloatingChartPanel({ panel }: { panel: ChartPanel }) {
  const update = useChartPanelsStore((s) => s.updatePanel);
  const close = useChartPanelsStore((s) => s.closePanel);
  const front = useChartPanelsStore((s) => s.bringToFront);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const [isDragging, setDragging] = useState(false);

  const liveMid = useLiveMidFromChain(panel.underlying, panel.expiry, panel.strike, panel.type, panel.venue);
  const { candles, markLine, isLoading, error } = useInstrumentCandles({
    venue: panel.venue, symbol: panel.symbol,
    interval: panel.interval, range: panel.range, liveMid,
  });

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        update(panel.id, {
          x: Math.max(0, dragRef.current.panelX + dx),
          y: Math.max(0, dragRef.current.panelY + dy),
        });
      } else if (resizeRef.current) {
        const dw = e.clientX - resizeRef.current.startX;
        const dh = e.clientY - resizeRef.current.startY;
        update(panel.id, {
          w: Math.max(320, resizeRef.current.w + dw),
          h: Math.max(220, resizeRef.current.h + dh),
        });
      }
    }
    function onUp() {
      dragRef.current = null;
      resizeRef.current = null;
      setDragging(false);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [panel.id, update]);

  function startDrag(e: React.PointerEvent) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, panelX: panel.x, panelY: panel.y };
    setDragging(true);
    front(panel.id);
  }
  function startResize(e: React.PointerEvent) {
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, w: panel.w, h: panel.h };
    front(panel.id);
  }

  return (
    <div
      className={styles.panel}
      data-minimized={panel.minimized || undefined}
      style={{
        transform: `translate(${panel.x}px, ${panel.y}px)`,
        width: panel.w, height: panel.minimized ? 28 : panel.h,
        zIndex: panel.zSeq,
      }}
      onPointerDown={() => front(panel.id)}
    >
      <div className={styles.titlebar} onPointerDown={startDrag}>
        <span className={styles.title}>
          {panel.symbol}
          <span className={styles.venueLabel}> · {VENUES[panel.venue]?.shortLabel ?? panel.venue}</span>
        </span>
        <span className={styles.controls}>
          <button type="button" onClick={() => update(panel.id, { minimized: !panel.minimized })}>—</button>
          <button type="button" onClick={() => close(panel.id)}>✕</button>
        </span>
      </div>
      {!panel.minimized && (
        <>
          <div className={styles.toolbar}>
            <div className={styles.intervals}>
              {INTERVALS.map((i) => (
                <button key={i} type="button" data-active={panel.interval === i} onClick={() => update(panel.id, { interval: i })}>{i}</button>
              ))}
            </div>
            <div className={styles.ranges}>
              {RANGES.map((r) => (
                <button key={r} type="button" data-active={panel.range === r} onClick={() => update(panel.id, { range: r })}>{r}</button>
              ))}
            </div>
            <div className={styles.overlays}>
              <button type="button" data-active={panel.overlays.mark} onClick={() => update(panel.id, { overlays: { ...panel.overlays, mark: !panel.overlays.mark } })}>Mark</button>
              <button type="button" data-active={panel.overlays.ma9} onClick={() => update(panel.id, { overlays: { ...panel.overlays, ma9: !panel.overlays.ma9 } })}>MA9</button>
              <button type="button" data-active={panel.overlays.ma20} onClick={() => update(panel.id, { overlays: { ...panel.overlays, ma20: !panel.overlays.ma20 } })}>MA20</button>
            </div>
          </div>
          <div className={styles.body}>
            {isLoading && <div className={styles.empty}>loading…</div>}
            {error && <div className={styles.empty}>error — retry</div>}
            {!isLoading && !error && (
              <InstrumentChart candles={candles} markLine={markLine} overlays={panel.overlays} />
            )}
          </div>
          <div className={styles.resize} onPointerDown={startResize} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 10.2: Implement `ChartPanelLayer`**

```tsx
// packages/web/src/features/chain/ChartPanelLayer.tsx
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useChartPanelsStore } from './chart-panels-store.js';
import FloatingChartPanel from './FloatingChartPanel.js';

export default function ChartPanelLayer() {
  const panels = useChartPanelsStore((s) => s.panels);
  const clamp = useChartPanelsStore((s) => s.clampToViewport);

  useEffect(() => {
    function onResize() { clamp(window.innerWidth, window.innerHeight); }
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  if (typeof document === 'undefined') return null;
  let host = document.getElementById('chart-panel-layer');
  if (!host) {
    host = document.createElement('div');
    host.id = 'chart-panel-layer';
    document.body.appendChild(host);
  }
  return createPortal(
    <>
      {panels.map((p) => <FloatingChartPanel key={p.id} panel={p} />)}
    </>,
    host,
  );
}
```

- [ ] **Step 10.3: Create the CSS**

```css
/* packages/web/src/features/chain/FloatingChartPanel.module.css */
.panel {
  position: fixed; top: 0; left: 0;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  display: flex; flex-direction: column;
  font: var(--font-mono);
}
.titlebar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 8px;
  background: var(--color-surface-2);
  cursor: grab;
  user-select: none;
  font-size: 11px;
}
.titlebar:active { cursor: grabbing; }
.title { color: var(--color-text); }
.venueLabel { color: var(--color-muted); }
.controls button {
  background: transparent; border: none; color: var(--color-muted); cursor: pointer;
  padding: 0 6px; font-size: 12px;
}
.controls button:hover { color: var(--color-text); }
.toolbar {
  display: flex; gap: 8px; padding: 4px 8px;
  font-size: 10px; border-bottom: 1px solid var(--color-border);
}
.intervals, .ranges, .overlays { display: flex; gap: 2px; }
.toolbar button {
  background: transparent; border: 1px solid transparent;
  color: var(--color-muted); padding: 1px 4px; cursor: pointer;
  font: inherit;
}
.toolbar button[data-active="true"] {
  color: var(--color-text); border-color: var(--color-accent);
}
.body { flex: 1; min-height: 0; }
.empty { padding: 16px; color: var(--color-muted); font-size: 12px; text-align: center; }
.resize {
  position: absolute; bottom: 0; right: 0; width: 14px; height: 14px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, var(--color-border) 50%);
}
```

- [ ] **Step 10.4: Mount `ChartPanelLayer` in `App.tsx`**

Read `App.tsx`. Inside the top-level component (after any provider wrappers), render `<ChartPanelLayer />` once:

```tsx
import ChartPanelLayer from '@features/chain/ChartPanelLayer.js';
// …inside the App return tree, near the root, alongside existing layout:
<ChartPanelLayer />
```

- [ ] **Step 10.5: Typecheck + manual verify**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: PASS.

Run dev server. Expand a Deribit strike → click `⤢` on the inline chart. Expected: floating panel appears over the chain; inline mini swaps to "popped out" placeholder. Verify drag, resize, range/interval/overlay toggles, close. Open a second strike's chart — both panels visible, clicking one brings it to front.

- [ ] **Step 10.6: Commit**

```bash
git add packages/web/src/features/chain/FloatingChartPanel.tsx \
        packages/web/src/features/chain/FloatingChartPanel.module.css \
        packages/web/src/features/chain/ChartPanelLayer.tsx \
        packages/web/src/App.tsx
git commit -m "feat(web): floating chart panel + pop-out wiring"
```

---

## Task 11: Persistence verification

**Goal:** Confirm panel state rehydrates correctly across reload, and that the 200ms fetch-debounce after rehydrate prevents a fetch storm.

**Files:**
- Modify: `packages/web/src/features/chain/use-instrument-candles.ts` (debounce on first mount after rehydrate)

- [ ] **Step 11.1: Add a "warmup" gate to the hook**

The chain WS prime can take ~200ms after a reload. Add a one-shot gate before the query enables:

```ts
// In use-instrument-candles.ts, at module top:
let warmupDone = false;
const warmupPromise = new Promise<void>((r) => setTimeout(() => { warmupDone = true; r(); }, 200));

// In useInstrumentCandles, near the queryFn:
const query = useQuery<InstrumentCandlesResponse>({
  queryKey: ['instrument-candles', venue, symbol, interval, range],
  queryFn: async () => {
    if (!warmupDone) await warmupPromise;
    const url = `/api/instrument-candles?venue=${venue}&symbol=${encodeURIComponent(symbol)}&interval=${interval}&range=${range}`;
    return http<InstrumentCandlesResponse>(url);
  },
  // …
});
```

- [ ] **Step 11.2: Manual verification**

Open three different strikes' panels. Reload the page. Expected: all three panels rehydrate at their saved positions/sizes/ranges; data lands within ~1s; no double-fetch in the network tab.

- [ ] **Step 11.3: Commit**

```bash
git add packages/web/src/features/chain/use-instrument-candles.ts
git commit -m "feat(web): 200ms warmup debounce after rehydrate"
```

---

## Task 12: Mobile fallback modal

**Goal:** On mobile, disable floating panels. `⤢` opens a full-screen modal instead. Inline mini stays unchanged.

**Files:**
- Modify: `packages/web/src/features/chain/InstrumentChartInline.tsx`
- Modify: `packages/web/src/features/chain/FloatingChartPanel.tsx`
- Modify: `packages/web/src/features/chain/ChartPanelLayer.tsx`

- [ ] **Step 12.1: Branch on `useIsMobile` in `ChartPanelLayer`**

In `ChartPanelLayer.tsx`, replace the panel render with a mobile-aware render:

```tsx
import { useIsMobile } from '@hooks/useIsMobile';
// …
const isMobile = useIsMobile();
return createPortal(
  <>
    {panels.map((p) => (
      isMobile
        ? <MobileChartModal key={p.id} panel={p} />
        : <FloatingChartPanel key={p.id} panel={p} />
    ))}
  </>,
  host,
);
```

- [ ] **Step 12.2: Add `MobileChartModal` component**

In a new file or inline at the bottom of `FloatingChartPanel.tsx`:

```tsx
export function MobileChartModal({ panel }: { panel: ChartPanel }) {
  const close = useChartPanelsStore((s) => s.closePanel);
  const update = useChartPanelsStore((s) => s.updatePanel);
  const liveMid = useLiveMidFromChain(panel.underlying, panel.expiry, panel.strike, panel.type, panel.venue);
  const { candles, markLine, isLoading, error } = useInstrumentCandles({
    venue: panel.venue, symbol: panel.symbol,
    interval: panel.interval, range: panel.range, liveMid,
  });
  return (
    <div className={styles.mobileModal}>
      <div className={styles.titlebar}>
        <span className={styles.title}>{panel.symbol}</span>
        <button type="button" onClick={() => close(panel.id)}>✕</button>
      </div>
      <div className={styles.toolbar}>
        {/* Same toolbar as desktop; reuse from FloatingChartPanel via an inner component if desired. */}
      </div>
      <div className={styles.body}>
        {isLoading && <div className={styles.empty}>loading…</div>}
        {error && <div className={styles.empty}>error — retry</div>}
        {!isLoading && !error && (
          <InstrumentChart candles={candles} markLine={markLine} overlays={panel.overlays} />
        )}
      </div>
    </div>
  );
}
```

Add the CSS class:

```css
/* in FloatingChartPanel.module.css */
.mobileModal {
  position: fixed; inset: 0;
  background: var(--color-surface-0);
  display: flex; flex-direction: column;
  z-index: 1000;
}
```

- [ ] **Step 12.3: Manual verify on mobile breakpoint**

Open dev tools, switch to mobile viewport. Expand a strike, tap `⤢`. Expected: full-screen modal opens; close returns to chain.

- [ ] **Step 12.4: Commit**

```bash
git add packages/web/src/features/chain/FloatingChartPanel.tsx \
        packages/web/src/features/chain/FloatingChartPanel.module.css \
        packages/web/src/features/chain/ChartPanelLayer.tsx
git commit -m "feat(web): mobile fallback — full-screen modal in place of floating panel"
```

---

## Final verification

- [ ] **Run the whole test suite**

```bash
pnpm --filter @oggregator/core test
pnpm --filter @oggregator/web test
```

Expected: all green.

- [ ] **Typecheck both packages**

```bash
pnpm --filter @oggregator/core typecheck
pnpm --filter @oggregator/server typecheck
pnpm --filter @oggregator/web typecheck
```

Expected: all green.

- [ ] **End-to-end smoke**

Start the server + web dev. On the chain page:
1. Expand a Deribit BTC ATM strike → inline chart shows ~7d of candles + mark line.
2. Pop out → floating panel appears, inline shows "popped out — click panel to focus".
3. Drag panel; resize; switch range to 30d; toggle MA9 off; switch venue dot to a non-Deribit venue → see the "switch venue" empty state.
4. Open a second strike's panel; reload — both rehydrate.
5. Switch to mobile viewport — pop-out becomes full-screen modal.

- [ ] **Cleanup pass**

Run the `comment-cleanup` skill across the new files. Verify no stale "// TODO" lines, no narration comments.

---

## Out of scope reminders

These are explicitly **not** in this plan and must not be added during implementation:

- Per-contract IV history line (v2 spec — requires forward-only mark-IV snapshot ingestion).
- Real browser window pop-out via `window.open()` (v2 spec).
- OKX/Bybit/Gate/Thalex adapter methods (v1.1 — one PR per venue).
- Drawing tools, full indicator browser, alerts, cross-venue overlay, multi-contract overlay, configurable MA periods.

If during implementation one of these feels unavoidable, stop and file a follow-up issue. Don't add it.
