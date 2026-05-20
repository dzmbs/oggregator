import { Pool } from 'pg';

export type RegimeLabel = 'bull' | 'neutral' | 'stress';

export interface PersistedRegimeModel {
  underlying: string;
  fittedAt: Date;
  observationCount: number;
  nStates: number;
  hmm: unknown;
  standardization: unknown;
  stateLabels: RegimeLabel[];
}

export interface PersistedRegimeObservation {
  underlying: string;
  ts: Date;
  features: number[];
  posterior: number[] | null;
  dominant: RegimeLabel | null;
}

export interface RegimeObservationLoadQuery {
  underlyings: string[];
  since: Date;
}

export interface RegimeStore {
  readonly enabled: boolean;
  loadModel(underlying: string): Promise<PersistedRegimeModel | null>;
  saveModel(model: PersistedRegimeModel): Promise<void>;
  loadObservationsSince(query: RegimeObservationLoadQuery): Promise<PersistedRegimeObservation[]>;
  saveObservation(row: PersistedRegimeObservation): Promise<void>;
  dispose(): Promise<void>;
}

export class NoopRegimeStore implements RegimeStore {
  readonly enabled = false;
  async loadModel(): Promise<PersistedRegimeModel | null> {
    return null;
  }
  async saveModel(): Promise<void> {}
  async loadObservationsSince(): Promise<PersistedRegimeObservation[]> {
    return [];
  }
  async saveObservation(): Promise<void> {}
  async dispose(): Promise<void> {}
}

export class PostgresRegimeStore implements RegimeStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresRegimeStore {
    return new PostgresRegimeStore(new Pool({ connectionString }));
  }

  async loadModel(underlying: string): Promise<PersistedRegimeModel | null> {
    const result = await this.pool.query<RegimeModelRow>(
      `SELECT underlying, fitted_at, observation_count, n_states, hmm, standardization, state_labels
       FROM regime_models
       WHERE underlying = $1`,
      [underlying.toUpperCase()],
    );
    const row = result.rows[0];
    if (!row) return null;
    return mapModelRow(row);
  }

  async saveModel(model: PersistedRegimeModel): Promise<void> {
    await this.pool.query(
      `INSERT INTO regime_models (
        underlying, fitted_at, observation_count, n_states, hmm, standardization, state_labels, updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, now())
      ON CONFLICT (underlying) DO UPDATE SET
        fitted_at = EXCLUDED.fitted_at,
        observation_count = EXCLUDED.observation_count,
        n_states = EXCLUDED.n_states,
        hmm = EXCLUDED.hmm,
        standardization = EXCLUDED.standardization,
        state_labels = EXCLUDED.state_labels,
        updated_at = now()`,
      [
        model.underlying.toUpperCase(),
        model.fittedAt,
        model.observationCount,
        model.nStates,
        JSON.stringify(model.hmm),
        JSON.stringify(model.standardization),
        JSON.stringify(model.stateLabels),
      ],
    );
  }

  async loadObservationsSince(
    query: RegimeObservationLoadQuery,
  ): Promise<PersistedRegimeObservation[]> {
    if (query.underlyings.length === 0) return [];
    const result = await this.pool.query<RegimeObservationRow>(
      `SELECT underlying, ts, features, posterior, dominant
       FROM regime_observations
       WHERE underlying = ANY($1::text[])
         AND ts >= $2
       ORDER BY underlying ASC, ts ASC`,
      [query.underlyings.map((u) => u.toUpperCase()), query.since],
    );
    return result.rows.map(mapObservationRow);
  }

  async saveObservation(row: PersistedRegimeObservation): Promise<void> {
    await this.pool.query(
      `INSERT INTO regime_observations (underlying, ts, features, posterior, dominant)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
       ON CONFLICT (underlying, ts) DO UPDATE SET
         features = EXCLUDED.features,
         posterior = EXCLUDED.posterior,
         dominant = EXCLUDED.dominant`,
      [
        row.underlying.toUpperCase(),
        row.ts,
        JSON.stringify(row.features),
        row.posterior ? JSON.stringify(row.posterior) : null,
        row.dominant,
      ],
    );
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}

interface RegimeModelRow {
  underlying: string;
  fitted_at: Date;
  observation_count: number;
  n_states: number;
  hmm: unknown;
  standardization: unknown;
  state_labels: RegimeLabel[];
}

interface RegimeObservationRow {
  underlying: string;
  ts: Date;
  features: number[];
  posterior: number[] | null;
  dominant: RegimeLabel | null;
}

function mapModelRow(row: RegimeModelRow): PersistedRegimeModel {
  return {
    underlying: row.underlying,
    fittedAt: row.fitted_at,
    observationCount: row.observation_count,
    nStates: row.n_states,
    hmm: row.hmm,
    standardization: row.standardization,
    stateLabels: row.state_labels,
  };
}

function mapObservationRow(row: RegimeObservationRow): PersistedRegimeObservation {
  return {
    underlying: row.underlying,
    ts: row.ts,
    features: row.features,
    posterior: row.posterior,
    dominant: row.dominant,
  };
}
