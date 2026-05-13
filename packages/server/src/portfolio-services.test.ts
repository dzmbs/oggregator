import { describe, expect, it } from 'vitest';

import { price76, type EnrichedChainResponse, type PositionLeg } from '@oggregator/core';

import { buildSviFitPoints, getSmileFit, sviMark } from './portfolio-services.js';

function makeSnapshot(
  underlying: string,
  expiry: string,
  forward: number,
  smileIvs: Array<{ strike: number; iv: number }>,
): EnrichedChainResponse {
  return {
    underlying,
    expiry,
    expiryTs: null,
    dte: 30,
    stats: {
      forwardPriceUsd: forward,
      indexPriceUsd: forward,
      basisPct: 0,
      atmStrike: forward,
      atmIv: smileIvs.find((row) => Math.abs(row.strike - forward) < 1)?.iv ?? null,
      putCallOiRatio: null,
      totalOiUsd: null,
      skew25d: null,
      bfly25d: null,
    },
    strikes: smileIvs.map(({ strike, iv }) => ({
      strike,
      call: { venues: {}, bestIv: strike >= forward ? iv : null, bestVenue: null },
      put: { venues: {}, bestIv: strike < forward ? iv : null, bestVenue: null },
    })),
    gex: [],
  };
}

function makeLeg(strike: number, optionRight: 'call' | 'put'): PositionLeg {
  return {
    legId: `test|ETH|2026-06-26|${strike}|${optionRight}`,
    underlying: 'ETH',
    expiry: '2026-06-26',
    strike,
    optionRight,
    size: 1,
    entryPriceUsd: 50,
    entryIv: null,
    entryTs: Date.now(),
    venueHint: 'thalex',
    source: 'thalex',
  };
}

describe('portfolio-services SVI fallback', () => {
  // Synthetic V-smile centred at the forward. Five OTM points, well within
  // the fitSvi minimum and butterfly-arb-safe.
  const FORWARD = 2200;
  const T = 0.1;
  const smile = [
    { strike: 2000, iv: 0.62 },
    { strike: 2100, iv: 0.56 },
    { strike: 2200, iv: 0.5 },
    { strike: 2300, iv: 0.55 },
    { strike: 2400, iv: 0.6 },
  ];

  it('builds OTM-side fit points from the snapshot', () => {
    const snap = makeSnapshot('ETH', '2026-06-26', FORWARD, smile);
    const pts = buildSviFitPoints(snap, FORWARD);
    expect(pts).toHaveLength(5);
    for (const pt of pts) {
      expect(Number.isFinite(pt.k)).toBe(true);
      expect(pt.iv).toBeGreaterThan(0);
    }
  });

  it('caches the SVI fit per snapshot reference', () => {
    const snap = makeSnapshot('ETH', '2026-06-26', FORWARD, smile);
    const first = getSmileFit('ETH', '2026-06-26', snap, FORWARD, T);
    const second = getSmileFit('ETH', '2026-06-26', snap, FORWARD, T);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it('produces a synthetic mark with ivFromSvi=true for a half-strike not in the chain', () => {
    const snap = makeSnapshot('ETH', '2026-06-26', FORWARD, smile);
    const fit = getSmileFit('ETH', '2026-06-26', snap, FORWARD, T);
    expect(fit).not.toBeNull();

    const leg = makeLeg(2250, 'put');
    const mark = sviMark(leg, FORWARD, FORWARD, T, fit!);
    expect(mark).not.toBeNull();
    expect(mark!.ivFromSvi).toBe(true);
    expect(mark!.iv).toBeGreaterThan(0);
    expect(mark!.iv).toBeLessThan(2);
    expect(mark!.markPriceUsd).toBeGreaterThan(0);
    expect(Number.isFinite(mark!.delta)).toBe(true);
    expect(Number.isFinite(mark!.gamma)).toBe(true);
    expect(Number.isFinite(mark!.vega)).toBe(true);
    expect(Number.isFinite(mark!.theta)).toBe(true);
    expect(mark!.yearsToExpiry).toBe(T);

    const reprice = price76(FORWARD, 2250, mark!.iv!, T, 'put');
    expect(Math.abs(reprice - mark!.markPriceUsd!)).toBeLessThan(1e-6);
  });

  it('emits vega in per-1%-σ convention to match venue feeds', () => {
    // vega76 is per-σ=1.0; venues publish per-σ=0.01 (per vol-point). SVI mark
    // must match the venue convention so per-expiry sums don't flip 100× when
    // a leg falls through to the smile fallback.
    const snap = makeSnapshot('ETH', '2026-06-26', FORWARD, smile);
    const fit = getSmileFit('ETH', '2026-06-26', snap, FORWARD, T);
    const leg = makeLeg(2200, 'call');
    const mark = sviMark(leg, FORWARD, FORWARD, T, fit!);
    // ATM ETH F=2200, T≈0.0822 → per-σ vega76 ≈ 2200·√T·pdf(0) ≈ 252.
    // Per-1% scale should be ~2.5 — vega should NEVER be in the 100s here.
    expect(mark!.vega!).toBeLessThan(10);
    expect(mark!.vega!).toBeGreaterThan(0);
  });

  it('returns null when not enough liquid strikes for an SVI fit', () => {
    const sparse = [
      { strike: 2200, iv: 0.5 },
      { strike: 2300, iv: 0.55 },
    ];
    const snap = makeSnapshot('ETH', '2026-06-26', FORWARD, sparse);
    const fit = getSmileFit('ETH', '2026-06-26', snap, FORWARD, T);
    expect(fit).toBeNull();
  });
});
