// ── Deribit ────────────────────────────────────────────────────────
export const DERIBIT_WS_URL = 'wss://www.deribit.com/ws/api/v2';
export const DERIBIT_REST_BASE_URL = 'https://www.deribit.com';
export const DERIBIT_GET_BLOCK_RFQ_TRADES = '/api/v2/public/get_block_rfq_trades';

// ── OKX ───────────────────────────────────────────────────────────
export const OKX_WS_URL = 'wss://ws.okx.com:8443/ws/v5/public';
export const OKX_REST_BASE_URL = 'https://www.okx.com';
export const OKX_INSTRUMENTS = '/api/v5/public/instruments';
export const OKX_TICKERS = '/api/v5/market/tickers';
export const OKX_OPT_SUMMARY = '/api/v5/public/opt-summary';
export const OKX_OPEN_INTEREST = '/api/v5/public/open-interest';
export const OKX_MARK_PRICE = '/api/v5/public/mark-price';
export const OKX_RFQ_PUBLIC_TRADES = '/api/v5/rfq/public-trades';
export const OKX_INSTRUMENT_FAMILY_TRADES = '/api/v5/market/option/instrument-family-trades';

// ── Bybit ─────────────────────────────────────────────────────────
export const BYBIT_WS_URL = 'wss://stream.bybit.com/v5/public/option';
export const BYBIT_RFQ_WS_URL = 'wss://stream.bybit.com/v5/public/rfq';
export const BYBIT_REST_BASE_URL = 'https://api.bybit.com';
export const BYBIT_INSTRUMENTS_INFO = '/v5/market/instruments-info';
export const BYBIT_TICKERS = '/v5/market/tickers';
export const BYBIT_SYSTEM_STATUS = '/v5/system/status';
export const BYBIT_RECENT_TRADE = '/v5/market/recent-trade';

// ── Binance ───────────────────────────────────────────────────────
export const BINANCE_OPTIONS_WS_URL = 'wss://fstream.binance.com/public/stream';
export const BINANCE_MARK_WS_URL = 'wss://fstream.binance.com/market/stream';
export const BINANCE_REST_BASE_URL = 'https://eapi.binance.com';
export const BINANCE_EXCHANGE_INFO = '/eapi/v1/exchangeInfo';
export const BINANCE_TICKER = '/eapi/v1/ticker';
export const BINANCE_TIME = '/eapi/v1/time';
export const BINANCE_BLOCK_TRADES = '/eapi/v1/blockTrades';

// ── Derive ────────────────────────────────────────────────────────
export const DERIVE_WS_URL = 'wss://api.lyra.finance/ws';
export const DERIVE_REST_BASE_URL = 'https://api.lyra.finance';
export const DERIVE_GET_TRADE_HISTORY = '/public/get_trade_history';
