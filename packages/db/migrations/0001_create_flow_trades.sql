CREATE TABLE IF NOT EXISTS flow_trades (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trade_uid TEXT NOT NULL UNIQUE,
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
  legs JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS flow_trades_mode_trade_ts_idx ON flow_trades (mode, trade_ts DESC);
CREATE INDEX IF NOT EXISTS flow_trades_underlying_trade_ts_idx ON flow_trades (underlying, trade_ts DESC);
CREATE INDEX IF NOT EXISTS flow_trades_venue_trade_ts_idx ON flow_trades (venue, trade_ts DESC);
CREATE INDEX IF NOT EXISTS flow_trades_mode_underlying_trade_ts_idx ON flow_trades (mode, underlying, trade_ts DESC);
CREATE INDEX IF NOT EXISTS flow_trades_mode_venue_trade_ts_idx ON flow_trades (mode, venue, trade_ts DESC);
CREATE INDEX IF NOT EXISTS flow_trades_venue_underlying_trade_ts_idx ON flow_trades (venue, underlying, trade_ts DESC);
CREATE INDEX IF NOT EXISTS flow_trades_is_block_trade_ts_idx ON flow_trades (is_block, trade_ts DESC);
