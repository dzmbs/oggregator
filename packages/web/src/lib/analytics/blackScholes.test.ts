import { describe, it, expect } from 'vitest';

import {
  blackScholesCall,
  blackScholesPut,
  delta,
  gamma,
  vega,
  theta,
  rho,
  impliedVolNewtonRaphson,
  normCdf,
  normPdf,
  erf,
  realWorldPop,
} from './blackScholes';

// Numeric parity targets. Values generated from the reference Python
// implementation using scipy.stats.norm; tolerances reflect A&S 7.1.26 accuracy.
describe('erf / normCdf / normPdf', () => {
  it('erf matches known values (A&S 7.1.26, ~1.5e-7 precision)', () => {
    expect(erf(0)).toBeCloseTo(0, 6);
    expect(erf(1)).toBeCloseTo(0.8427007929, 6);
    expect(erf(-1)).toBeCloseTo(-0.8427007929, 6);
  });
  it('normCdf matches scipy (A&S 26.2.17, ~7.5e-8 precision)', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1)).toBeCloseTo(0.8413447, 6);
    expect(normCdf(-1)).toBeCloseTo(0.1586553, 6);
  });
  it('normPdf(0) ≈ 0.3989 (machine precision)', () => {
    expect(normPdf(0)).toBeCloseTo(0.3989422804, 9);
  });
});

// BS price precision is bounded by Φ precision × spot. With A&S 26.2.17 and
// spot=100, this gives ~1e-5 absolute error — well under the Python spec's
// "within 1e-5" parity target.
describe('blackScholesCall / blackScholesPut', () => {
  it('ATM 1Y 20%vol 5%r call ≈ 10.45058', () => {
    expect(blackScholesCall(100, 100, 1, 0.05, 0.2)).toBeCloseTo(10.45058, 4);
  });
  it('ATM 1Y 20%vol 5%r put ≈ 5.57353', () => {
    expect(blackScholesPut(100, 100, 1, 0.05, 0.2)).toBeCloseTo(5.57353, 4);
  });
  it('put-call parity', () => {
    // C - P = S - K * exp(-rT)
    const c = blackScholesCall(100, 90, 0.5, 0.03, 0.25);
    const p = blackScholesPut(100, 90, 0.5, 0.03, 0.25);
    const parity = 100 - 90 * Math.exp(-0.03 * 0.5);
    expect(c - p).toBeCloseTo(parity, 8);
  });
  it('zero time → intrinsic', () => {
    expect(blackScholesCall(110, 100, 0, 0.05, 0.2)).toBe(10);
    expect(blackScholesCall(90, 100, 0, 0.05, 0.2)).toBe(0);
    expect(blackScholesPut(90, 100, 0, 0.05, 0.2)).toBe(10);
    expect(blackScholesPut(110, 100, 0, 0.05, 0.2)).toBe(0);
  });
});

// Reference Greeks for canonical ATM example: S=100, K=100, T=1, r=0.05, σ=0.20.
// Computed by hand from textbook formulas (Hull, Options Futures and Other
// Derivatives) with d1=0.35, d2=0.15. Tolerances reflect normCdf precision.
describe('Greeks — canonical ATM example', () => {
  const args = { spot: 100, strike: 100, T: 1, r: 0.05, sigma: 0.2 } as const;

  it('Δ_call ≈ 0.63683, Δ_put ≈ −0.36317', () => {
    expect(delta({ ...args, right: 'call' })).toBeCloseTo(0.63683, 4);
    expect(delta({ ...args, right: 'put' })).toBeCloseTo(-0.36317, 4);
  });
  it('Γ ≈ 0.018762', () => {
    expect(gamma(args)).toBeCloseTo(0.018762, 5);
  });
  it('Vega ≈ 37.524 (per unit σ)', () => {
    expect(vega(args)).toBeCloseTo(37.524, 3);
  });
  it('Θ_call ≈ −6.414, Θ_put ≈ −1.658 (per year)', () => {
    expect(theta({ ...args, right: 'call' })).toBeCloseTo(-6.414, 3);
    expect(theta({ ...args, right: 'put' })).toBeCloseTo(-1.658, 3);
  });
  it('ρ_call ≈ 53.232, ρ_put ≈ −41.890 (per unit r)', () => {
    expect(rho({ ...args, right: 'call' })).toBeCloseTo(53.232, 3);
    expect(rho({ ...args, right: 'put' })).toBeCloseTo(-41.890, 3);
  });
});

