-- Auto-settlement of expired paper options.
-- Records the spot price used at settlement so re-runs are idempotent.
CREATE TABLE IF NOT EXISTS paper_settlement_prices (
  underlying  TEXT NOT NULL,
  expiry      DATE NOT NULL,
  price_usd   NUMERIC(28, 8) NOT NULL,
  source      TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (underlying, expiry)
);

-- Speeds up the per-tick scan for open positions whose expiry has passed.
CREATE INDEX IF NOT EXISTS paper_positions_expiry_open_idx
  ON paper_positions (expiry)
  WHERE net_quantity <> 0;

-- Allow synthetic settlement fills.
ALTER TABLE paper_fills
  DROP CONSTRAINT IF EXISTS paper_fills_source_check;
ALTER TABLE paper_fills
  ADD CONSTRAINT paper_fills_source_check
  CHECK (source IN ('paper', 'live', 'settlement'));

-- Allow the synthetic order linking the settlement fill to its trade row.
ALTER TABLE paper_trade_orders
  DROP CONSTRAINT IF EXISTS paper_trade_orders_intent_check;
ALTER TABLE paper_trade_orders
  ADD CONSTRAINT paper_trade_orders_intent_check
  CHECK (intent IN ('open', 'add', 'reduce', 'close', 'roll', 'settlement'));
