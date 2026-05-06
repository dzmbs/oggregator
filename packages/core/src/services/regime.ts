import { feedLogger } from '../utils/logger.js';
import {
  fitGaussianHmm,
  smoothedPosteriors,
  type HmmModel,
} from './regime-hmm.js';

const log = feedLogger('regime');

export interface BasisPoint {
  dte: number;
  basisPct: number;
}

export type RegimeLabel = 'bull' | 'neutral' | 'stress';

// Map HMM state indices to regime labels using the chosen feature (typically
// ATM IV) as the ordering signal. Lowest vol → bull, highest vol → stress,
// everything in between → neutral. This resolves the EM label-permutation
// problem deterministically so callers can act on the labels.
export function labelStatesByVolLevel(
  stateMeans: readonly (readonly number[])[],
  featureIndex: number,
): RegimeLabel[] {
  const N = stateMeans.length;
  if (N === 0) return [];
  if (featureIndex < 0 || featureIndex >= stateMeans[0]!.length) {
    throw new Error(
      `labelStatesByVolLevel: featureIndex ${featureIndex} out of range [0, ${stateMeans[0]!.length})`,
    );
  }
  if (N === 1) return ['neutral'];

  const indexed = stateMeans.map((mu, i) => ({ i, v: mu[featureIndex]! }));
  indexed.sort((a, b) => a.v - b.v);

  const labels = new Array<RegimeLabel>(N).fill('neutral');
  labels[indexed[0]!.i] = 'bull';
  labels[indexed[N - 1]!.i] = 'stress';
  return labels;
}

// ── RegimeService ────────────────────────────────────────────────────────

export interface RegimeInputs {
  ts: number;
  atmIv30d: number | null;
  rr25d_30d: number | null;
  bfly25d_30d: number | null;
  basis30d: number | null;
}

export interface RegimePersistedModel {
  underlying: string;
  fittedAt: number;
  observationCount: number;
  hmm: HmmModel;
  standardization: StandardizationParams;
  stateLabels: RegimeLabel[];
}

export interface RegimePersistedObservation {
  underlying: string;
  ts: number;
  features: number[];
  posterior: number[] | null;
  dominant: RegimeLabel | null;
}

export interface RegimePersistence {
  readonly enabled: boolean;
  loadModel(underlying: string): Promise<RegimePersistedModel | null>;
  saveModel(model: RegimePersistedModel): Promise<void>;
  loadObservationsSince(query: {
    underlyings: string[];
    since: number;
  }): Promise<RegimePersistedObservation[]>;
  saveObservation(row: RegimePersistedObservation): Promise<void>;
}

export interface RegimeServiceDeps {
  underlyings: string[];
  getRegimeInputs: (underlying: string) => Promise<RegimeInputs>;
  store?: RegimePersistence;
}

export interface RegimeServiceOptions {
  intervalMs?: number;
  capacity?: number;
  minSamplesToFit?: number;
  refitIntervalMs?: number;
  nStates?: number;
  seed?: number;
  maxFitIter?: number;
  fitTol?: number;
}

export interface RegimeQueryResult {
  underlying: string;
  ts: number;
  observationCount: number;
  posterior: number[] | null;
  stateLabels: RegimeLabel[] | null;
  dominant: RegimeLabel | null;
  confidence: number | null;
  modelFittedAt: number | null;
  lastTransitionAt: number | null;
}

interface RegimeBufferRow {
  ts: number;
  features: number[];
}

interface UnderlyingState {
  buffer: RegimeBufferRow[];
  model: HmmModel | null;
  modelFittedAt: number | null;
  standardization: StandardizationParams | null;
  stateLabels: RegimeLabel[] | null;
  posterior: number[] | null;
  posteriorTs: number | null;
  dominant: RegimeLabel | null;
  lastTransitionAt: number | null;
}