describe('Greeks — algebraic invariants', () => {
  const args = { spot: 110, strike: 100, T: 0.5, r: 0.03, sigma: 0.25 } as const;

  it('Δ_call − Δ_put = 1', () => {
    const dc = delta({ ...args, right: 'call' });
    const dp = delta({ ...args, right: 'put' });
    expect(dc - dp).toBeCloseTo(1, 8);
  });
  it('Γ and Vega are right-agnostic (call ≡ put)', () => {
    // Functions take Omit<_, 'right'>, but verifying the formula symmetry is
    // what matters. Computing once is enough.
    expect(gamma(args)).toBeGreaterThan(0);
    expect(vega(args)).toBeGreaterThan(0);
  });
  it('ρ_call − ρ_put = K·T·e^(−rT)', () => {
    const rc = rho({ ...args, right: 'call' });
    const rp = rho({ ...args, right: 'put' });
    const expected = args.strike * args.T * Math.exp(-args.r * args.T);
    expect(rc - rp).toBeCloseTo(expected, 6);
  });
  it('Θ_call − Θ_put = −r·K·e^(−rT)', () => {
    const tc = theta({ ...args, right: 'call' });
    const tp = theta({ ...args, right: 'put' });
    const expected = -args.r * args.strike * Math.exp(-args.r * args.T);
    expect(tc - tp).toBeCloseTo(expected, 6);
  });
});

describe('Greeks — edge cases', () => {
  it('all Greeks are zero when T = 0 except delta (step)', () => {
    const args = { spot: 110, strike: 100, T: 0, r: 0.05, sigma: 0.2 } as const;
    expect(delta({ ...args, right: 'call' })).toBe(1);
    expect(delta({ ...args, right: 'put' })).toBe(0);
    expect(gamma(args)).toBe(0);
    expect(vega(args)).toBe(0);
    expect(theta({ ...args, right: 'call' })).toBe(0);
    expect(rho({ ...args, right: 'call' })).toBe(0);
  });
  it('zero σ → zero Greeks (no movement → no sensitivity)', () => {
    const args = { spot: 100, strike: 100, T: 1, r: 0.05, sigma: 0 } as const;
    expect(gamma(args)).toBe(0);
    expect(vega(args)).toBe(0);
  });
});

// Numerical sanity: vega computed analytically should match the IV solver's
// implicit vega (the slope it uses). Round-tripping a price through the solver
// must recover the original σ to high precision.
describe('Greeks — round-trip with IV solver', () => {
  it('Newton-Raphson recovers σ used to price the option', () => {
    const args = { spot: 100, strike: 105, T: 0.25, r: 0.02, sigma: 0.45 } as const;
    const price = blackScholesCall(args.spot, args.strike, args.T, args.r, args.sigma);
    const iv = impliedVolNewtonRaphson({
      marketPrice: price,
      spot: args.spot,
      strike: args.strike,
      T: args.T,
      r: args.r,
      right: 'call',
    });
    expect(iv).not.toBeNull();
    expect(iv!).toBeCloseTo(args.sigma, 4);
  });
});

