-- The flow history API only uses cursor scans keyed by mode, optionally narrowed
-- by underlying and filtered by venue. The wider non-cursor indexes duplicate
-- those access paths while consuming most of the storage quota.

DROP INDEX IF EXISTS flow_trades_mode_trade_ts_idx;
DROP INDEX IF EXISTS flow_trades_underlying_trade_ts_idx;
DROP INDEX IF EXISTS flow_trades_venue_trade_ts_idx;
DROP INDEX IF EXISTS flow_trades_mode_underlying_trade_ts_idx;
DROP INDEX IF EXISTS flow_trades_mode_venue_trade_ts_idx;
DROP INDEX IF EXISTS flow_trades_venue_underlying_trade_ts_idx;
DROP INDEX IF EXISTS flow_trades_is_block_trade_ts_idx;