// Feature order: [atmIv30d, rr25d_30d, bfly25d_30d, basis30d]. This order is
// load-bearing — it determines the layout of standardization params, HMM
// emission means, and persisted features JSONB. ATM IV is at index 0 because
// it's the labeling feature for bull/neutral/stress.
const VOL_FEATURE_INDEX = 0;
const HISTORY_LOAD_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function inputsToFeatures(input: RegimeInputs): number[] | null {
  const v = [input.atmIv30d, input.rr25d_30d, input.bfly25d_30d, input.basis30d];
  if (v.some((x) => x == null || !Number.isFinite(x))) return null;
  return v as number[];
}

// Multi-underlying regime classifier. One HMM per underlying. Keeps a rolling
// buffer of raw observations, periodically refits the HMM (Baum-Welch) +
// standardization, and on each new snapshot runs the forward algorithm over
// the standardized buffer to update the posterior P(state | obs).
//
// Initialization order at startup:
//   1. loadPersistedHistory  — backfill ring buffer from DB so labels and
//                              posteriors don't drift on every restart.
//   2. loadPersistedModel    — restore last fitted (HMM + standardization).
//   3. snapshotOnce          — first live tick triggers a forward pass over
//                              the warmed buffer with the restored model.
//   4. setInterval           — recurring snapshot loop on intervalMs cadence.
export class RegimeService {
  private readonly states = new Map<string, UnderlyingState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly capacity: number;
  private readonly minSamplesToFit: number;
  private readonly refitIntervalMs: number;
  private readonly nStates: number;
  private readonly seed: number;
  private readonly maxFitIter: number;
  private readonly fitTol: number;

  constructor(
    private readonly deps: RegimeServiceDeps,
    opts: RegimeServiceOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? 5 * 60 * 1000;
    this.capacity = opts.capacity ?? 90 * 24 * 12;
    this.minSamplesToFit = opts.minSamplesToFit ?? 500;
    this.refitIntervalMs = opts.refitIntervalMs ?? 7 * MS_PER_DAY;
    this.nStates = opts.nStates ?? 3;
    this.seed = opts.seed ?? 42;
    this.maxFitIter = opts.maxFitIter ?? 100;
    this.fitTol = opts.fitTol ?? 1e-5;
    for (const u of deps.underlyings) this.states.set(u, this.emptyState());
  }

  async start(): Promise<void> {
    await this.loadPersistedHistory();
    await this.loadPersistedModels();
    try {
      await this.snapshotOnce();
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'initial regime snapshot failed');
    }
    this.timer = setInterval(() => {
      this.snapshotOnce().catch((err: unknown) => {
        log.warn({ err: String(err) }, 'regime snapshot failed');
      });
    }, this.intervalMs);
    log.info(
      { underlyings: this.deps.underlyings, intervalMs: this.intervalMs },
      'RegimeService started',
    );
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  query(underlying: string): RegimeQueryResult {
    const s = this.states.get(underlying);
    if (!s) {
      return {
        underlying,
        ts: 0,
        observationCount: 0,
        posterior: null,
        stateLabels: null,
        dominant: null,
        confidence: null,
        modelFittedAt: null,
        lastTransitionAt: null,
      };
    }
    return {
      underlying,
      ts: s.posteriorTs ?? 0,
      observationCount: s.buffer.length,
      posterior: s.posterior ? [...s.posterior] : null,
      stateLabels: s.stateLabels ? [...s.stateLabels] : null,
      dominant: s.dominant,
      confidence: s.posterior ? Math.max(...s.posterior) : null,
      modelFittedAt: s.modelFittedAt,
      lastTransitionAt: s.lastTransitionAt,
    };
  }

