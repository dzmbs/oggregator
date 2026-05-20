import { describe, it, expect } from 'vitest';
import type { EnrichedChainResponse, VenueQuote } from '@shared/enriched';

import {
  classifyStrikeVsEm,
  computeExpectedMove,
  filterRowsBySignificance,
  selectSignificantStrikes,
  STRIKE_FILTER,
  type ExpectedMove,
} from './oi-em-utils';
import type { HeatRow } from './oi-heatmap-utils';

interface QuoteSpec {
  venue?: string;
  bid?: number | null;
  ask?: number | null;
  markIv?: number | null;
  oi?: number;
  oiUsd?: number;
  bestIv?: number | null;
}

function quote(s: QuoteSpec): VenueQuote {
  return {
    bid: s.bid ?? null,
    ask: s.ask ?? null,
    mid: s.bid != null && s.ask != null ? (s.bid + s.ask) / 2 : null,
    bidSize: null,
    askSize: null,
    markIv: s.markIv ?? null,
    bidIv: null,
    askIv: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    spreadPct: null,
    totalCost: null,
    estimatedFees: null,
    openInterest: s.oi ?? 0,
    volume24h: null,
    openInterestUsd: s.oiUsd ?? 0,
    volume24hUsd: null,
  };
}

interface StrikeSpec {
  strike: number;
  call?: QuoteSpec | QuoteSpec[];
  put?: QuoteSpec | QuoteSpec[];
  callBestIv?: number | null;
  putBestIv?: number | null;
}

function chain(expiry: string, dte: number, strikes: StrikeSpec[]): EnrichedChainResponse {
  return {
    underlying: 'BTC',
    expiry,
    expiryTs: null,
    dte,
    stats: {
      forwardPriceUsd: null,
      indexPriceUsd: null,
      basisPct: null,
      atmStrike: null,
      atmIv: null,
      putCallOiRatio: null,
      totalOiUsd: null,
      skew25d: null,
      bfly25d: null,
    },
    strikes: strikes.map((s) => ({
      strike: s.strike,
      call: buildSide(s.call, s.callBestIv ?? null),
      put: buildSide(s.put, s.putBestIv ?? null),
    })),
    gex: [],
  };
}

function buildSide(
  spec: QuoteSpec | QuoteSpec[] | undefined,
  bestIv: number | null,
): EnrichedChainResponse['strikes'][number]['call'] {
  const venues: Record<string, VenueQuote> = {};
  if (spec) {
    const list = Array.isArray(spec) ? spec : [spec];
    for (const s of list) venues[s.venue ?? 'deribit'] = quote(s);
  }
  return { venues, bestIv, bestVenue: null };
}

// ── computeExpectedMove ──────────────────────────────────────────────

