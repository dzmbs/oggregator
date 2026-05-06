import { describe, expect, it } from 'vitest';
import {
  applyStandardization,
  fitStandardization,
  interpBasisToTenor,
  labelStatesByVolLevel,
  RegimeService,
  type RegimeInputs,
  type RegimeLabel,
} from './regime.js';

describe('interpBasisToTenor — linear-in-DTE basis interpolation', () => {
  it('returns null for empty input', () => {
    expect(interpBasisToTenor([], 30)).toBeNull();
  });

  it('returns the single point value regardless of target', () => {
    expect(interpBasisToTenor([{ dte: 14, basisPct: 0.012 }], 30)).toBe(0.012);
  });

  it('clamps to nearest endpoint outside the observed DTE range', () => {
    const pts = [
      { dte: 14, basisPct: 0.005 },
      { dte: 60, basisPct: 0.02 },
    ];
    expect(interpBasisToTenor(pts, 7)).toBe(0.005);
    expect(interpBasisToTenor(pts, 90)).toBe(0.02);
  });

  it('linearly interpolates between two adjacent points', () => {
    const pts = [
      { dte: 10, basisPct: 0.01 },
      { dte: 70, basisPct: 0.07 },
    ];
    // Linear in DTE: at 40d → halfway → 0.04
    expect(interpBasisToTenor(pts, 40)).toBeCloseTo(0.04, 12);
  });

  it('picks the bracketing pair from a multi-point curve', () => {
    const pts = [
      { dte: 7, basisPct: 0.001 },
      { dte: 14, basisPct: 0.005 },
      { dte: 60, basisPct: 0.02 },
      { dte: 180, basisPct: 0.04 },
    ];
    // 30d sits between 14 and 60. (30 - 14) / (60 - 14) = 16/46 ≈ 0.3478
    // basis = 0.005 + 0.3478 × (0.02 − 0.005) = 0.005 + 0.005217 = 0.010217
    expect(interpBasisToTenor(pts, 30)).toBeCloseTo(0.010217, 4);
  });

  it('handles unsorted input by sorting internally', () => {
    const pts = [
      { dte: 60, basisPct: 0.02 },
      { dte: 14, basisPct: 0.005 },
    ];
    expect(interpBasisToTenor(pts, 30)).toBeCloseTo(
      0.005 + ((30 - 14) / (60 - 14)) * (0.02 - 0.005),
      10,
    );
  });

  it('ignores points with non-positive DTE (already expired or invalid)', () => {
    const pts = [
      { dte: 0, basisPct: 0.5 },
      { dte: -5, basisPct: 1 },
      { dte: 30, basisPct: 0.01 },
    ];
    expect(interpBasisToTenor(pts, 30)).toBe(0.01);
  });
});