  /** Exposed for tests. Pulls one tick from each underlying's input source. */
  async snapshotOnce(): Promise<void> {
    for (const underlying of this.deps.underlyings) {
      let input: RegimeInputs;
      try {
        input = await this.deps.getRegimeInputs(underlying);
      } catch (err: unknown) {
        log.warn({ underlying, err: String(err) }, 'regime input fetch failed');
        continue;
      }
      const features = inputsToFeatures(input);
      if (!features) continue;

      const state = this.states.get(underlying) ?? this.emptyState();
      this.states.set(underlying, state);
      this.appendToBuffer(state, { ts: input.ts, features });

      const dueForRefit =
        state.modelFittedAt == null ||
        input.ts - state.modelFittedAt >= this.refitIntervalMs;

      if (state.buffer.length >= this.minSamplesToFit && dueForRefit) {
        try {
          this.refit(underlying, state, input.ts);
        } catch (err: unknown) {
          log.warn({ underlying, err: String(err) }, 'regime fit failed');
        }
      }

      if (state.model && state.standardization && state.stateLabels) {
        const posterior = this.computePosterior(state);
        const newDominant = this.dominantLabel(posterior, state.stateLabels);
        if (newDominant !== state.dominant) state.lastTransitionAt = input.ts;
        state.posterior = posterior;
        state.posteriorTs = input.ts;
        state.dominant = newDominant;

        await this.persistObservation(underlying, input.ts, features, posterior, newDominant);
      } else {
        await this.persistObservation(underlying, input.ts, features, null, null);
      }
    }
  }

  // ── internals ──────────────────────────────────────────────────────────

  private emptyState(): UnderlyingState {
    return {
      buffer: [],
      model: null,
      modelFittedAt: null,
      standardization: null,
      stateLabels: null,
      posterior: null,
      posteriorTs: null,
      dominant: null,
      lastTransitionAt: null,
    };
  }

  private appendToBuffer(state: UnderlyingState, row: RegimeBufferRow): void {
    state.buffer.push(row);
    if (state.buffer.length > this.capacity) {
      state.buffer.splice(0, state.buffer.length - this.capacity);
    }
  }

  private refit(underlying: string, state: UnderlyingState, ts: number): void {
    const raw = state.buffer.map((r) => r.features);
    const standardization = fitStandardization(raw);
    const standardized = raw.map((x) => applyStandardization(x, standardization));
    const fit = fitGaussianHmm(standardized, {
      nStates: this.nStates,
      seed: this.seed,
      maxIter: this.maxFitIter,
      tol: this.fitTol,
    });
    const stateLabels = labelStatesByVolLevel(fit.model.mu, VOL_FEATURE_INDEX);
    state.model = fit.model;
    state.standardization = standardization;
    state.stateLabels = stateLabels;
    state.modelFittedAt = ts;

    if (this.deps.store?.enabled) {
      this.deps.store
        .saveModel({
          underlying,
          fittedAt: ts,
          observationCount: state.buffer.length,
          hmm: fit.model,
          standardization,
          stateLabels,
        })
        .catch((err: unknown) => {
          log.warn({ underlying, err: String(err) }, 'persist regime model failed');
        });
    }
    log.info(
      {
        underlying,
        observationCount: state.buffer.length,
        logLikelihood: fit.logLikelihood,
        iterations: fit.iterations,
        labels: stateLabels,
      },
      'regime model fit',
    );
  }

  private computePosterior(state: UnderlyingState): number[] {
    const standardized = state.buffer.map((r) =>
      applyStandardization(r.features, state.standardization!),
    );
    const gamma = smoothedPosteriors(state.model!, standardized);
    const last = gamma[gamma.length - 1]!;
    return [...last];
  }

  private dominantLabel(posterior: number[], labels: RegimeLabel[]): RegimeLabel | null {
    let bestIdx = -1;
    let bestVal = -Infinity;
    for (let i = 0; i < posterior.length; i++) {
      if (posterior[i]! > bestVal) {
        bestVal = posterior[i]!;
        bestIdx = i;
      }
    }
    return bestIdx >= 0 ? (labels[bestIdx] ?? null) : null;
  }

