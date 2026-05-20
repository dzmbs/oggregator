CREATE TABLE IF NOT EXISTS paper_accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  initial_cash_usd NUMERIC(28, 8) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paper_orders (
  id TEXT PRIMARY KEY,
  client_order_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES paper_accounts (id),
  mode TEXT NOT NULL CHECK (mode IN ('paper', 'live')),
  kind TEXT NOT NULL CHECK (kind IN ('market')),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'filled', 'rejected', 'cancelled')),
  legs JSONB NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  filled_at TIMESTAMPTZ,
  rejection_reason TEXT,
  total_debit_usd NUMERIC(28, 8)
);

CREATE INDEX IF NOT EXISTS paper_orders_account_submitted_idx
  ON paper_orders (account_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS paper_fills (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES paper_orders (id),
  leg_index INTEGER NOT NULL,
  venue TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  option_right TEXT NOT NULL CHECK (option_right IN ('call', 'put')),
  underlying TEXT NOT NULL,
  expiry DATE NOT NULL,
  strike NUMERIC(28, 8) NOT NULL,
  quantity NUMERIC(28, 8) NOT NULL,
  price_usd NUMERIC(28, 8) NOT NULL,
  fees_usd NUMERIC(28, 8) NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('paper', 'live')),
  filled_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS paper_fills_order_idx ON paper_fills (order_id);
CREATE INDEX IF NOT EXISTS paper_fills_filled_at_idx ON paper_fills (filled_at DESC);

CREATE TABLE IF NOT EXISTS paper_positions (
  account_id TEXT NOT NULL REFERENCES paper_accounts (id),
  underlying TEXT NOT NULL,
  expiry DATE NOT NULL,
  strike NUMERIC(28, 8) NOT NULL,
  option_right TEXT NOT NULL CHECK (option_right IN ('call', 'put')),
  net_quantity NUMERIC(28, 8) NOT NULL,
  avg_entry_price_usd NUMERIC(28, 8) NOT NULL,
  realized_pnl_usd NUMERIC(28, 8) NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ NOT NULL,
  last_fill_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (account_id, underlying, expiry, strike, option_right)
);

CREATE INDEX IF NOT EXISTS paper_positions_account_idx ON paper_positions (account_id);

CREATE TABLE IF NOT EXISTS paper_cash_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES paper_accounts (id),
  delta_usd NUMERIC(28, 8) NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('fill', 'fee', 'init', 'adjustment')),
  ref_id TEXT,
  ts TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS paper_cash_ledger_account_ts_idx
  ON paper_cash_ledger (account_id, ts DESC);
