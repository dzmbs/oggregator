import { describe, expect, it } from 'vitest';
import {
  backward,
  fitGaussianHmm,
  forward,
  gaussianLogPdf,
  logSumExp,
  smoothedPosteriors,
  viterbi,
  type HmmModel,
} from './regime-hmm.js';

// Mulberry32: tiny seedable PRNG. Deterministic across machines so synthetic
// fixture-based tests are repeatable.
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

function gaussianSample(rng: () => number, mu: number, sigma: number): number {
  // Box-Muller, single value.
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return mu + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

describe('logSumExp — numerically stable log Σ exp', () => {
  it('returns log(sum(exp(xs))) for small values where naive math is fine', () => {
    // log(e^0 + e^0 + e^0) = log(3) ≈ 1.0986
    expect(logSumExp([0, 0, 0])).toBeCloseTo(Math.log(3), 10);
  });

  it('survives extreme negative values where naive exp underflows to 0', () => {
    // exp(-1000) underflows to 0 in float64. logSumExp([-1000,-1000,-1000])
    // should still be -1000 + log(3), not -Infinity.
    expect(logSumExp([-1000, -1000, -1000])).toBeCloseTo(-1000 + Math.log(3), 10);
  });

  it('survives extreme positive values where naive exp overflows to Infinity', () => {
    expect(logSumExp([1000, 1000])).toBeCloseTo(1000 + Math.log(2), 10);
  });

  it('returns the single value for a one-element input', () => {
    expect(logSumExp([-7.5])).toBe(-7.5);
  });

  it('returns -Infinity for an empty input (log of empty sum)', () => {
    expect(logSumExp([])).toBe(-Infinity);
  });
});

describe('gaussianLogPdf — diagonal multivariate Gaussian log-density', () => {
  it('matches univariate standard-normal at the mean: log(1/√(2π)) ≈ -0.91894', () => {
    expect(gaussianLogPdf([0], [0], [1])).toBeCloseTo(-0.5 * Math.log(2 * Math.PI), 10);
  });

  it('matches univariate standard-normal at x=1: -0.5·log(2π) − 0.5', () => {
    expect(gaussianLogPdf([1], [0], [1])).toBeCloseTo(-0.5 * Math.log(2 * Math.PI) - 0.5, 10);
  });

  it('factorizes across diagonal dimensions: joint = sum of marginals', () => {
    // 2-D diagonal Gaussian with independent N(0,1) and N(2, 4):
    // log p(x=[1, 3]) = log p_1(1; 0, 1) + log p_2(3; 2, 4)
    const joint = gaussianLogPdf([1, 3], [0, 2], [1, 4]);
    const m1 = -0.5 * Math.log(2 * Math.PI) - 0.5; // (1-0)²/(2·1)=0.5
    const m2 = -0.5 * Math.log(2 * Math.PI * 4) - (1 * 1) / (2 * 4);
    expect(joint).toBeCloseTo(m1 + m2, 10);
  });

  it('throws on dimension mismatch (programming error, not data condition)', () => {
    expect(() => gaussianLogPdf([1, 2], [0], [1])).toThrow();
  });

  it('throws on non-positive variance (degenerate distribution)', () => {
    expect(() => gaussianLogPdf([0], [0], [0])).toThrow();
    expect(() => gaussianLogPdf([0], [0], [-1])).toThrow();
  });
});

// Brute-force log P(O | λ) by summing over every state sequence. Exponential
// in T, so only usable as a small-T oracle for validating forward().
function bruteForceLogLikelihood(model: HmmModel, obs: readonly number[][]): number {
  const T = obs.length;
  const N = model.nStates;
  const seqLogProbs: number[] = [];
  const seq = new Array<number>(T).fill(0);
  const recurse = (t: number): void => {
    if (t === T) {
      let lp = Math.log(model.pi[seq[0]!]!);
      lp += gaussianLogPdf(obs[0]!, model.mu[seq[0]!]!, model.sigma2[seq[0]!]!);
      for (let i = 1; i < T; i++) {
        lp += Math.log(model.A[seq[i - 1]!]![seq[i]!]!);
        lp += gaussianLogPdf(obs[i]!, model.mu[seq[i]!]!, model.sigma2[seq[i]!]!);
      }
      seqLogProbs.push(lp);
      return;
    }
    for (let s = 0; s < N; s++) {
      seq[t] = s;
      recurse(t + 1);
    }
  };
  recurse(0);
  return logSumExp(seqLogProbs);
}

describe('forward — log-domain forward algorithm', () => {
  it('matches Σ_t log b(o_t) exactly for a 1-state model (transitions are no-ops)', () => {
    const model: HmmModel = {
      nStates: 1,
      pi: [1],
      A: [[1]],
      mu: [[0]],
      sigma2: [[1]],
    };
    const obs = [[0], [1], [-2]];
    const expected =
      gaussianLogPdf([0], [0], [1]) +
      gaussianLogPdf([1], [0], [1]) +
      gaussianLogPdf([-2], [0], [1]);
    const result = forward(model, obs);
    expect(result.logLikelihood).toBeCloseTo(expected, 10);
  });

  it('matches brute-force enumeration for a 2-state, T=3 sequence', () => {
    const model: HmmModel = {
      nStates: 2,
      pi: [0.6, 0.4],
      A: [
        [0.85, 0.15],
        [0.2, 0.8],
      ],
      mu: [[0], [5]],
      sigma2: [[1], [2]],
    };
    const obs = [[0.2], [4.5], [-0.5]];
    const result = forward(model, obs);
    const expected = bruteForceLogLikelihood(model, obs);
    expect(result.logLikelihood).toBeCloseTo(expected, 10);
  });

  it('matches brute-force enumeration for a 3-state, T=4, 2-D sequence', () => {
    const model: HmmModel = {
      nStates: 3,
      pi: [0.3, 0.4, 0.3],
      A: [
        [0.8, 0.15, 0.05],
        [0.1, 0.7, 0.2],
        [0.05, 0.25, 0.7],
      ],
      mu: [
        [0, 0],
        [2, 1],
        [-1, 3],
      ],
      sigma2: [
        [1, 0.5],
        [0.8, 1],
        [1.2, 0.7],
      ],
    };
    const obs = [
      [0.1, 0.2],
      [1.8, 0.9],
      [-0.9, 2.7],
      [0.3, 1.1],
    ];
    const result = forward(model, obs);
    const expected = bruteForceLogLikelihood(model, obs);
    expect(result.logLikelihood).toBeCloseTo(expected, 10);
  });

  it('returns one logAlpha row per timestep with N entries each', () => {
    const model: HmmModel = {
      nStates: 2,
      pi: [0.5, 0.5],
      A: [
        [0.9, 0.1],
        [0.1, 0.9],
      ],
      mu: [[0], [3]],
      sigma2: [[1], [1]],
    };
    const obs = [[0], [2], [3]];
    const result = forward(model, obs);
    expect(result.logAlpha).toHaveLength(3);
    for (const row of result.logAlpha) expect(row).toHaveLength(2);
  });

  it('throws on empty observations (no likelihood to compute)', () => {
    const model: HmmModel = {
      nStates: 1,
      pi: [1],
      A: [[1]],
      mu: [[0]],
      sigma2: [[1]],
    };
    expect(() => forward(model, [])).toThrow();
  });
});

describe('backward — log-domain backward algorithm', () => {
  const model: HmmModel = {
    nStates: 3,
    pi: [0.3, 0.4, 0.3],
    A: [
      [0.8, 0.15, 0.05],
      [0.1, 0.7, 0.2],
      [0.05, 0.25, 0.7],
    ],
    mu: [[0], [2], [-1]],
    sigma2: [[1], [0.8], [1.2]],
  };
  const obs = [[0.1], [1.8], [-0.9], [0.3], [2.1]];

  it('β_T initializes to log 1 = 0 for every state', () => {
    const result = backward(model, obs);
    for (const x of result.logBeta[result.logBeta.length - 1]!) {
      expect(x).toBe(0);
    }
  });

  it('forward-backward consistency: logSumExp_i (α_t + β_t) = log P(O) at every t', () => {
    const fwd = forward(model, obs);
    const bwd = backward(model, obs);
    for (let t = 0; t < obs.length; t++) {
      const merged = fwd.logAlpha[t]!.map((a, i) => a + bwd.logBeta[t]![i]!);
      expect(logSumExp(merged)).toBeCloseTo(fwd.logLikelihood, 9);
    }
  });
});

describe('viterbi — most-likely state sequence', () => {
  it('recovers ground-truth states for well-separated emissions', () => {
    // Two states centered far apart (μ=0 vs μ=10, σ²=1). Sticky transitions
    // prefer staying in the same state, so Viterbi should follow the
    // observation cluster pattern: low → low → high → high → low.
    const model: HmmModel = {
      nStates: 2,
      pi: [0.5, 0.5],
      A: [
        [0.95, 0.05],
        [0.05, 0.95],
      ],
      mu: [[0], [10]],
      sigma2: [[1], [1]],
    };
    const obs = [[0.1], [-0.2], [9.8], [10.3], [0.5]];
    const result = viterbi(model, obs);
    expect(result.path).toEqual([0, 0, 1, 1, 0]);
  });

  it('returns a path of length T and a finite path log-probability', () => {
    const model: HmmModel = {
      nStates: 3,
      pi: [0.33, 0.34, 0.33],
      A: [
        [0.7, 0.2, 0.1],
        [0.2, 0.6, 0.2],
        [0.1, 0.2, 0.7],
      ],
      mu: [[-3], [0], [3]],
      sigma2: [[1], [1], [1]],
    };
    const obs = [[-2.5], [-3.2], [0.1], [3.4], [2.7], [-0.1]];
    const result = viterbi(model, obs);
    expect(result.path).toHaveLength(obs.length);
    expect(Number.isFinite(result.logProb)).toBe(true);
  });

  it('Viterbi log-prob never exceeds forward log-likelihood (max ≤ sum)', () => {
    const model: HmmModel = {
      nStates: 2,
      pi: [0.5, 0.5],
      A: [
        [0.7, 0.3],
        [0.4, 0.6],
      ],
      mu: [[0], [3]],
      sigma2: [[1], [2]],
    };
    const obs = [[0.5], [2.5], [1.0], [3.2]];
    const fwd = forward(model, obs);
    const vit = viterbi(model, obs);
    expect(vit.logProb).toBeLessThanOrEqual(fwd.logLikelihood + 1e-9);
  });
});

describe('smoothedPosteriors — γ_t(i) = P(state=i | full obs)', () => {
  const model: HmmModel = {
    nStates: 3,
    pi: [0.3, 0.4, 0.3],
    A: [
      [0.85, 0.1, 0.05],
      [0.1, 0.8, 0.1],
      [0.05, 0.15, 0.8],
    ],
    mu: [[-2], [0], [3]],
    sigma2: [[0.5], [1], [0.8]],
  };

  it('rows sum to 1 at every timestep (proper posterior distribution)', () => {
    const obs = [[-1.8], [0.1], [2.9], [3.2], [0.0], [-1.7]];
    const gamma = smoothedPosteriors(model, obs);
    for (let t = 0; t < obs.length; t++) {
      const total = gamma[t]!.reduce((s, x) => s + x, 0);
      expect(total).toBeCloseTo(1, 10);
    }
  });

  it('concentrates probability on the well-matched state for an obvious observation', () => {
    // x = -2.5 sits 1σ inside state-0's distribution and >2σ from states 1 & 2.
    // Posterior P(state=0 | x=-2.5) should dominate even with state 0 having
    // the lowest prior (0.3 vs 0.4 for state 1).
    const obs = [[-2.5]];
    const gamma = smoothedPosteriors(model, obs);
    expect(gamma[0]![0]!).toBeGreaterThan(0.9);
  });

  it('all γ_t(i) are in [0, 1]', () => {
    const obs = [[-2], [3], [-2], [3], [0]];
    const gamma = smoothedPosteriors(model, obs);
    for (const row of gamma) {
      for (const p of row) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('fitGaussianHmm — Baum-Welch EM fit', () => {
  it('1-state fit reduces to MLE Gaussian (μ = sample mean, σ² = sample variance)', () => {
    const rng = mulberry32(42);
    const trueMu = 5;
    const trueSigma = 2;
    const data: number[][] = [];
    for (let i = 0; i < 500; i++) data.push([gaussianSample(rng, trueMu, trueSigma)]);

    const fit = fitGaussianHmm(data, { nStates: 1, seed: 1 });
    const sampleMean = data.reduce((s, x) => s + x[0]!, 0) / data.length;
    const sampleVar =
      data.reduce((s, x) => s + (x[0]! - sampleMean) ** 2, 0) / data.length;

    expect(fit.model.mu[0]![0]!).toBeCloseTo(sampleMean, 6);
    expect(fit.model.sigma2[0]![0]!).toBeCloseTo(sampleVar, 6);
  });

  it('log-likelihood is monotonically non-decreasing across EM iterations', () => {
    const rng = mulberry32(7);
    const data: number[][] = [];
    for (let i = 0; i < 200; i++) {
      const muTrue = i % 50 < 25 ? 0 : 6;
      data.push([gaussianSample(rng, muTrue, 1)]);
    }
    const fit = fitGaussianHmm(data, { nStates: 2, seed: 7, maxIter: 30 });
    for (let i = 1; i < fit.history.length; i++) {
      expect(fit.history[i]!).toBeGreaterThanOrEqual(fit.history[i - 1]! - 1e-9);
    }
  });

  it('recovers ground-truth means on well-separated 2-state synthetic data', () => {
    const rng = mulberry32(123);
    const A = [
      [0.95, 0.05],
      [0.05, 0.95],
    ];
    const trueMus = [-3, 4];
    const trueSigma = 1;
    const data: number[][] = [];
    let state = 0;
    for (let i = 0; i < 800; i++) {
      data.push([gaussianSample(rng, trueMus[state]!, trueSigma)]);
      state = rng() < A[state]![0]! ? 0 : 1;
    }
    const fit = fitGaussianHmm(data, { nStates: 2, seed: 1, maxIter: 100, tol: 1e-5 });
    // Match fitted means to truth by sorting (label permutation invariance).
    const fittedMus = fit.model.mu.map((m) => m[0]!).sort((a, b) => a - b);
    expect(fittedMus[0]!).toBeCloseTo(trueMus[0]!, 0);
    expect(fittedMus[1]!).toBeCloseTo(trueMus[1]!, 0);
  });

  it('returned model has valid stochastic properties (π and A rows sum to 1)', () => {
    const rng = mulberry32(99);
    const data: number[][] = [];
    for (let i = 0; i < 100; i++) data.push([gaussianSample(rng, 0, 1)]);
    const fit = fitGaussianHmm(data, { nStates: 3, seed: 2, maxIter: 10 });
    const piSum = fit.model.pi.reduce((s, x) => s + x, 0);
    expect(piSum).toBeCloseTo(1, 6);
    for (const row of fit.model.A) {
      const rowSum = row.reduce((s, x) => s + x, 0);
      expect(rowSum).toBeCloseTo(1, 6);
    }
  });

  it('throws on insufficient data (T < nStates)', () => {
    expect(() => fitGaussianHmm([[0], [1]], { nStates: 3, seed: 1 })).toThrow();
  });
});
