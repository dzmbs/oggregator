export type OptionRight = 'call' | 'put';

// A&S 7.1.26 — max error ~1.5e-7 over the real line.
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

// A&S 26.2.17 (Zelen & Severo) — max absolute error ~7.5e-8. Industry-standard
// for option pricing. Computes Φ(x) directly to avoid erf's accumulated error.
export function normCdf(x: number): number {
  if (x < 0) return 1 - normCdf(-x);
  const k = 1 / (1 + 0.2316419 * x);
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const poly = k * (b1 + k * (b2 + k * (b3 + k * (b4 + k * b5))));
  return 1 - normPdf(x) * poly;
}

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function d1(spot: number, strike: number, T: number, r: number, sigma: number): number {
  return (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
}

export function blackScholesCall(
  spot: number,
  strike: number,
  T: number,
  r: number,
  sigma: number,
): number {
  if (T <= 0) return Math.max(spot - strike, 0);
  const d1v = d1(spot, strike, T, r, sigma);
  const d2 = d1v - sigma * Math.sqrt(T);
  return spot * normCdf(d1v) - strike * Math.exp(-r * T) * normCdf(d2);
}

export function blackScholesPut(
  spot: number,
  strike: number,
  T: number,
  r: number,
  sigma: number,
): number {
  if (T <= 0) return Math.max(strike - spot, 0);
  const d1v = d1(spot, strike, T, r, sigma);
  const d2 = d1v - sigma * Math.sqrt(T);
  return strike * Math.exp(-r * T) * normCdf(-d2) - spot * normCdf(-d1v);
}

// Closed-form Black-Scholes Greeks. Raw units: vega per unit σ, theta per year,
// rho per unit r. Convert to per-1% / per-day at the display layer.
export interface GreeksArgs {
  spot: number;
  strike: number;
  T: number;
  r: number;
  sigma: number;
  right: OptionRight;
}

export function delta(args: GreeksArgs): number {
  const { spot, strike, T, r, sigma, right } = args;
  if (T <= 0) {
    if (right === 'call') return spot > strike ? 1 : spot < strike ? 0 : 0.5;
    return spot < strike ? -1 : spot > strike ? 0 : -0.5;
  }
  if (sigma <= 0 || spot <= 0) return 0;
  const n = normCdf(d1(spot, strike, T, r, sigma));
  return right === 'call' ? n : n - 1;
}

export function gamma(args: Omit<GreeksArgs, 'right'>): number {
  const { spot, strike, T, r, sigma } = args;
  if (T <= 0 || sigma <= 0 || spot <= 0) return 0;
  return normPdf(d1(spot, strike, T, r, sigma)) / (spot * sigma * Math.sqrt(T));
}

export function vega(args: Omit<GreeksArgs, 'right'>): number {
  const { spot, strike, T, r, sigma } = args;
  if (T <= 0 || sigma <= 0 || spot <= 0) return 0;
  return spot * normPdf(d1(spot, strike, T, r, sigma)) * Math.sqrt(T);
}

export function theta(args: GreeksArgs): number {
  const { spot, strike, T, r, sigma, right } = args;
  if (T <= 0 || sigma <= 0 || spot <= 0) return 0;
  const d1v = d1(spot, strike, T, r, sigma);
  const d2 = d1v - sigma * Math.sqrt(T);
  const term1 = (-spot * normPdf(d1v) * sigma) / (2 * Math.sqrt(T));
  const discount = r * strike * Math.exp(-r * T);
  return right === 'call' ? term1 - discount * normCdf(d2) : term1 + discount * normCdf(-d2);
}

export function rho(args: GreeksArgs): number {
  const { spot, strike, T, r, sigma, right } = args;
  if (T <= 0 || sigma <= 0 || spot <= 0) return 0;
  const d2 = d1(spot, strike, T, r, sigma) - sigma * Math.sqrt(T);
  const base = strike * T * Math.exp(-r * T);
  return right === 'call' ? base * normCdf(d2) : -base * normCdf(-d2);
}

export type ProfitDirection = 'above' | 'below';

// Real-world (P-measure) probability that the underlying lands in the profit
// zone of a vertical credit spread at expiry. Same N(d₂) shape as risk-neutral
// pricing but uses physical drift μ and realized vol σ_RV instead of r and IV.
//
// direction = 'above' when profit requires S_T > breakeven (put credit spread)
// direction = 'below' when profit requires S_T < breakeven (call credit spread)
//
// Returns NaN for non-positive σ, T, spot, or breakeven so the caller can
// detect missing inputs and fall back to a different probability source.
export function realWorldPop(
  direction: ProfitDirection,
  spot: number,
  breakeven: number,
  T: number,
  mu: number,
  sigmaRV: number,
): number {
  if (T <= 0 || sigmaRV <= 0 || spot <= 0 || breakeven <= 0) return NaN;
  const d2 = (Math.log(spot / breakeven) + (mu - 0.5 * sigmaRV * sigmaRV) * T) / (sigmaRV * Math.sqrt(T));
  return direction === 'above' ? normCdf(d2) : normCdf(-d2);
}

export interface ImpliedVolArgs {
  marketPrice: number;
  spot: number;
  strike: number;
  T: number;
  r: number;
  right: OptionRight;
  initialGuess?: number;
  maxIter?: number;
  tol?: number;
}

// Newton-Raphson. Returns null on divergence (vega too small, σ escapes [0, 5], or
// max iterations exhausted) — mirrors the Python `Optional[float]` semantics the
// surface builder depends on.
export function impliedVolNewtonRaphson(args: ImpliedVolArgs): number | null {
  const {
    marketPrice,
    spot,
    strike,
    T,
    r,
    right,
    initialGuess = 0.5,
    maxIter = 100,
    tol = 1e-6,
  } = args;

  if (T <= 0 || marketPrice <= 0) return null;

  let sigma = initialGuess;
  for (let i = 0; i < maxIter; i++) {
    const price =
      right === 'call'
        ? blackScholesCall(spot, strike, T, r, sigma)
        : blackScholesPut(spot, strike, T, r, sigma);
    const d1v = d1(spot, strike, T, r, sigma);
    const vega = spot * normPdf(d1v) * Math.sqrt(T);
    if (vega < 1e-10) return null;
    const diff = price - marketPrice;
    if (Math.abs(diff) < tol) return sigma;
    sigma = sigma - diff / vega;
    if (sigma <= 0 || sigma > 5) return null;
  }
  return null;
}
