import type { TradeStreamState } from './types.js';

export function createTradeStreamState(): TradeStreamState {
  return {
    connected: false,
    lastMessageAt: null,
    lastTradeAt: null,
    lastStatusAt: null,
    reconnects: 0,
    errors: 0,
    seedTrades: 0,
  };
}

export function mergeTradeStreamState(
  current: TradeStreamState,
  patch: Partial<TradeStreamState>,
): TradeStreamState {
  return { ...current, ...patch };
}
