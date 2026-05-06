const LOG_2PI = Math.log(2 * Math.PI);

// 3-state Gaussian HMM with diagonal covariance per state.
//   pi[i]              prior probability of state i
//   A[i][j]            transition probability from i to j
//   mu[i][k]           emission mean of feature k in state i
//   sigma2[i][k]       emission variance of feature k in state i
export interface HmmModel {
  readonly nStates: number;
  readonly pi: readonly number[];
  readonly A: readonly (readonly number[])[];
  readonly mu: readonly (readonly number[])[];
  readonly sigma2: readonly (readonly number[])[];
}

export interface ForwardResult {
  readonly logLikelihood: number;
  readonly logAlpha: readonly (readonly number[])[];
}

// Diagonal multivariate Gaussian log-pdf.
//   log p(x | μ, diag(σ²)) = -0.5 · Σ_i [ log(2π·σ²_i) + (x_i − μ_i)² / σ²_i ]
// Diagonal Σ is the standard choice for HMM regime models — full Σ adds
// O(d²) parameters per state with marginal accuracy gain.
export function gaussianLogPdf(
  x: readonly number[],
  mean: readonly number[],
  variance: readonly number[],
): number {
  const d = x.length;
  if (mean.length !== d || variance.length !== d) {
    throw new Error(
      `gaussianLogPdf: dimension mismatch (x=${d}, mean=${mean.length}, variance=${variance.length})`,
    );
  }
  let acc = 0;
  for (let i = 0; i < d; i++) {
    const v = variance[i]!;
    if (!(v > 0) || !Number.isFinite(v)) {
      throw new Error(`gaussianLogPdf: variance[${i}]=${v} must be positive and finite`);
    }
    const diff = x[i]! - mean[i]!;
    acc += LOG_2PI + Math.log(v) + (diff * diff) / v;
  }
  return -0.5 * acc;
}

// Stable log Σ exp: subtract max before exp/sum to avoid under/overflow in float64.
export function logSumExp(xs: readonly number[]): number {
  if (xs.length === 0) return -Infinity;
  if (xs.length === 1) return xs[0]!;
  let max = -Infinity;
  for (const x of xs) if (x > max) max = x;
  if (!Number.isFinite(max)) return max;
  let sum = 0;
  for (const x of xs) sum += Math.exp(x - max);
  return max + Math.log(sum);
}

// Log-domain forward algorithm.
//   α₁(i)   = log π_i + log b_i(o₁)
//   α_t(j)  = logSumExp_i [ α_{t-1}(i) + log A_{i,j} ] + log b_j(o_t)
//   logP(O) = logSumExp_i α_T(i)
// Stays in log-space throughout to handle long sequences without underflow.
export function forward(model: HmmModel, obs: readonly (readonly number[])[]): ForwardResult {
  if (obs.length === 0) {
    throw new Error('forward: observations must be non-empty');
  }
  const N = model.nStates;
  const T = obs.length;
  const logA: number[][] = model.A.map((row) => row.map((p) => Math.log(p)));
  const logPi = model.pi.map((p) => Math.log(p));

  const logAlpha: number[][] = Array.from({ length: T }, () => new Array<number>(N).fill(0));

  for (let i = 0; i < N; i++) {
    logAlpha[0]![i] = logPi[i]! + gaussianLogPdf(obs[0]!, model.mu[i]!, model.sigma2[i]!);
  }

  const buf = new Array<number>(N);
  for (let t = 1; t < T; t++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        buf[i] = logAlpha[t - 1]![i]! + logA[i]![j]!;
      }
      const emit = gaussianLogPdf(obs[t]!, model.mu[j]!, model.sigma2[j]!);
      logAlpha[t]![j] = logSumExp(buf) + emit;
    }
  }

  return { logLikelihood: logSumExp(logAlpha[T - 1]!), logAlpha };
}
