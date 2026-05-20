import { describe, expect, it } from 'vitest';

import { price76, vega76 } from '../feeds/thalex/bs-solver.js';
import { vanna76, volga76 } from './greeks-extra.js';

const F = 100;
const K = 100;
const SIGMA = 0.5;
const T = 0.5;

function fdVanna(forward: number, strike: number, sigma: number, t: number): number {
  const h = forward * 1e-4;
  return (
    (vega76(forward + h, strike, sigma, t) - vega76(forward - h, strike, sigma, t)) / (2 * h)
  );
}

function fdVolga(forward: number, strike: number, sigma: number, t: number): number {
  const h = 1e-5;
  return (
    (vega76(forward, strike, sigma + h, t) - vega76(forward, strike, sigma - h, t)) / (2 * h)
  );
}

describe('vanna76', () => {
  it('matches finite difference of vega in forward', () => {
    const analytic = vanna76(F, K, SIGMA, T);
    const numeric = fdVanna(F, K, SIGMA, T);
    expect(analytic).not.toBeNull();
    expect(Math.abs((analytic as number) - numeric)).toBeLessThan(1e-5);
  });

  it('matches FD at OTM strike', () => {
    const otmK = 120;
    const analytic = vanna76(F, otmK, SIGMA, T);
    const numeric = fdVanna(F, otmK, SIGMA, T);
    expect(Math.abs((analytic as number) - numeric)).toBeLessThan(1e-5);
  });

  it('matches FD at ITM strike', () => {
    const itmK = 80;
    const analytic = vanna76(F, itmK, SIGMA, T);
    const numeric = fdVanna(F, itmK, SIGMA, T);
    expect(Math.abs((analytic as number) - numeric)).toBeLessThan(1e-5);
  });

  it('returns null on invalid inputs', () => {
    expect(vanna76(null, K, SIGMA, T)).toBeNull();
    expect(vanna76(F, K, null, T)).toBeNull();
    expect(vanna76(F, K, SIGMA, null)).toBeNull();
    expect(vanna76(-1, K, SIGMA, T)).toBeNull();
    expect(vanna76(F, K, 0, T)).toBeNull();
  });

  it('returns finite at ATM', () => {
    const v = vanna76(F, K, SIGMA, T) as number;
    expect(Number.isFinite(v)).toBe(true);
  });
});

describe('volga76', () => {
  it('matches finite difference of vega in sigma at ATM-forward', () => {
    const analytic = volga76(F, K, SIGMA, T);
    const numeric = fdVolga(F, K, SIGMA, T);
    expect(analytic).not.toBeNull();
    expect(Math.abs((analytic as number) - numeric)).toBeLessThan(1e-4);
  });

  it('matches FD at OTM strike', () => {
    const otmK = 130;
    const analytic = volga76(F, otmK, SIGMA, T);
    const numeric = fdVolga(F, otmK, SIGMA, T);
    expect(Math.abs((analytic as number) - numeric)).toBeLessThan(1e-3);
  });

  it('matches FD via second-derivative of price in sigma', () => {
    const otmK = 110;
    const h = 1e-4;
    const second =
      (price76(F, otmK, SIGMA + h, T, 'call')
        - 2 * price76(F, otmK, SIGMA, T, 'call')
        + price76(F, otmK, SIGMA - h, T, 'call')) / (h * h);
    const analytic = volga76(F, otmK, SIGMA, T) as number;
    expect(Math.abs(analytic - second)).toBeLessThan(1e-2);
  });

  it('returns null on invalid inputs', () => {
    expect(volga76(null, K, SIGMA, T)).toBeNull();
    expect(volga76(F, K, null, T)).toBeNull();
    expect(volga76(F, K, SIGMA, null)).toBeNull();
    expect(volga76(F, -1, SIGMA, T)).toBeNull();
  });
});
