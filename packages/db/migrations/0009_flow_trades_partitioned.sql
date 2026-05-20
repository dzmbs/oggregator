-- Convert flow_trades to a RANGE-partitioned table on trade_ts.
-- Safe to drop+recreate: the prior table is empty in every environment.
-- Goals:
--   * lz4 compression on JSONB columns (raw, legs) — ~10–20% smaller than pglz, faster
--   * monthly partitions so retention can be done by DROP PARTITION (no per-row DELETE)
--   * helper function callable from the ingest worker to keep forward partitions warm

DROP TABLE IF EXISTS flow_trades CASCADE;

CREATE TABLE flow_trades (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  trade_uid TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('live', 'institutional')),
  venue TEXT NOT NULL,
  underlying TEXT NOT NULL,
  instrument_name TEXT NOT NULL,
  trade_ts TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  direction TEXT NOT NULL CHECK (direction IN ('buy', 'sell')),
  contracts NUMERIC(28, 8) NOT NULL,
  price NUMERIC(28, 8),
  premium_usd NUMERIC(28, 8),
  notional_usd NUMERIC(28, 8),
  reference_price_usd NUMERIC(28, 8),
  expiry DATE,
  strike NUMERIC(28, 8),
  option_type TEXT CHECK (option_type IN ('call', 'put')),
  iv NUMERIC(28, 8),
  mark_price NUMERIC(28, 8),
  is_block BOOLEAN NOT NULL DEFAULT FALSE,
  strategy_label TEXT,
  legs JSONB COMPRESSION lz4,
  raw JSONB COMPRESSION lz4 NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, trade_ts),
  UNIQUE (trade_uid, trade_ts)
) PARTITION BY RANGE (trade_ts);

CREATE INDEX flow_trades_mode_trade_ts_idx
  ON flow_trades (mode, trade_ts DESC);
CREATE INDEX flow_trades_underlying_trade_ts_idx
  ON flow_trades (underlying, trade_ts DESC);
CREATE INDEX flow_trades_venue_trade_ts_idx
  ON flow_trades (venue, trade_ts DESC);
CREATE INDEX flow_trades_mode_underlying_trade_ts_idx
  ON flow_trades (mode, underlying, trade_ts DESC);
CREATE INDEX flow_trades_mode_venue_trade_ts_idx
  ON flow_trades (mode, venue, trade_ts DESC);
CREATE INDEX flow_trades_venue_underlying_trade_ts_idx
  ON flow_trades (venue, underlying, trade_ts DESC);
CREATE INDEX flow_trades_is_block_trade_ts_idx
  ON flow_trades (is_block, trade_ts DESC);
CREATE INDEX flow_trades_mode_cursor_idx
  ON flow_trades (mode, trade_ts DESC, trade_uid DESC);
CREATE INDEX flow_trades_mode_underlying_cursor_idx
  ON flow_trades (mode, underlying, trade_ts DESC, trade_uid DESC);
CREATE INDEX flow_trades_mode_underlying_venue_cursor_idx
  ON flow_trades (mode, underlying, venue, trade_ts DESC, trade_uid DESC);

-- Idempotent helper: create one monthly partition aligned to date_trunc('month', target).
CREATE OR REPLACE FUNCTION flow_trades_ensure_month_partition(target TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  start_ts  TIMESTAMPTZ := date_trunc('month', target);
  end_ts    TIMESTAMPTZ := start_ts + INTERVAL '1 month';
  part_name TEXT        := 'flow_trades_' || to_char(start_ts, 'YYYYMM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF flow_trades FOR VALUES FROM (%L) TO (%L)',
    part_name, start_ts, end_ts
  );
END;
$$;

-- Pre-create 6 forward months so ingest can start immediately and survive a missed
-- maintenance run for half a year. The ingest worker also tops this up on a timer.
DO $$
DECLARE
  i INT;
BEGIN
  FOR i IN 0..5 LOOP
    PERFORM flow_trades_ensure_month_partition(now() + (i || ' months')::INTERVAL);
  END LOOP;
END $$;

-- Retention is intentionally manual for now. To drop trades older than 90 days:
--   DROP TABLE flow_trades_<YYYYMM>;
-- (The DROP is O(1) — far cheaper than DELETE on a non-partitioned table.)