  private async loadPersistedHistory(): Promise<void> {
    const store = this.deps.store;
    if (!store?.enabled) return;
    const since = Date.now() - HISTORY_LOAD_DAYS * MS_PER_DAY;
    let rows: RegimePersistedObservation[];
    try {
      rows = await store.loadObservationsSince({ underlyings: this.deps.underlyings, since });
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'load persisted regime observations failed');
      return;
    }
    for (const row of rows) {
      const state = this.states.get(row.underlying);
      if (!state) continue;
      this.appendToBuffer(state, { ts: row.ts, features: row.features });
    }
    log.info({ count: rows.length }, 'loaded persisted regime observations');
  }

  private async loadPersistedModels(): Promise<void> {
    const store = this.deps.store;
    if (!store?.enabled) return;
    for (const underlying of this.deps.underlyings) {
      try {
        const model = await store.loadModel(underlying);
        if (!model) continue;
        const state = this.states.get(underlying);
        if (!state) continue;
        state.model = model.hmm;
        state.standardization = model.standardization;
        state.stateLabels = model.stateLabels;
        state.modelFittedAt = model.fittedAt;
        log.info({ underlying, fittedAt: model.fittedAt }, 'restored persisted regime model');
      } catch (err: unknown) {
        log.warn({ underlying, err: String(err) }, 'load persisted regime model failed');
      }
    }
  }

  private async persistObservation(
    underlying: string,
    ts: number,
    features: number[],
    posterior: number[] | null,
    dominant: RegimeLabel | null,
  ): Promise<void> {
    const store = this.deps.store;
    if (!store?.enabled) return;
    try {
      await store.saveObservation({ underlying, ts, features, posterior, dominant });
    } catch (err: unknown) {
      log.warn({ underlying, err: String(err) }, 'persist regime observation failed');
    }
  }
}


export interface StandardizationParams {
  readonly means: readonly number[];
  readonly stds: readonly number[];
}

// Per-feature population mean and stdev (1/N denominator). Population (not
// sample) keeps fit/apply consistent when the same buffer is later resampled.
export function fitStandardization(data: readonly (readonly number[])[]): StandardizationParams {
  if (data.length === 0) {
    throw new Error('fitStandardization: empty data');
  }
  const d = data[0]!.length;
  const means = new Array<number>(d).fill(0);
  for (const x of data) for (let i = 0; i < d; i++) means[i]! += x[i]!;
  for (let i = 0; i < d; i++) means[i]! /= data.length;
  const stds = new Array<number>(d).fill(0);
  for (const x of data) {
    for (let i = 0; i < d; i++) {
      const v = x[i]! - means[i]!;
      stds[i]! += v * v;
    }
  }
  for (let i = 0; i < d; i++) stds[i]! = Math.sqrt(stds[i]! / data.length);
  return { means, stds };
}

// Apply z-score: (x − μ) / σ. A constant feature (σ = 0) maps to 0 instead of
// NaN — this matters at startup when the buffer is short and one feature
// hasn't moved yet, so the HMM still gets a usable observation.
export function applyStandardization(
  x: readonly number[],
  params: StandardizationParams,
): number[] {
  if (x.length !== params.means.length || x.length !== params.stds.length) {
    throw new Error(
      `applyStandardization: dimension mismatch (x=${x.length}, params=${params.means.length})`,
    );
  }
  const out = new Array<number>(x.length);
  for (let i = 0; i < x.length; i++) {
    const s = params.stds[i]!;
    out[i] = s > 0 ? (x[i]! - params.means[i]!) / s : 0;
  }
  return out;
}

// Linear-in-DTE interpolation of basis to a target constant-maturity tenor.
// Basis is a percentage (forward−spot)/spot, not a variance, so unlike IV
// interpolation (interpTenor) it stays linear in DTE — that's the
// cost-of-carry approximation. Outside the observed range, clamps to the
// nearest endpoint.
export function interpBasisToTenor(
  points: readonly BasisPoint[],
  targetDays: number,
): number | null {
  const pts = points
    .filter((p) => p.dte > 0 && Number.isFinite(p.basisPct))
    .slice()
    .sort((a, b) => a.dte - b.dte);
  if (pts.length === 0) return null;
  if (pts.length === 1 || targetDays <= pts[0]!.dte) return pts[0]!.basisPct;
  if (targetDays >= pts[pts.length - 1]!.dte) return pts[pts.length - 1]!.basisPct;
  for (let i = 1; i < pts.length; i++) {
    const lo = pts[i - 1]!;
    const hi = pts[i]!;
    if (targetDays <= hi.dte) {
      const span = hi.dte - lo.dte;
      if (span === 0) return hi.basisPct;
      const t = (targetDays - lo.dte) / span;
      return lo.basisPct + t * (hi.basisPct - lo.basisPct);
    }
  }
  return null;
}