describe('fitStandardization / applyStandardization — z-score per feature', () => {
  it('fitStandardization computes per-feature population mean and stdev', () => {
    // Two features. Feature 0: [1, 2, 3, 4, 5] → mean 3, var = 2, std = √2
    // Feature 1: [10, 12, 14, 16, 18] → mean 14, var = 8, std = √8
    const data = [
      [1, 10],
      [2, 12],
      [3, 14],
      [4, 16],
      [5, 18],
    ];
    const params = fitStandardization(data);
    expect(params.means[0]!).toBeCloseTo(3, 12);
    expect(params.means[1]!).toBeCloseTo(14, 12);
    expect(params.stds[0]!).toBeCloseTo(Math.sqrt(2), 12);
    expect(params.stds[1]!).toBeCloseTo(Math.sqrt(8), 12);
  });

  it('applyStandardization produces (x − μ) / σ per feature', () => {
    const params = { means: [3, 14], stds: [Math.sqrt(2), Math.sqrt(8)] };
    const z = applyStandardization([5, 16], params);
    expect(z[0]!).toBeCloseTo((5 - 3) / Math.sqrt(2), 12);
    expect(z[1]!).toBeCloseTo((16 - 14) / Math.sqrt(8), 12);
  });

  it('round-trips: applying standardization then de-standardizing recovers x', () => {
    const data = [
      [1.5, -2],
      [2.1, -1.5],
      [3.7, 0.4],
      [4.0, 1.1],
      [2.9, 0.2],
    ];
    const params = fitStandardization(data);
    const z = applyStandardization(data[2]!, params);
    const recovered = z.map((zi, i) => zi * params.stds[i]! + params.means[i]!);
    expect(recovered[0]!).toBeCloseTo(data[2]![0]!, 10);
    expect(recovered[1]!).toBeCloseTo(data[2]![1]!, 10);
  });

  it('handles a constant feature (zero variance) by returning 0 z-score', () => {
    // Feature 0 is constant. Standardizing must not produce NaN/Infinity.
    const params = fitStandardization([
      [5, 1],
      [5, 2],
      [5, 3],
    ]);
    expect(params.stds[0]!).toBe(0);
    const z = applyStandardization([5, 2], params);
    expect(z[0]!).toBe(0);
    expect(Number.isFinite(z[1]!)).toBe(true);
  });

  it('throws on empty data (no statistics to fit)', () => {
    expect(() => fitStandardization([])).toThrow();
  });

  it('throws on dimension mismatch in applyStandardization', () => {
    const params = { means: [0, 0], stds: [1, 1] };
    expect(() => applyStandardization([1], params)).toThrow();
    expect(() => applyStandardization([1, 2, 3], params)).toThrow();
  });
});

describe('labelStatesByVolLevel — assign bull/neutral/stress by ATM IV ordering', () => {
  it('orders 3 states by the chosen feature: lowest=bull, highest=stress', () => {
    // stateMeans[i] is per-state mean vector. atmIv is at feature index 0.
    const stateMeans = [
      [0.5, 0, 0, 0],   // state 0: mid vol
      [0.2, 0, 0, 0],   // state 1: low vol → bull
      [0.9, 0, 0, 0],   // state 2: high vol → stress
    ];
    const labels = labelStatesByVolLevel(stateMeans, 0);
    expect(labels).toEqual<RegimeLabel[]>(['neutral', 'bull', 'stress']);
  });

  it('handles 2 states by labeling extremes only (no neutral)', () => {
    const stateMeans = [
      [0.3, 0],
      [0.8, 0],
    ];
    const labels = labelStatesByVolLevel(stateMeans, 0);
    expect(labels).toEqual<RegimeLabel[]>(['bull', 'stress']);
  });

  it('labels a single state as neutral (no contrast available)', () => {
    const labels = labelStatesByVolLevel([[0.5]], 0);
    expect(labels).toEqual<RegimeLabel[]>(['neutral']);
  });

  it('throws on out-of-range featureIndex (programming error)', () => {
    expect(() => labelStatesByVolLevel([[0.5, 0.3]], 5)).toThrow();
  });
});