describe('computeExpectedMove', () => {
  it('returns null when spot is invalid', () => {
    const c = chain('2026-05-01', 4, [{ strike: 80_000, callBestIv: 0.5, putBestIv: 0.5 }]);
    expect(computeExpectedMove(c, 0)).toBeNull();
    expect(computeExpectedMove(c, NaN)).toBeNull();
  });

  it('returns null when chain has no strikes', () => {
    const c = chain('2026-05-01', 4, []);
    expect(computeExpectedMove(c, 80_000)).toBeNull();
  });

  it('uses straddle when both legs are tight and within deviation cap', () => {
    // ATM IV 50%, dte 4 → EM_iv ≈ 80000 * 0.5 * sqrt(4/365) ≈ 4188
    // Straddle bid 1500/1700 each → mid 1600, both legs → straddle EM = 3200 * 1.25 = 4000
    // |4000 - 4188| / 4188 ≈ 0.045 → within 50% cap.
    const c = chain('2026-05-01', 4, [
      {
        strike: 80_000,
        call: { bid: 1500, ask: 1530, markIv: 0.5 },
        put: { bid: 1500, ask: 1530, markIv: 0.5 },
        callBestIv: 0.5,
        putBestIv: 0.5,
      },
    ]);
    const em = computeExpectedMove(c, 80_000)!;
    expect(em.source).toBe('straddle');
    expect(em.value).toBeGreaterThan(3500);
    expect(em.value).toBeLessThan(4200);
  });

  it('falls back to IV when call leg has missing bid/ask', () => {
    const c = chain('2026-05-01', 4, [
      {
        strike: 80_000,
        call: { bid: null, ask: 1500, markIv: 0.5 },
        put: { bid: 1500, ask: 1530, markIv: 0.5 },
        callBestIv: 0.5,
        putBestIv: 0.5,
      },
    ]);
    const em = computeExpectedMove(c, 80_000);
    expect(em?.source).toBe('iv-fallback');
  });

  it('falls back to IV when relative spread exceeds 5%', () => {
    // bid=1500, ask=1700 → spread=200, mid=1600, rel=12.5% → fail
    const c = chain('2026-05-01', 4, [
      {
        strike: 80_000,
        call: { bid: 1500, ask: 1700, markIv: 0.5 },
        put: { bid: 1500, ask: 1530, markIv: 0.5 },
        callBestIv: 0.5,
        putBestIv: 0.5,
      },
    ]);
    const em = computeExpectedMove(c, 80_000);
    expect(em?.source).toBe('iv-fallback');
  });

  it('falls back to IV when straddle deviates more than 50% from IV anchor', () => {
    // EM_iv ≈ 4188; straddle of 8000 → EM_straddle=20000, dev ≈ 3.78 → fail
    const c = chain('2026-05-01', 4, [
      {
        strike: 80_000,
        call: { bid: 7990, ask: 8010, markIv: 0.5 },
        put: { bid: 7990, ask: 8010, markIv: 0.5 },
        callBestIv: 0.5,
        putBestIv: 0.5,
      },
    ]);
    const em = computeExpectedMove(c, 80_000);
    expect(em?.source).toBe('iv-fallback');
    // EM_iv approx 4188
    expect(em!.value).toBeGreaterThan(4000);
    expect(em!.value).toBeLessThan(4400);
  });

  it('uses cross-venue best bid/ask for the composite mid', () => {
    // Two venues for the call: deribit gives wider quote, okx gives tight quote.
    // The composite NBBO should use okx ask + deribit bid → tight synthetic.
    const c = chain('2026-05-01', 4, [
      {
        strike: 80_000,
        call: [
          { venue: 'deribit', bid: 1500, ask: 1700, markIv: 0.5 },
          { venue: 'okx', bid: 1450, ask: 1520, markIv: 0.5 },
        ],
        put: { bid: 1500, ask: 1530, markIv: 0.5 },
        callBestIv: 0.5,
        putBestIv: 0.5,
      },
    ]);
    const em = computeExpectedMove(c, 80_000);
    // Composite call: bestBid=1500, bestAsk=1520 → spread ~1.3% → passes.
    expect(em?.source).toBe('straddle');
  });

  it('interpolates ATM IV between bracketing strikes when spot is between strikes', () => {
    // strikes 78k @ 0.40, 82k @ 0.60. Spot 80k → interp = 0.50.
    // EM_iv ≈ 80000 * 0.50 * sqrt(7/365) ≈ 5530.
    const c = chain('2026-05-04', 7, [
      { strike: 78_000, callBestIv: 0.40, putBestIv: 0.40 },
      { strike: 82_000, callBestIv: 0.60, putBestIv: 0.60 },
    ]);
    const em = computeExpectedMove(c, 80_000)!;
    expect(em.source).toBe('iv-fallback'); // no straddle quotes
    expect(em.value).toBeGreaterThan(5300);
    expect(em.value).toBeLessThan(5700);
  });
});

// ── selectSignificantStrikes ─────────────────────────────────────────

