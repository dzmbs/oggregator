import type { OptionRight } from '../../types/common.js';

// Black-76 (forward-based, r=0) pricing + IV inversion.
// Thalex's WS ticker only publishes `markIv`; `bidIv`, `askIv`, and `theta`
// are never present. The ticker does carry `forward` and we have strike +
// expirationTimestamp on the cached instrument, so we can solve IV from bid
// and ask premiums and derive theta analytically. r=0 is the crypto-native
// convention (no collateralised rate basket).

const SQRT_2PI = Math.sqrt(2 * Math.PI);

export function pdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

// Abramowitz & Stegun 7.1.26 — error < 1.5e-7, enough for IV Newton steps.
export function cdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export function d1(forward: number, strike: number, sigma: number, tYears: number): number {
  const sqrtT = Math.sqrt(tYears);
  return (Math.log(forward / strike) + 0.5 * sigma * sigma * tYears) / (sigma * sqrtT);
}

export function price76(
  forward: number,
  strike: number,
  sigma: number,
  tYears: number,
  right: OptionRight,
): number {
  const _d1 = d1(forward, strike, sigma, tYears);
  const _d2 = _d1 - sigma * Math.sqrt(tYears);
  return right === 'call'
    ? forward * cdf(_d1) - strike * cdf(_d2)
    : strike * cdf(-_d2) - forward * cdf(-_d1);
}

export function vega76(forward: number, strike: number, sigma: number, tYears: number): number {
  return forward * Math.sqrt(tYears) * pdf(d1(forward, strike, sigma, tYears));
}

export function delta76(
  forward: number,
  strike: number,
  sigma: number,
  tYears: number,
  right: OptionRight,
): number {
  const _d1 = d1(forward, strike, sigma, tYears);
  return right === 'call' ? cdf(_d1) : cdf(_d1) - 1;
}

export function gamma76(forward: number, strike: number, sigma: number, tYears: number): number {
  return pdf(d1(forward, strike, sigma, tYears)) / (forward * sigma * Math.sqrt(tYears));
}

export interface IvInputs {
  price: number | null;
  forward: number | null;
  strike: number;
  tYears: number | null;
  right: OptionRight;
  seed: number | null;
}

export function solveIv({ price, forward, strike, tYears, right, seed }: IvInputs): number | null {
  if (price == null || forward == null || tYears == null) return null;
  if (!(price > 0 && forward > 0 && strike > 0 && tYears > 0)) return null;

  const intrinsic =
    right === 'call' ? Math.max(0, forward - strike) : Math.max(0, strike - forward);
  const upper = right === 'call' ? forward : strike;
  // Discounting is zero, so no arbitrage bounds are (intrinsic, upper).
  if (price <= intrinsic || price >= upper) return null;

  let sigma = seed != null && Number.isFinite(seed) && seed > 0.01 && seed < 5 ? seed : 0.5;
  for (let i = 0; i < 32; i++) {
    const diff = price76(forward, strike, sigma, tYears, right) - price;
    if (Math.abs(diff) < 1e-6) return sigma;
    const v = vega76(forward, strike, sigma, tYears);
    if (!(v > 1e-10)) return null;
    sigma -= diff / v;
    if (!Number.isFinite(sigma) || sigma <= 0 || sigma > 10) return null;
  }
  return null;
}

// Black-76 theta per calendar day (r=0). Returns USD/day to match Deribit's
// convention so the UI's fmtUsd(theta) displays like-for-like across venues.
export function thetaPerDay(
  forward: number | null,
  strike: number,
  sigma: number | null,
  tYears: number | null,
): number | null {
  if (forward == null || sigma == null || tYears == null) return null;
  if (!(forward > 0 && strike > 0 && sigma > 0 && tYears > 0)) return null;
  const annual = -(forward * pdf(d1(forward, strike, sigma, tYears)) * sigma) / (2 * Math.sqrt(tYears));
  return annual / 365;
}

export function yearsToExpiry(expirationTimestampMs: number | null | undefined, nowMs: number): number | null {
  if (expirationTimestampMs == null) return null;
  const secs = (expirationTimestampMs - nowMs) / 1000;
  if (!(secs > 0)) return null;
  return secs / (365 * 24 * 60 * 60);
}
