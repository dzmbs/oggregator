ALTER TABLE paper_fills
  ADD COLUMN IF NOT EXISTS benchmark_bid_usd NUMERIC(28, 8),
  ADD COLUMN IF NOT EXISTS benchmark_ask_usd NUMERIC(28, 8),
  ADD COLUMN IF NOT EXISTS benchmark_mid_usd NUMERIC(28, 8),
  ADD COLUMN IF NOT EXISTS underlying_spot_usd NUMERIC(28, 8);

CREATE TABLE IF NOT EXISTS paper_trades (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES paper_accounts (id),
  underlying TEXT NOT NULL,
  label TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  entry_spot_usd NUMERIC(28, 8),
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paper_trades_account_opened_idx
  ON paper_trades (account_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS paper_trade_orders (
  trade_id TEXT NOT NULL REFERENCES paper_trades (id),
  order_id TEXT NOT NULL REFERENCES paper_orders (id),
  intent TEXT NOT NULL CHECK (intent IN ('open', 'add', 'reduce', 'close', 'roll')),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (trade_id, order_id)
);

CREATE INDEX IF NOT EXISTS paper_trade_orders_order_idx
  ON paper_trade_orders (order_id);

CREATE TABLE IF NOT EXISTS paper_trade_positions (
  trade_id TEXT NOT NULL REFERENCES paper_trades (id),
  underlying TEXT NOT NULL,
  expiry DATE NOT NULL,
  strike NUMERIC(28, 8) NOT NULL,
  option_right TEXT NOT NULL CHECK (option_right IN ('call', 'put')),
  net_quantity NUMERIC(28, 8) NOT NULL,
  avg_entry_price_usd NUMERIC(28, 8) NOT NULL,
  realized_pnl_usd NUMERIC(28, 8) NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ NOT NULL,
  last_fill_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (trade_id, underlying, expiry, strike, option_right)
);

CREATE INDEX IF NOT EXISTS paper_trade_positions_trade_idx
  ON paper_trade_positions (trade_id);

CREATE TABLE IF NOT EXISTS paper_trade_notes (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL REFERENCES paper_trades (id),
  kind TEXT NOT NULL CHECK (kind IN ('thesis', 'invalidation', 'review', 'note')),
  content TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS paper_trade_notes_trade_created_idx
  ON paper_trade_notes (trade_id, created_at DESC);

CREATE TABLE IF NOT EXISTS paper_trade_activity (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES paper_accounts (id),
  trade_id TEXT REFERENCES paper_trades (id),
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload JSONB,
  ts TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS paper_trade_activity_account_ts_idx
  ON paper_trade_activity (account_id, ts DESC);

CREATE INDEX IF NOT EXISTS paper_trade_activity_trade_ts_idx
  ON paper_trade_activity (trade_id, ts DESC);