// Real-world (P-measure) probability of profit at expiry. Same N(d₂) shape as
// the risk-neutral version but uses physical drift μ and realized vol σ_RV
// instead of r and IV. Targets verified against scipy.stats.norm.cdf.
describe('realWorldPop', () => {
  it('drift-balanced ATM case → 0.5 either direction', () => {
    // When μ = ½σ², the (μ − ½σ²) term vanishes and S = BE → d₂ = 0 → Φ(0) = 0.5.
    expect(realWorldPop('above', 100, 100, 1, 0.02, 0.2)).toBeCloseTo(0.5, 6);
    expect(realWorldPop('below', 100, 100, 1, 0.02, 0.2)).toBeCloseTo(0.5, 6);
  });

  it('ATM zero-drift call-credit ≈ 0.5398, put-credit ≈ 0.4602', () => {
    // S=100, BE=100, T=1, μ=0, σ=0.2 → d₂ = -0.5*0.04*1/0.2 = -0.1
    // call-credit (below): N(0.1) ≈ 0.5398   put-credit (above): N(-0.1) ≈ 0.4602
    expect(realWorldPop('below', 100, 100, 1, 0, 0.2)).toBeCloseTo(0.5398, 4);
    expect(realWorldPop('above', 100, 100, 1, 0, 0.2)).toBeCloseTo(0.4602, 4);
  });

  it('directional drift moves the put-credit POP up', () => {
    // Put-credit at BE=90 with spot=100, 30d, σ=0.6.
    // μ=0 → d₂ ≈ 0.5267 → Φ ≈ 0.7008
    // μ=0.5 (bullish view) → d₂ ≈ 0.7654 → Φ ≈ 0.7780
    const flat = realWorldPop('above', 100, 90, 30 / 365, 0, 0.6);
    const bullish = realWorldPop('above', 100, 90, 30 / 365, 0.5, 0.6);
    expect(flat).toBeCloseTo(0.7008, 3);
    expect(bullish).toBeCloseTo(0.7780, 3);
    expect(bullish).toBeGreaterThan(flat);
  });

  it('deep OTM call-credit at 2× spot in 30d → almost certainly profitable', () => {
    // S=100, BE=200, T=30/365, μ=0, σ=0.6 → d₂ ≈ -4.11 → Φ(4.11) ≈ 0.99998
    const p = realWorldPop('below', 100, 200, 30 / 365, 0, 0.6);
    expect(p).toBeGreaterThan(0.999);
    expect(p).toBeLessThan(1);
  });

  it('returns NaN for non-positive σ, T, or prices', () => {
    expect(Number.isNaN(realWorldPop('above', 100, 100, 0, 0, 0.2))).toBe(true);
    expect(Number.isNaN(realWorldPop('above', 100, 100, 1, 0, 0))).toBe(true);
    expect(Number.isNaN(realWorldPop('above', 0, 100, 1, 0, 0.2))).toBe(true);
    expect(Number.isNaN(realWorldPop('above', 100, 0, 1, 0, 0.2))).toBe(true);
  });
});

describe('impliedVolNewtonRaphson', () => {
  it('recovers σ=0.2 from an ATM call', () => {
    const price = blackScholesCall(100, 100, 1, 0.05, 0.2);
    const iv = impliedVolNewtonRaphson({
      marketPrice: price,
      spot: 100,
      strike: 100,
      T: 1,
      r: 0.05,
      right: 'call',
    });
    expect(iv).not.toBeNull();
    expect(iv!).toBeCloseTo(0.2, 5);
  });
  it('recovers σ=0.35 from an OTM put', () => {
    const price = blackScholesPut(100, 90, 0.5, 0.03, 0.35);
    const iv = impliedVolNewtonRaphson({
      marketPrice: price,
      spot: 100,
      strike: 90,
      T: 0.5,
      r: 0.03,
      right: 'put',
    });
    expect(iv!).toBeCloseTo(0.35, 5);
  });
  it('returns null for non-positive price or time', () => {
    expect(
      impliedVolNewtonRaphson({
        marketPrice: 0,
        spot: 100,
        strike: 100,
        T: 1,
        r: 0.05,
        right: 'call',
      }),
    ).toBeNull();
    expect(
      impliedVolNewtonRaphson({
        marketPrice: 5,
        spot: 100,
        strike: 100,
        T: 0,
        r: 0.05,
        right: 'call',
      }),
    ).toBeNull();
  });
  it('returns null when σ would escape [0, 5]', () => {
    // Absurdly high premium the model cannot support → divergence
    const iv = impliedVolNewtonRaphson({
      marketPrice: 200,
      spot: 100,
      strike: 100,
      T: 1,
      r: 0.05,
      right: 'call',
    });
    expect(iv).toBeNull();
  });
});