describe('selectSignificantStrikes', () => {
  function bigChain(expiry: string, dte: number): EnrichedChainResponse {
    // 11 strikes with varied OI. Spot = 80_000.
    const strikes: StrikeSpec[] = [];
    const oiPattern = [10, 20, 30, 40, 100, 500, 100, 80, 60, 40, 20]; // peak at 80k
    for (let i = 0; i < 11; i++) {
      const strike = 75_000 + i * 1_000;
      strikes.push({
        strike,
        call: { oi: oiPattern[i]!, oiUsd: oiPattern[i]! * 1_000 },
        callBestIv: 0.5,
        putBestIv: 0.5,
      });
    }
    return chain(expiry, dte, strikes);
  }

  const em: ExpectedMove = { expiry: '2026-05-01', dte: 4, value: 4_000, source: 'straddle' };

  it('returns empty when spotPrice is null', () => {
    const result = selectSignificantStrikes({
      chains: [bigChain('2026-05-01', 4)],
      spotPrice: null,
      mode: 'contracts',
      hiddenExpiries: new Set(),
      side: 'both',
      emByExpiry: new Map([['2026-05-01', em]]),
      significance: 'a3-topk',
    });
    expect(result.size).toBe(0);
  });

  it('A3 keeps top-K=5 by OI per expiry within ±2·EM band', () => {
    const result = selectSignificantStrikes({
      chains: [bigChain('2026-05-01', 4)],
      spotPrice: 80_000,
      mode: 'contracts',
      hiddenExpiries: new Set(),
      side: 'both',
      emByExpiry: new Map([['2026-05-01', em]]),
      significance: 'a3-topk',
    });
    // Top 5 by OI from pattern [10,20,30,40,100,500,100,80,60,40,20]: 500,100,100,80,60
    // Strikes: 80k,79k,81k,82k,83k
    expect(result.size).toBe(STRIKE_FILTER.topK);
    expect(result.has(80_000)).toBe(true);
    expect(result.has(79_000)).toBe(true);
    expect(result.has(81_000)).toBe(true);
  });

  it('A3 unions top-K from each visible expiry', () => {
    const c1 = bigChain('2026-05-01', 4);
    const c2 = chain('2026-05-08', 11, [
      { strike: 90_000, call: { oi: 1_000, oiUsd: 0 }, callBestIv: 0.5 },
    ]);
    const em2: ExpectedMove = { expiry: '2026-05-08', dte: 11, value: 12_000, source: 'straddle' };
    const result = selectSignificantStrikes({
      chains: [c1, c2],
      spotPrice: 80_000,
      mode: 'contracts',
      hiddenExpiries: new Set(),
      side: 'both',
      emByExpiry: new Map([['2026-05-01', em], ['2026-05-08', em2]]),
      significance: 'a3-topk',
    });
    expect(result.has(90_000)).toBe(true);
    expect(result.size).toBe(STRIKE_FILTER.topK + 1);
  });

  it('A3 skips expiries without an EM entry', () => {
    const result = selectSignificantStrikes({
      chains: [bigChain('2026-05-01', 4)],
      spotPrice: 80_000,
      mode: 'contracts',
      hiddenExpiries: new Set(),
      side: 'both',
      emByExpiry: new Map(),
      significance: 'a3-topk',
    });
    expect(result.size).toBe(0);
  });

  it('A3 respects hiddenExpiries', () => {
    const result = selectSignificantStrikes({
      chains: [bigChain('2026-05-01', 4)],
      spotPrice: 80_000,
      mode: 'contracts',
      hiddenExpiries: new Set(['2026-05-01']),
      side: 'both',
      emByExpiry: new Map([['2026-05-01', em]]),
      significance: 'a3-topk',
    });
    expect(result.size).toBe(0);
  });

  it('A4 keeps strikes above mean + 1.5σ of OI distribution', () => {
    const result = selectSignificantStrikes({
      chains: [bigChain('2026-05-01', 4)],
      spotPrice: 80_000,
      mode: 'contracts',
      hiddenExpiries: new Set(),
      side: 'both',
      emByExpiry: new Map([['2026-05-01', em]]),
      significance: 'a4-outliers',
    });
    // Strong outlier 500 dominates. Mean+1.5σ ~ peaked, so just the 500 strike (80k) qualifies.
    expect(result.has(80_000)).toBe(true);
  });

  it('A4 returns empty when distribution is perfectly flat', () => {
    const flat = chain('2026-05-01', 4, Array.from({ length: 5 }, (_, i) => ({
      strike: 78_000 + i * 1_000,
      call: { oi: 100, oiUsd: 0 },
      callBestIv: 0.5,
    })));
    const result = selectSignificantStrikes({
      chains: [flat],
      spotPrice: 80_000,
      mode: 'contracts',
      hiddenExpiries: new Set(),
      side: 'both',
      emByExpiry: new Map([['2026-05-01', em]]),
      significance: 'a4-outliers',
    });
    expect(result.size).toBe(0);
  });

  it('clips strikes outside ±2·EM of spot', () => {
    // EM=4000 → ±8000 → window [72k, 88k]. A 95k strike must be excluded.
    const c = chain('2026-05-01', 4, [
      { strike: 80_000, call: { oi: 100, oiUsd: 0 }, callBestIv: 0.5 },
      { strike: 95_000, call: { oi: 999, oiUsd: 0 }, callBestIv: 0.5 },
    ]);
    const result = selectSignificantStrikes({
      chains: [c],
      spotPrice: 80_000,
      mode: 'contracts',
      hiddenExpiries: new Set(),
      side: 'both',
      emByExpiry: new Map([['2026-05-01', em]]),
      significance: 'a3-topk',
    });
    expect(result.has(95_000)).toBe(false);
    expect(result.has(80_000)).toBe(true);
  });
});

// ── filterRowsBySignificance ─────────────────────────────────────────

describe('filterRowsBySignificance', () => {
  const rows: HeatRow[] = [
    { strike: 79_000, callOi: 0, putOi: 50, magnitude: 50, dominant: 'put' },
    { strike: 80_000, callOi: 100, putOi: 0, magnitude: 100, dominant: 'call' },
    { strike: 81_000, callOi: 30, putOi: 0, magnitude: 30, dominant: 'call' },
  ];

  it('keeps only rows whose strike is in the significant set', () => {
    const filtered = filterRowsBySignificance(rows, new Set([80_000]));
    expect(filtered.map((r) => r.strike)).toEqual([80_000]);
  });

  it('returns empty when significant set is empty', () => {
    expect(filterRowsBySignificance(rows, new Set())).toEqual([]);
  });
});

// ── classifyStrikeVsEm ───────────────────────────────────────────────

describe('classifyStrikeVsEm', () => {
  const em: ExpectedMove = { expiry: '2026-05-01', dte: 4, value: 4_000, source: 'straddle' };

  it('classifies inside-1sigma when |strike - spot| <= EM', () => {
    expect(classifyStrikeVsEm(82_000, 80_000, em)).toBe('inside-1sigma');
    expect(classifyStrikeVsEm(80_000, 80_000, em)).toBe('inside-1sigma');
  });

  it('classifies inside-2sigma when between 1·EM and 2·EM', () => {
    expect(classifyStrikeVsEm(86_000, 80_000, em)).toBe('inside-2sigma');
    expect(classifyStrikeVsEm(74_000, 80_000, em)).toBe('inside-2sigma');
  });

  it('classifies outside when beyond 2·EM', () => {
    expect(classifyStrikeVsEm(90_000, 80_000, em)).toBe('outside');
    expect(classifyStrikeVsEm(70_000, 80_000, em)).toBe('outside');
  });
});
