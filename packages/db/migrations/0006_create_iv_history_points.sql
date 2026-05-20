CREATE TABLE IF NOT EXISTS iv_history_points (
  underlying TEXT NOT NULL,
  tenor_days SMALLINT NOT NULL CHECK (tenor_days IN (7, 30, 60, 90)),
  ts TIMESTAMPTZ NOT NULL,
  atm_iv DOUBLE PRECISION,
  rr25d DOUBLE PRECISION,
  bfly25d DOUBLE PRECISION,
  source TEXT NOT NULL CHECK (source IN ('live_surface', 'deribit_dvol')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (underlying, tenor_days, ts)
);

CREATE INDEX IF NOT EXISTS iv_history_points_lookup_idx
  ON iv_history_points (underlying, tenor_days, ts DESC);
