ALTER TABLE paper_fills
  ADD COLUMN IF NOT EXISTS requested_quantity NUMERIC(28, 8),
  ADD COLUMN IF NOT EXISTS slippage_usd NUMERIC(28, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partial_fill BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE paper_fills
  SET requested_quantity = quantity
  WHERE requested_quantity IS NULL;

ALTER TABLE paper_fills
  ALTER COLUMN requested_quantity SET NOT NULL;
