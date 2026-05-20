// Annualized realized volatility from a close-to-close price series.
//
// Uses the zero-mean estimator σ_RV = √(mean(r²)) × √periodsPerYear, where
// r_i = ln(C_i / C_{i-1}). This matches CBOE/DVOL variance-swap methodology
// and is more robust than sample variance for short windows where the mean
// log-return is dominated by noise.
//
// Returns null on insufficient data or invalid inputs so callers can fall
// back to a different vol source (e.g. ATM IV) without surfacing NaN.

export function realizedVol(closes: readonly number[], periodsPerYear: number): number | null {
  if (closes.length < 2 || periodsPerYear <= 0) return null;

  let sumSq = 0;
  let n = 0;
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev == null || curr == null) return null;
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) return null;
    if (prev <= 0 || curr <= 0) return null;
    const r = Math.log(curr / prev);
    sumSq += r * r;
    n += 1;
  }

  if (n === 0) return null;
  return Math.sqrt(sumSq / n) * Math.sqrt(periodsPerYear);
}