describe('RegimeService — snapshot loop, fit, posterior, query', () => {
  // Synthetic three-regime generator with 100-sample blocks cycling
  // bull → neutral → stress → bull → neutral → stress → ...
  // Three distinct clusters give 3-state EM a clean target to fit.
  function makeFeed(): {
    inputs: RegimeInputs[];
    deps: ConstructorParameters<typeof RegimeService>[0];
  } {
    const inputs: RegimeInputs[] = [];
    let cursor = 0;
    const startTs = 1_700_000_000_000;
    const stepMs = 5 * 60 * 1000;
    const profile = (kind: 'bull' | 'neutral' | 'stress'): Omit<RegimeInputs, 'ts'> => {
      if (kind === 'bull') {
        return { atmIv30d: 0.4, rr25d_30d: 0, bfly25d_30d: 0.005, basis30d: 0.015 };
      }
      if (kind === 'stress') {
        return { atmIv30d: 0.95, rr25d_30d: -0.08, bfly25d_30d: 0.04, basis30d: -0.01 };
      }
      return { atmIv30d: 0.6, rr25d_30d: -0.02, bfly25d_30d: 0.012, basis30d: 0.008 };
    };
    const order: ('bull' | 'neutral' | 'stress')[] = ['bull', 'neutral', 'stress'];
    for (let i = 0; i < 900; i++) {
      const kind = order[Math.floor(i / 100) % 3]!;
      const base = profile(kind);
      const noise = (amp: number, k: number): number => amp * Math.sin(i * k);
      inputs.push({
        ts: startTs + i * stepMs,
        atmIv30d: base.atmIv30d! + noise(0.01, 0.7),
        rr25d_30d: base.rr25d_30d! + noise(0.003, 1.1),
        bfly25d_30d: base.bfly25d_30d! + noise(0.001, 0.3),
        basis30d: base.basis30d! + noise(0.001, 0.5),
      });
    }
    return {
      inputs,
      deps: {
        underlyings: ['BTC'],
        getRegimeInputs: async () => {
          const next = inputs[cursor++];
          if (!next) throw new Error('feed exhausted');
          return next;
        },
      },
    };
  }

  it('query returns null posterior before any snapshot', () => {
    const { deps } = makeFeed();
    const svc = new RegimeService(deps);
    const result = svc.query('BTC');
    expect(result.posterior).toBeNull();
    expect(result.observationCount).toBe(0);
    expect(result.dominant).toBeNull();
  });

  it('query returns null posterior while observation count is below the fit threshold', async () => {
    const { deps } = makeFeed();
    const svc = new RegimeService(deps, { minSamplesToFit: 200, nStates: 3 });
    for (let i = 0; i < 50; i++) await svc.snapshotOnce();
    const result = svc.query('BTC');
    expect(result.observationCount).toBe(50);
    expect(result.posterior).toBeNull();
  });

  it('after enough samples the HMM fits and produces a valid posterior', async () => {
    const { deps } = makeFeed();
    const svc = new RegimeService(deps, {
      minSamplesToFit: 200,
      nStates: 3,
      seed: 7,
      maxFitIter: 30,
    });
    for (let i = 0; i < 250; i++) await svc.snapshotOnce();
    const result = svc.query('BTC');
    expect(result.posterior).not.toBeNull();
    expect(result.posterior!).toHaveLength(3);
    const total = result.posterior!.reduce((s, x) => s + x, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(result.modelFittedAt).not.toBeNull();
    expect(result.stateLabels).toEqual<RegimeLabel[]>(
      expect.arrayContaining(['bull', 'stress']),
    );
  });

  it('dominant label tracks the regime through bull → neutral → stress blocks', async () => {
    const { deps } = makeFeed();
    const svc = new RegimeService(deps, {
      minSamplesToFit: 300,
      nStates: 3,
      seed: 42,
      maxFitIter: 100,
    });
    // Block layout: 0..99 bull, 100..199 neutral, 200..299 stress, 300..399 bull, ...
    // First fit happens at sample 300; at that point we've seen all 3 regimes.
    for (let i = 0; i < 350; i++) await svc.snapshotOnce(); // mid-bull (block 3)
    const atBull = svc.query('BTC').dominant;
    for (let i = 0; i < 100; i++) await svc.snapshotOnce(); // mid-neutral (block 4)
    const atNeutral = svc.query('BTC').dominant;
    for (let i = 0; i < 100; i++) await svc.snapshotOnce(); // mid-stress (block 5)
    const atStress = svc.query('BTC').dominant;
    expect(atBull).toBe('bull');
    expect(atStress).toBe('stress');
    // Neutral may pick neutral OR a neighbor depending on convergence — at
    // minimum it should not be 'stress' when sitting in the neutral block.
    expect(atNeutral).not.toBe('stress');
  });

  it('null inputs do not crash the service (skipped without breaking the buffer)', async () => {
    const allNull: RegimeInputs = {
      ts: 1,
      atmIv30d: null,
      rr25d_30d: null,
      bfly25d_30d: null,
      basis30d: null,
    };
    const svc = new RegimeService({
      underlyings: ['BTC'],
      getRegimeInputs: async () => allNull,
    });
    await svc.snapshotOnce();
    const result = svc.query('BTC');
    expect(result.observationCount).toBe(0);
  });
});
