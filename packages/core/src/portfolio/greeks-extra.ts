import { d1, pdf, vega76 } from '../feeds/thalex/bs-solver.js';

export function vanna76(
  forward: number | null,
  strike: number,
  sigma: number | null,
  tYears: number | null,
): number | null {
  if (forward == null || sigma == null || tYears == null) return null;
  if (!(forward > 0 && strike > 0 && sigma > 0 && tYears > 0)) return null;
  const _d1 = d1(forward, strike, sigma, tYears);
  const _d2 = _d1 - sigma * Math.sqrt(tYears);
  return (-pdf(_d1) * _d2) / sigma;
}

export function volga76(
  forward: number | null,
  strike: number,
  sigma: number | null,
  tYears: number | null,
): number | null {
  if (forward == null || sigma == null || tYears == null) return null;
  if (!(forward > 0 && strike > 0 && sigma > 0 && tYears > 0)) return null;
  const _d1 = d1(forward, strike, sigma, tYears);
  const _d2 = _d1 - sigma * Math.sqrt(tYears);
  const v = vega76(forward, strike, sigma, tYears);
  return (v * _d1 * _d2) / sigma;
}

// Cash-scale variants — per-σ=0.01 (per 1 vol point), matching the venue
// convention used for vega in the rest of the system. Lets the dashboard
// Taylor-expand ΔPnL ≈ netVega·Δp + ½·netVolga·Δp²  and  Δ(netDelta) ≈
// netVanna·Δp  with Δp measured in vol points.
export function vannaPct76(
  forward: number | null,
  strike: number,
  sigma: number | null,
  tYears: number | null,
): number | null {
  const v = vanna76(forward, strike, sigma, tYears);
  return v == null ? null : v / 100;
}

export function volgaPct76(
  forward: number | null,
  strike: number,
  sigma: number | null,
  tYears: number | null,
): number | null {
  const v = volga76(forward, strike, sigma, tYears);
  return v == null ? null : v / 10_000;
}
