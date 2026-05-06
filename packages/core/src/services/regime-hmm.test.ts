import { describe, expect, it } from 'vitest';
import {
  forward,
  gaussianLogPdf,
  logSumExp,
  type HmmModel,
} from './regime-hmm.js';

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
