import { describe, expect, it } from 'vitest';

import {
  price76,
  type EnrichedChainResponse,
  type PositionLeg,
  type SviParams,
} from '@oggregator/core';

import { blendSvi, buildSviFitPoints, getSmileFit, sviMark } from './portfolio-services.js';

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

  it('trims a single absurd IV from the calibration grid before fitting', () => {
    // One venue publishes a wildly broken IV at a single strike — the fit
    // points should drop it via the median+MAD filter so the SVI fit isn't
    // distorted across the whole expiry.
    const polluted = [
      { strike: 2000, iv: 0.62 },
      { strike: 2100, iv: 0.58 },
      { strike: 2200, iv: 0.55 },
      { strike: 2300, iv: 0.56 },
      { strike: 2400, iv: 4.5 },
      { strike: 2500, iv: 0.65 },
    ];
    const snap = makeSnapshot('ETH', '2026-06-26', FORWARD, polluted);
    const points = buildSviFitPoints(snap, FORWARD);
    expect(points.find((p) => Math.abs(p.iv - 4.5) < 0.01)).toBeUndefined();
    expect(points.length).toBe(5);
  });

  it('blendSvi linearly EMAs each parameter and short-circuits at the ends', () => {
    const prev: SviParams = { a: 0.1, b: 0.5, rho: -0.2, m: 0.0, sigma: 0.1 };
    const next: SviParams = { a: 0.2, b: 0.6, rho: 0.0, m: 0.1, sigma: 0.2 };
    const out = blendSvi(prev, next)!;
    // alpha = 0.3 → out = prev + 0.3 * (next - prev)
    expect(out.a).toBeCloseTo(0.1 + 0.3 * (0.2 - 0.1), 10);
    expect(out.b).toBeCloseTo(0.5 + 0.3 * (0.6 - 0.5), 10);
    expect(out.rho).toBeCloseTo(-0.2 + 0.3 * (0.0 - -0.2), 10);
    expect(out.m).toBeCloseTo(0.0 + 0.3 * (0.1 - 0.0), 10);
    expect(out.sigma).toBeCloseTo(0.1 + 0.3 * (0.2 - 0.1), 10);
    expect(blendSvi(null, next)).toBe(next);
    expect(blendSvi(prev, null)).toBeNull();
  });

  it('returns null when SVI extrapolates beyond the SVI_IV_MAX band', () => {
    // Force a degenerate fit by handing it a calibration grid that prices a
    // far-extreme strike at an unrealistic IV. The sticky cache should take
    // over instead of broadcasting a 300%+ model IV.
    // SVI w(k) = a + b·(rho·(k−m) + √((k−m)² + sigma²)). At k=0 → w=0.201,
    // iv=√(w/T)≈1.42 (passes the 2.0 gate). At k=log(3500/2200)≈0.464 the
    // linear-wing term dominates → w≈1.87, iv≈4.3 (fails the gate).
    const blowUp: SviParams = { a: 0.001, b: 2, rho: 0.99, m: 0, sigma: 0.1 };
    const leg = makeLeg(2200, 'call');
    // ATM strike should be fine on this fit (k ≈ 0).
    const ok = sviMark(leg, FORWARD, FORWARD, T, blowUp);
    expect(ok).not.toBeNull();
    // Far wing — fit explodes; gate kicks in.
    const farLeg = makeLeg(3500, 'call');
    const blown = sviMark(farLeg, FORWARD, FORWARD, T, blowUp);
    expect(blown).toBeNull();
  });
});
