const LOG_2PI = Math.log(2 * Math.PI);

// Gaussian HMM with diagonal covariance per state.
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

export interface BackwardResult {
  readonly logBeta: readonly (readonly number[])[];
}

export interface ViterbiResult {
  readonly path: readonly number[];
  readonly logProb: number;
}

export interface FitOptions {
  readonly nStates: number;
  readonly seed?: number;
  readonly maxIter?: number;
  readonly tol?: number;
  readonly varianceFloor?: number;
}

export interface FitResult {
  readonly model: {
    readonly nStates: number;
    readonly pi: number[];
    readonly A: number[][];
    readonly mu: number[][];
    readonly sigma2: number[][];
  };
  readonly logLikelihood: number;
  readonly history: number[];
  readonly iterations: number;
  readonly converged: boolean;
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

// Log-domain backward algorithm.
//   β_T(i) = 0
//   β_t(i) = logSumExp_j [ log A_{i,j} + log b_j(o_{t+1}) + β_{t+1}(j) ]
export function backward(model: HmmModel, obs: readonly (readonly number[])[]): BackwardResult {
  if (obs.length === 0) {
    throw new Error('backward: observations must be non-empty');
  }
  const N = model.nStates;
  const T = obs.length;
  const logA: number[][] = model.A.map((row) => row.map((p) => Math.log(p)));

  const logBeta: number[][] = Array.from({ length: T }, () => new Array<number>(N).fill(0));

  const buf = new Array<number>(N);
  for (let t = T - 2; t >= 0; t--) {
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const emit = gaussianLogPdf(obs[t + 1]!, model.mu[j]!, model.sigma2[j]!);
        buf[j] = logA[i]![j]! + emit + logBeta[t + 1]![j]!;
      }
      logBeta[t]![i] = logSumExp(buf);
    }
  }

  return { logBeta };
}

