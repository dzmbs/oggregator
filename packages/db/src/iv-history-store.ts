import { Pool } from 'pg';

const INSERT_BATCH_SIZE = 100;
export const DEFAULT_IV_HISTORY_SIZE_WARN_BYTES = 10 * 1024 * 1024 * 1024;

export type IvHistoryPointSource = 'live_surface' | 'deribit_dvol';

export interface PersistedIvHistoryPoint {
  underlying: string;
  tenorDays: 7 | 30 | 60 | 90;
  ts: Date;
  atmIv: number | null;
  rr25d: number | null;
  bfly25d: number | null;
  source: IvHistoryPointSource;
}

export interface IvHistoryLoadQuery {
  underlyings: string[];
  since: Date;
}

export interface IvHistoryStorageStats {
  enabled: boolean;
  bytes: number | null;
  thresholdBytes: number;
  warning: boolean;
}

export interface IvHistoryStore {
  readonly enabled: boolean;
  writeMany(points: PersistedIvHistoryPoint[]): Promise<void>;
  loadSince(query: IvHistoryLoadQuery): Promise<PersistedIvHistoryPoint[]>;
  getStorageStats(): Promise<IvHistoryStorageStats>;
  dispose(): Promise<void>;
}

export class NoopIvHistoryStore implements IvHistoryStore {
  readonly enabled = false;

  constructor(
    private readonly thresholdBytes: number = DEFAULT_IV_HISTORY_SIZE_WARN_BYTES,
  ) {}

  async writeMany(_points: PersistedIvHistoryPoint[]): Promise<void> {}

  async loadSince(_query: IvHistoryLoadQuery): Promise<PersistedIvHistoryPoint[]> {
    return [];
  }

  async getStorageStats(): Promise<IvHistoryStorageStats> {
    return {
      enabled: false,
      bytes: null,
      thresholdBytes: this.thresholdBytes,
      warning: false,
    };
  }

  async dispose(): Promise<void> {}
}

export class PostgresIvHistoryStore implements IvHistoryStore {
  readonly enabled = true;

  constructor(
    private readonly pool: Pool,
    private readonly thresholdBytes: number = DEFAULT_IV_HISTORY_SIZE_WARN_BYTES,
  ) {}

  static fromConnectionString(
    connectionString: string,
    thresholdBytes: number = DEFAULT_IV_HISTORY_SIZE_WARN_BYTES,
  ): PostgresIvHistoryStore {
    return new PostgresIvHistoryStore(new Pool({ connectionString }), thresholdBytes);
  }

  async writeMany(points: PersistedIvHistoryPoint[]): Promise<void> {
    if (points.length === 0) return;

    for (let index = 0; index < points.length; index += INSERT_BATCH_SIZE) {
      const batch = points.slice(index, index + INSERT_BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((point, batchIndex) => {
        const offset = batchIndex * 7;
        values.push(
          point.underlying.toUpperCase(),
          point.tenorDays,
          point.ts,
          point.atmIv,
          point.rr25d,
          point.bfly25d,
          point.source,
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
      });

      await this.pool.query(
        `INSERT INTO iv_history_points (
          underlying,
          tenor_days,
          ts,
          atm_iv,
          rr25d,
          bfly25d,
          source
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (underlying, tenor_days, ts) DO UPDATE SET
          atm_iv = EXCLUDED.atm_iv,
          rr25d = EXCLUDED.rr25d,
          bfly25d = EXCLUDED.bfly25d,
          source = EXCLUDED.source`,
        values,
      );
    }
  }

  async loadSince(query: IvHistoryLoadQuery): Promise<PersistedIvHistoryPoint[]> {
    if (query.underlyings.length === 0) return [];

    const result = await this.pool.query<IvHistoryRow>(
      `SELECT
        underlying,
        tenor_days,
        ts,
        atm_iv,
        rr25d,
        bfly25d,
        source
      FROM iv_history_points
      WHERE underlying = ANY($1::text[])
        AND ts >= $2
      ORDER BY underlying ASC, tenor_days ASC, ts ASC`,
      [query.underlyings.map((u) => u.toUpperCase()), query.since],
    );

    return result.rows.map(mapRow);
  }

  async getStorageStats(): Promise<IvHistoryStorageStats> {
    const result = await this.pool.query<{ bytes: string | number | null }>(
      "SELECT pg_total_relation_size('iv_history_points') AS bytes",
    );
    const bytes = toNumber(result.rows[0]?.bytes) ?? 0;
    return {
      enabled: true,
      bytes,
      thresholdBytes: this.thresholdBytes,
      warning: bytes >= this.thresholdBytes,
    };
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}

interface IvHistoryRow {
  underlying: string;
  tenor_days: number;
  ts: Date;
  atm_iv: number | string | null;
  rr25d: number | string | null;
  bfly25d: number | string | null;
  source: IvHistoryPointSource;
}

function mapRow(row: IvHistoryRow): PersistedIvHistoryPoint {
  return {
    underlying: row.underlying,
    tenorDays: row.tenor_days as PersistedIvHistoryPoint['tenorDays'],
    ts: row.ts,
    atmIv: toNumber(row.atm_iv),
    rr25d: toNumber(row.rr25d),
    bfly25d: toNumber(row.bfly25d),
    source: row.source,
  };
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
