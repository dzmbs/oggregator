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

// ── Coincall ────────────────────────────────────────────────────────
// Public WS still requires signed query params (code, uuid, ts, sign, apiKey) —
// every Coincall market channel (bsInfo, tOption, orderBook, kline, lastTrade)
// shares the same authenticated endpoint. See ws-client.ts for signing.
export const COINCALL_MARKET_WS_URL = 'wss://ws.coincall.com/options';
export const COINCALL_REST_BASE_URL = 'https://api.coincall.com';
export const COINCALL_INSTRUMENTS = '/open/option/getInstruments';
// Per-symbol "most recent trade" endpoint. The docs label it SIGNED but the
// endpoint is accessible unauthenticated — used only for bulk seeding.
export const COINCALL_LAST_TRADE = '/open/option/trade/lasttrade/v1';
export const COINCALL_CONFIG = '/open/public/config/v1';
export const COINCALL_TIME = '/time';

// ── Thalex ──────────────────────────────────────────────────────────
// Public market data requires no auth. Only private/* channels need a
// JWT signed with the account's RSA key. See:
//   https://thalex.com/docs/info.md  (section: Authentication)
// Testnet swap is https://testnet.thalex.com + wss://testnet.thalex.com.
export const THALEX_MARKET_WS_URL = 'wss://thalex.com/ws/api/v2';
export const THALEX_REST_URL = 'https://thalex.com/api/v2';
export const THALEX_INSTRUMENTS = '/public/instruments';
export const THALEX_SYSTEM_INFO = '/public/system_info';

// ── Gate.io ──────────────────────────────────────────────────────
// Public market data requires no auth. Testnet swaps the WS host for
// wss://ws-testnet.gate.com/v4/ws/options/usdt.
//   REST spec:  https://www.gate.com/docs/developers/apiv4/en/
//   WS spec:    https://www.gate.com/docs/developers/options/ws/en/
//   Model defs: https://github.com/gateio/gateapi-python/tree/master/docs
//
// Gate options are USDT-settled (linear). Only the USDT WS host is wired
// here — the inverse BTC host (op-ws.gateio.live/v4/ws/btc) is intentionally
// omitted because no aggregator code currently consumes inverse options.
export const GATEIO_OPTIONS_WS_URL = 'wss://op-ws.gateio.live/v4/ws/usdt';
export const GATEIO_REST_BASE_URL = 'https://api.gateio.ws';
export const GATEIO_OPTIONS_UNDERLYINGS = '/api/v4/options/underlyings';
export const GATEIO_OPTIONS_EXPIRATIONS = '/api/v4/options/expirations';
export const GATEIO_OPTIONS_CONTRACTS = '/api/v4/options/contracts';
export const GATEIO_OPTIONS_TICKERS = '/api/v4/options/tickers';
export const GATEIO_OPTIONS_UNDERLYING_TICKER = '/api/v4/options/underlying/tickers';
export const GATEIO_OPTIONS_ORDER_BOOK = '/api/v4/options/order_book';
export const GATEIO_OPTIONS_TRADES = '/api/v4/options/trades';