// Log-domain Viterbi: most-likely single state sequence.
//   δ₁(i) = log π_i + log b_i(o₁)
//   δ_t(j) = max_i [δ_{t-1}(i) + log A_{i,j}] + log b_j(o_t)
//   ψ_t(j) = argmax_i (...)
// Backtrack from argmax_i δ_T(i) using ψ.
export function viterbi(model: HmmModel, obs: readonly (readonly number[])[]): ViterbiResult {
  if (obs.length === 0) {
    throw new Error('viterbi: observations must be non-empty');
  }
  const N = model.nStates;
  const T = obs.length;
  const logA: number[][] = model.A.map((row) => row.map((p) => Math.log(p)));
  const logPi = model.pi.map((p) => Math.log(p));

  const delta: number[][] = Array.from({ length: T }, () => new Array<number>(N).fill(0));
  const psi: number[][] = Array.from({ length: T }, () => new Array<number>(N).fill(0));

  for (let i = 0; i < N; i++) {
    delta[0]![i] = logPi[i]! + gaussianLogPdf(obs[0]!, model.mu[i]!, model.sigma2[i]!);
  }

  for (let t = 1; t < T; t++) {
    for (let j = 0; j < N; j++) {
      let bestVal = -Infinity;
      let bestIdx = 0;
      for (let i = 0; i < N; i++) {
        const v = delta[t - 1]![i]! + logA[i]![j]!;
        if (v > bestVal) {
          bestVal = v;
          bestIdx = i;
        }
      }
      const emit = gaussianLogPdf(obs[t]!, model.mu[j]!, model.sigma2[j]!);
      delta[t]![j] = bestVal + emit;
      psi[t]![j] = bestIdx;
    }
  }

  let bestEnd = 0;
  let bestEndVal = -Infinity;
  for (let i = 0; i < N; i++) {
    if (delta[T - 1]![i]! > bestEndVal) {
      bestEndVal = delta[T - 1]![i]!;
      bestEnd = i;
    }
  }

  const path = new Array<number>(T);
  path[T - 1] = bestEnd;
  for (let t = T - 1; t > 0; t--) {
    path[t - 1] = psi[t]![path[t]!]!;
  }

  return { path, logProb: bestEndVal };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// k-means++ initialization in d dimensions. Returns N centroids picked from data.
// Used for emission-mean init: well-separated centers give EM a much better
// starting point than random or uniform splits, especially with 3+ states.
function kmeansPlusPlus(
  data: readonly (readonly number[])[],
  k: number,
  rng: () => number,
): number[][] {
  const T = data.length;
  const d = data[0]!.length;
  const centers: number[][] = [];
  const firstIdx = Math.floor(rng() * T);
  centers.push([...data[firstIdx]!]);

  const sqDist = (a: readonly number[], b: readonly number[]): number => {
    let s = 0;
    for (let i = 0; i < d; i++) {
      const v = a[i]! - b[i]!;
      s += v * v;
    }
    return s;
  };

  while (centers.length < k) {
    const dists = new Array<number>(T);
    let total = 0;
    for (let i = 0; i < T; i++) {
      let m = Infinity;
      for (const c of centers) {
        const v = sqDist(data[i]!, c);
        if (v < m) m = v;
      }
      dists[i] = m;
      total += m;
    }
    if (total === 0) {
      centers.push([...data[Math.floor(rng() * T)]!]);
      continue;
    }
    const r = rng() * total;
    let acc = 0;
    let pickedIdx = T - 1;
    for (let i = 0; i < T; i++) {
      acc += dists[i]!;
      if (acc >= r) {
        pickedIdx = i;
        break;
      }
    }
    centers.push([...data[pickedIdx]!]);
  }
  return centers;
}

// Baum-Welch EM fit for a Gaussian HMM with diagonal covariance.
// Initialization:
//   μ ← k-means++ centroids (well-separated starts, deterministic via seed)
//   σ² ← global per-feature sample variance (floored)
//   π ← uniform
//   A ← 0.9 on diagonal, (0.1 / (N-1)) elsewhere — sticky prior matches the
//       regime-detection use case (regimes persist).
// E-step computes γ and ξ in log-domain via forward-backward.
// M-step:
//   π_i  = γ_1(i)
//   A_ij = Σ_t ξ_t(i,j) / Σ_t γ_t(i)        (sums up to t=T-1)
//   μ_i  = Σ_t γ_t(i) o_t / Σ_t γ_t(i)
//   σ²_i = Σ_t γ_t(i) (o_t − μ_i)² / Σ_t γ_t(i)  (then floored)
// Convergence: log-likelihood delta < tol or maxIter reached.
export function fitGaussianHmm(
  data: readonly (readonly number[])[],
  opts: FitOptions,
): FitResult {
  const T = data.length;
  const N = opts.nStates;
  if (T < N) {
    throw new Error(`fitGaussianHmm: need at least nStates samples (T=${T}, N=${N})`);
  }
  const d = data[0]!.length;
  const maxIter = opts.maxIter ?? 100;
  const tol = opts.tol ?? 1e-6;
  const rng = mulberry32(opts.seed ?? 0);

  let globalMean = new Array<number>(d).fill(0);
  for (const x of data) for (let i = 0; i < d; i++) globalMean[i]! += x[i]!;
  for (let i = 0; i < d; i++) globalMean[i]! /= T;

  const globalVar = new Array<number>(d).fill(0);
  for (const x of data) {
    for (let i = 0; i < d; i++) {
      const v = x[i]! - globalMean[i]!;
      globalVar[i]! += v * v;
    }
  }
  for (let i = 0; i < d; i++) globalVar[i]! = Math.max(globalVar[i]! / T, 1e-12);

  const varianceFloor = opts.varianceFloor ?? Math.min(...globalVar) * 1e-3;

  const mu: number[][] = kmeansPlusPlus(data, N, rng);
  const sigma2: number[][] = Array.from({ length: N }, () => globalVar.map((v) => v));
  const pi: number[] = new Array<number>(N).fill(1 / N);
  const A: number[][] = Array.from({ length: N }, (_, i) => {
    const row = new Array<number>(N).fill(0.1 / Math.max(1, N - 1));
    row[i] = 0.9;
    if (N === 1) row[0] = 1;
    return row;
  });

  const history: number[] = [];
  let prevLL = -Infinity;
  let iter = 0;
  let converged = false;

  for (iter = 0; iter < maxIter; iter++) {
    const model: HmmModel = { nStates: N, pi, A, mu, sigma2 };
    const fwd = forward(model, data);
    const bwd = backward(model, data);
    const logLik = fwd.logLikelihood;
    history.push(logLik);

    if (iter > 0 && Math.abs(logLik - prevLL) < tol) {
      converged = true;
      break;
    }
    prevLL = logLik;

    // γ_t(i) = exp(logα_t(i) + logβ_t(i) − logP(O))
    const gamma: number[][] = Array.from({ length: T }, () => new Array<number>(N).fill(0));
    const merged = new Array<number>(N);
    for (let t = 0; t < T; t++) {
      for (let i = 0; i < N; i++) merged[i] = fwd.logAlpha[t]![i]! + bwd.logBeta[t]![i]!;
      const norm = logSumExp(merged);
      for (let i = 0; i < N; i++) gamma[t]![i] = Math.exp(merged[i]! - norm);
    }

    // ξ summed across t directly (we never need per-t ξ, only its sum).
    //   xiSum[i][j] = Σ_t exp(logα_t(i) + log A_ij + log b_j(o_{t+1}) + logβ_{t+1}(j) − logP(O))
    const xiSum: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0));
    const logA = A.map((row) => row.map((p) => Math.log(p)));
    for (let t = 0; t < T - 1; t++) {
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const emit = gaussianLogPdf(data[t + 1]!, mu[j]!, sigma2[j]!);
          const logXi =
            fwd.logAlpha[t]![i]! +
            logA[i]![j]! +
            emit +
            bwd.logBeta[t + 1]![j]! -
            logLik;
          xiSum[i]![j]! += Math.exp(logXi);
        }
      }
    }

    // M-step.
    for (let i = 0; i < N; i++) pi[i] = gamma[0]![i]!;

    for (let i = 0; i < N; i++) {
      let denom = 0;
      for (let t = 0; t < T - 1; t++) denom += gamma[t]![i]!;
      if (denom > 0) {
        for (let j = 0; j < N; j++) A[i]![j] = xiSum[i]![j]! / denom;
      }
    }

    for (let i = 0; i < N; i++) {
      let denom = 0;
      for (let t = 0; t < T; t++) denom += gamma[t]![i]!;
      if (denom <= 0) continue;
      const newMu = new Array<number>(d).fill(0);
      for (let t = 0; t < T; t++) {
        const w = gamma[t]![i]!;
        for (let k = 0; k < d; k++) newMu[k]! += w * data[t]![k]!;
      }
      for (let k = 0; k < d; k++) newMu[k]! /= denom;
      mu[i] = newMu;

      const newVar = new Array<number>(d).fill(0);
      for (let t = 0; t < T; t++) {
        const w = gamma[t]![i]!;
        for (let k = 0; k < d; k++) {
          const diff = data[t]![k]! - newMu[k]!;
          newVar[k]! += w * diff * diff;
        }
      }
      for (let k = 0; k < d; k++) {
        newVar[k]! = Math.max(newVar[k]! / denom, varianceFloor);
      }
      sigma2[i] = newVar;
    }
  }

  // Final log-likelihood with converged params.
  const finalModel: HmmModel = { nStates: N, pi, A, mu, sigma2 };
  const finalLL = forward(finalModel, data).logLikelihood;
  if (history.length === 0 || history[history.length - 1] !== finalLL) {
    history.push(finalLL);
  }

  return {
    model: { nStates: N, pi, A, mu, sigma2 },
    logLikelihood: finalLL,
    history,
    iterations: iter,
    converged,
  };
}

// Smoothed state posteriors. γ_t(i) = P(state=i | obs_{1..T}, λ).
//   log γ_t(i) = log α_t(i) + log β_t(i) − logSumExp_k [log α_t(k) + log β_t(k)]
// Returns a T×N array of probabilities (each row sums to 1).
export function smoothedPosteriors(
  model: HmmModel,
  obs: readonly (readonly number[])[],
): number[][] {
  const fwd = forward(model, obs);
  const bwd = backward(model, obs);
  const T = obs.length;
  const N = model.nStates;
  const gamma: number[][] = Array.from({ length: T }, () => new Array<number>(N).fill(0));
  const merged = new Array<number>(N);
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < N; i++) merged[i] = fwd.logAlpha[t]![i]! + bwd.logBeta[t]![i]!;
    const norm = logSumExp(merged);
    for (let i = 0; i < N; i++) gamma[t]![i] = Math.exp(merged[i]! - norm);
  }
  return gamma;
}
