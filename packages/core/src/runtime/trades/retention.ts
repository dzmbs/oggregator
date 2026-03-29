import { computeLiveTradeAmounts } from '../../trade-persistence.js';
import type { TradeEvent } from './types.js';

export const TRADE_RUNTIME_BUFFER_SIZE = 500;

export function pushTradeEvents(
  buffer: TradeEvent[],
  trades: TradeEvent[],
  maxSize = TRADE_RUNTIME_BUFFER_SIZE,
): void {
  buffer.push(...trades);
  buffer.sort((left, right) => left.timestamp - right.timestamp);
  if (buffer.length > maxSize) {
    buffer.splice(0, buffer.length - maxSize);
  }
}

export function filterTradesByMinNotional(trades: TradeEvent[], minNotional: number): TradeEvent[] {
  if (minNotional <= 0) return trades;
  return trades.filter((trade) => {
    const amounts = computeLiveTradeAmounts(trade, trade.indexPrice);
    return (amounts.notionalUsd ?? 0) >= minNotional;
  });
}
