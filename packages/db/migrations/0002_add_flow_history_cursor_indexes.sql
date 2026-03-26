CREATE INDEX IF NOT EXISTS flow_trades_mode_cursor_idx
  ON flow_trades (mode, trade_ts DESC, trade_uid DESC);

CREATE INDEX IF NOT EXISTS flow_trades_mode_underlying_cursor_idx
  ON flow_trades (mode, underlying, trade_ts DESC, trade_uid DESC);

CREATE INDEX IF NOT EXISTS flow_trades_mode_underlying_venue_cursor_idx
  ON flow_trades (mode, underlying, venue, trade_ts DESC, trade_uid DESC);
