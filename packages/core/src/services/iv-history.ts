import {
  interpTenor,
  type IvHistoryExtrema,
  type IvHistoryPoint,
  type IvHistoryResponse,
  type IvHistoryTenorResult,
  type IvSurfaceRow,
  type IvTenor,
} from '../core/enrichment.js';
import { feedLogger } from '../utils/logger.js';
import type { DvolService } from './dvol.js';

const log = feedLogger('iv-history');

type IvTenorDays = 7 | 30 | 60 | 90;

const TENORS: IvTenor[] = ['7d', '30d', '60d', '90d'];
const TENOR_DAYS: Record<IvTenor, IvTenorDays> = { '7d': 7, '30d': 30, '60d': 60, '90d': 90 };
const TENOR_BY_DAYS: Record<number, IvTenor | undefined> = {
  7: '7d',
  30: '30d',
  60: '60d',
  90: '90d',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HISTORY_LOAD_DAYS = 90;

function emptyExtrema(): IvHistoryExtrema {
  return { atmIv: null, rr25d: null, bfly25d: null };
}

function bufferKey(underlying: string, tenor: IvTenor): string {
  return `${underlying}:${tenor}`;
}

interface RankPct {
  rank: number | null;
  percentile: number | null;
}

function rankAndPercentile(
  values: Array<number | null>,
  current: number | null,
): RankPct {
  if (current == null || !Number.isFinite(current)) return { rank: null, percentile: null };
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  // Need at least two samples AND a non-zero range for rank/percentile to be
  // meaningful. With one sample or a flat window the formulas trivially
  // produce 0/100, which misleads more than it informs — prefer null so the
  // UI renders "–" (insufficient data) instead.
  if (xs.length < 2) return { rank: null, percentile: null };
  let min = Infinity;
  let max = -Infinity;
  let leq = 0;
  for (const x of xs) {
    if (x < min) min = x;
    if (x > max) max = x;
    if (x <= current) leq += 1;
  }
  if (max <= min) return { rank: null, percentile: null };
  const rank = ((current - min) / (max - min)) * 100;
  const percentile = (leq / xs.length) * 100;
  return { rank, percentile };
}

export interface IvHistoryDeps {
  /** Builds a fresh IvSurfaceRow[] for the underlying across all listed expiries. */
  getSurfaceGrid: (underlying: string) => Promise<IvSurfaceRow[]>;
  /** Source of the DVOL 30d seed. Only BTC/ETH are seeded. */
  dvol: DvolService;
  /** Optional persistence layer. Core stays storage-agnostic; server wires DB in. */
  store?: IvHistoryPersistence;
}

export interface IvHistoryOptions {
  underlyings?: string[];
  intervalMs?: number;
  capacity?: number;
}

export type IvHistoryPointSource = 'live_surface' | 'deribit_dvol';

export interface PersistedIvHistoryPoint {
  underlying: string;
  tenorDays: IvTenorDays;
  ts: Date;
  atmIv: number | null;
  rr25d: number | null;
  bfly25d: number | null;
  source: IvHistoryPointSource;
}

export interface IvHistoryPersistence {
  readonly enabled: boolean;
  writeMany(points: PersistedIvHistoryPoint[]): Promise<void>;
  loadSince(query: { underlyings: string[]; since: Date }): Promise<PersistedIvHistoryPoint[]>;
}

/**
 * Tracks constant-maturity ATM IV, 25Δ risk-reversal, and 25Δ butterfly across
 * 7/30/60/90-day tenors. Snapshots every `intervalMs` from the live surface
 * grid; 30d ATM IV seeds from DvolService candles so IV rank is usable at
 * startup for BTC/ETH.
 *
 * In-memory ring buffer, matches the DvolService pattern: state is lost on
 * restart. Callers re-populate organically from the snapshot loop (and the
 * DVOL seed) without operator intervention.
 */
export class IvHistoryService {
  private buffers = new Map<string, IvHistoryPoint[]>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly underlyings: string[];
  private readonly intervalMs: number;
  private readonly capacity: number;

  constructor(
    private deps: IvHistoryDeps,
    opts: IvHistoryOptions = {},
  ) {
    this.underlyings = opts.underlyings ?? ['BTC', 'ETH'];
    this.intervalMs = opts.intervalMs ?? 5 * 60 * 1000;
    // 90 days at default 5-minute cadence.
    this.capacity = opts.capacity ?? 90 * 24 * 12;
  }

  async start(): Promise<void> {
    await this.loadPersistedHistory();
    await this.seedFromDvol();
    try {
      await this.snapshotOnce();
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'initial IV-history snapshot failed');
    }
    this.timer = setInterval(() => {
      this.snapshotOnce().catch((err: unknown) => {
        log.warn({ err: String(err) }, 'IV-history snapshot failed');
      });
    }, this.intervalMs);
    log.info(
      { underlyings: this.underlyings, intervalMs: this.intervalMs, capacity: this.capacity },
      'IvHistoryService started',
    );
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  query(underlying: string, windowDays: 30 | 90): IvHistoryResponse {
    const cutoff = Date.now() - windowDays * MS_PER_DAY;
    const tenors = {} as Record<IvTenor, IvHistoryTenorResult>;
    for (const tenor of TENORS) {
      tenors[tenor] = this.buildTenorResult(underlying, tenor, cutoff);
    }
    return { underlying, windowDays, tenors };
  }

  /** Exposed for tests. */
  getBuffer(underlying: string, tenor: IvTenor): IvHistoryPoint[] {
    return this.buffers.get(bufferKey(underlying, tenor)) ?? [];
  }

  /** Exposed for tests. */
  async snapshotOnce(now: number = Date.now()): Promise<void> {
    const persisted: PersistedIvHistoryPoint[] = [];
    for (const underlying of this.underlyings) {
      let surfaces: IvSurfaceRow[];
      try {
        surfaces = await this.deps.getSurfaceGrid(underlying);
      } catch (err: unknown) {
        log.warn({ underlying, err: String(err) }, 'surface grid fetch failed');
        continue;
      }
      if (surfaces.length === 0) continue;
      // For 30d BTC/ETH we align the live "current" with the DVOL-seeded
      // history. DVOL uses Deribit's own variance methodology across multiple
      // strikes; our interpTenor uses cross-venue ATM averages. Mixing them
      // introduces a systematic 1–3 vol-point gap that pins rank at 0.
      const dvolAtm =
        underlying === 'BTC' || underlying === 'ETH'
          ? (this.deps.dvol.getSnapshot?.(underlying)?.current ?? null)
          : null;
      for (const tenor of TENORS) {
        const days = TENOR_DAYS[tenor];
        const interpAtm = interpTenor(surfaces, days, 'atm');
        const atm = tenor === '30d' && dvolAtm != null ? dvolAtm : interpAtm;
        const c25 = interpTenor(surfaces, days, 'delta25c');
        const p25 = interpTenor(surfaces, days, 'delta25p');
        const rr = c25 != null && p25 != null ? c25 - p25 : null;
        // Butterfly uses the SAME ATM reference as the wings: interpolated, not
        // DVOL, so fly = (c25+p25)/2 − interpAtm stays internally consistent.
        const fly =
          c25 != null && p25 != null && interpAtm != null
            ? (c25 + p25) / 2 - interpAtm
            : null;
        this.appendPoint(underlying, tenor, { ts: now, atmIv: atm, rr25d: rr, bfly25d: fly });
        persisted.push({
          underlying,
          tenorDays: days,
          ts: new Date(now),
          atmIv: atm,
          rr25d: rr,
          bfly25d: fly,
          source: 'live_surface',
        });
      }
    }
    await this.persistPoints(persisted);
  }

  // ── internals ────────────────────────────────────────────────────

  private appendPoint(underlying: string, tenor: IvTenor, point: IvHistoryPoint): void {
    const key = bufferKey(underlying, tenor);
    const buf = this.buffers.get(key) ?? [];
    buf.push(point);
    if (buf.length > this.capacity) {
      buf.splice(0, buf.length - this.capacity);
    }
    this.buffers.set(key, buf);
  }

  private async loadPersistedHistory(): Promise<void> {
    const store = this.deps.store;
    if (!store?.enabled) return;

    const since = new Date(Date.now() - HISTORY_LOAD_DAYS * MS_PER_DAY);
    let points: PersistedIvHistoryPoint[];
    try {
      points = await store.loadSince({ underlyings: this.underlyings, since });
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'failed to load persisted IV history');
      return;
    }

    for (const point of points) {
      const tenor = TENOR_BY_DAYS[point.tenorDays];
      if (!tenor) continue;
      this.appendPoint(point.underlying, tenor, {
        ts: point.ts.getTime(),
        atmIv: point.atmIv,
        rr25d: point.rr25d,
        bfly25d: point.bfly25d,
      });
    }

    log.info({ count: points.length, since: since.toISOString() }, 'loaded persisted IV history');
  }

  private async seedFromDvol(): Promise<void> {
    const persisted: PersistedIvHistoryPoint[] = [];
    for (const underlying of this.underlyings) {
      if (underlying !== 'BTC' && underlying !== 'ETH') continue;
      if (this.getBuffer(underlying, '30d').length > 0) continue;
      const candles = this.deps.dvol.getHistory(underlying);
      if (candles.length === 0) {
        log.warn(
          { underlying },
          'DVOL history empty at seed time — 30d IV rank will require accumulation',
        );
        continue;
      }
      // DVOL candles are percentage (52.1 = 52.1%); internal convention is fraction.
      // DVOL is 30d ATM-only — skew & wing come from snapshot loop.
      const seed: IvHistoryPoint[] = candles.map((c) => ({
        ts: c.timestamp,
        atmIv: c.close / 100,
        rr25d: null,
        bfly25d: null,
      }));
      this.buffers.set(bufferKey(underlying, '30d'), seed.slice(-this.capacity));
      persisted.push(
        ...seed.slice(-this.capacity).map((point) => ({
          underlying,
          tenorDays: 30 as const,
          ts: new Date(point.ts),
          atmIv: point.atmIv,
          rr25d: null,
          bfly25d: null,
          source: 'deribit_dvol' as const,
        })),
      );
      const first = seed[0]!;
      const last = seed[seed.length - 1]!;
      log.info(
        {
          underlying,
          count: seed.length,
          firstTs: new Date(first.ts).toISOString(),
          lastTs: new Date(last.ts).toISOString(),
          firstIv: first.atmIv,
          lastIv: last.atmIv,
        },
        'seeded 30d ATM from DVOL',
      );
    }
    await this.persistPoints(persisted);
  }

  private async persistPoints(points: PersistedIvHistoryPoint[]): Promise<void> {
    const store = this.deps.store;
    if (!store?.enabled || points.length === 0) return;
    try {
      await store.writeMany(points);
    } catch (err: unknown) {
      log.warn({ err: String(err), count: points.length }, 'failed to persist IV history');
    }
  }

  private buildTenorResult(
    underlying: string,
    tenor: IvTenor,
    cutoff: number,
  ): IvHistoryTenorResult {
    const buf = this.buffers.get(bufferKey(underlying, tenor)) ?? [];
    const series = buf.filter((p) => p.ts >= cutoff);
    const latest =
      series.length > 0
        ? series[series.length - 1]!
        : { ts: 0, atmIv: null, rr25d: null, bfly25d: null };

    const atmValues = series.map((p) => p.atmIv);
    const rrValues = series.map((p) => p.rr25d);
    const flyValues = series.map((p) => p.bfly25d);

    const atmStats = rankAndPercentile(atmValues, latest.atmIv);
    const rrStats = rankAndPercentile(rrValues, latest.rr25d);
    const flyStats = rankAndPercentile(flyValues, latest.bfly25d);

    const min = emptyExtrema();
    const max = emptyExtrema();
    let atmMin = Infinity;
    let atmMax = -Infinity;
    let rrMin = Infinity;
    let rrMax = -Infinity;
    let flyMin = Infinity;
    let flyMax = -Infinity;
    for (const p of series) {
      if (p.atmIv != null) {
        if (p.atmIv < atmMin) atmMin = p.atmIv;
        if (p.atmIv > atmMax) atmMax = p.atmIv;
      }
      if (p.rr25d != null) {
        if (p.rr25d < rrMin) rrMin = p.rr25d;
        if (p.rr25d > rrMax) rrMax = p.rr25d;
      }
      if (p.bfly25d != null) {
        if (p.bfly25d < flyMin) flyMin = p.bfly25d;
        if (p.bfly25d > flyMax) flyMax = p.bfly25d;
      }
    }
    if (atmMin !== Infinity) {
      min.atmIv = atmMin;
      max.atmIv = atmMax;
    }
    if (rrMin !== Infinity) {
      min.rr25d = rrMin;
      max.rr25d = rrMax;
    }
    if (flyMin !== Infinity) {
      min.bfly25d = flyMin;
      max.bfly25d = flyMax;
    }

    return {
      current: latest,
      atmRank: atmStats.rank,
      atmPercentile: atmStats.percentile,
      rrRank: rrStats.rank,
      rrPercentile: rrStats.percentile,
      flyRank: flyStats.rank,
      flyPercentile: flyStats.percentile,
      min,
      max,
      series,
    };
  }
}
