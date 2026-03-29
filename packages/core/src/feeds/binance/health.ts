import type { BinanceHealthExchangeInfo } from './types.js';

export function deriveBinanceHealth(
  serverTime: number | null,
  exchangeInfo: BinanceHealthExchangeInfo | null,
  error?: unknown,
): { status: 'connected' | 'degraded'; message: string } {
  if (error != null) {
    return {
      status: 'degraded',
      message: `rest probe failed: ${String(error)}`,
    };
  }

  const hasSymbols = exchangeInfo != null
    && (Array.isArray(exchangeInfo.optionSymbols) || Array.isArray(exchangeInfo.symbols));

  if (serverTime != null && hasSymbols) {
    return {
      status: 'connected',
      message: 'rest health ok',
    };
  }

  return {
    status: 'degraded',
    message: 'rest health incomplete',
  };
}
