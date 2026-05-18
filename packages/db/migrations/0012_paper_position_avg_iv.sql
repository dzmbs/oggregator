ALTER TABLE paper_positions
  ADD COLUMN IF NOT EXISTS avg_entry_iv NUMERIC(12, 6);

ALTER TABLE paper_trade_positions
  ADD COLUMN IF NOT EXISTS avg_entry_iv NUMERIC(12, 6);
