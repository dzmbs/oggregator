-- Regime detector persistence: HMM model + standardization params per
-- underlying, plus the rolling observation buffer with per-tick posterior.
--
-- ~26k observation rows per underlying at the 5-minute snapshot cadence over
-- a 90-day rolling window — small enough that a plain table with btree
-- indexes outperforms partitioning. JSONB blobs use lz4 (PG ≥ 14) since the
-- features and posterior arrays are short and lz4 decompresses faster than
-- pglz.

CREATE TABLE IF NOT EXISTS regime_models (
  underlying TEXT PRIMARY KEY,
  fitted_at TIMESTAMPTZ NOT NULL,
  observation_count INTEGER NOT NULL,
  n_states SMALLINT NOT NULL,
  hmm JSONB COMPRESSION lz4 NOT NULL,
  standardization JSONB COMPRESSION lz4 NOT NULL,
  state_labels JSONB COMPRESSION lz4 NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS regime_observations (
  underlying TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  features JSONB COMPRESSION lz4 NOT NULL,
  posterior JSONB COMPRESSION lz4,
  dominant TEXT CHECK (dominant IN ('bull', 'neutral', 'stress')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (underlying, ts)
);

CREATE INDEX IF NOT EXISTS regime_observations_lookup_idx
  ON regime_observations (underlying, ts DESC);
