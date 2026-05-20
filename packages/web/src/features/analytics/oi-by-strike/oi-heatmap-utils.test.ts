// packages/web/src/features/analytics/oi-by-strike/oi-heatmap-utils.test.ts
import { describe, it, expect } from 'vitest';
import type { EnrichedChainResponse } from '@shared/enriched';

import { aggregateHeatRows, computeOpacity, heatColor } from './oi-heatmap-utils';
import type { HeatRow } from './oi-heatmap-utils';

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
