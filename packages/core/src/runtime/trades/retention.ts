import { computeLiveTradeAmounts } from '../../trade-persistence.js';
import type { TradeEvent } from './types.js';

// Sized to hold meaningful history for sparse venues (e.g., Coincall) alongside
// busy ones (Deribit/OKX) without the busy stream evicting the sparse one within
// minutes. Periodic per-venue reseeds (see VenueStream.reseedIntervalMs) refresh
// historical slices; this cap bounds the total per-underlying memory footprint.
export const TRADE_RUNTIME_BUFFER_SIZE = 2000;

function dedupKey(trade: TradeEvent): string | null {
  return trade.tradeId == null ? null : `${trade.venue}:${trade.tradeId}`;
}

export function pushTradeEvents(
  buffer: TradeEvent[],
  trades: TradeEvent[],
  maxSize = TRADE_RUNTIME_BUFFER_SIZE,
): void {
  if (trades.length === 0) return;

  const existing = new Set<string>();
  for (const t of buffer) {
    const key = dedupKey(t);
    if (key != null) existing.add(key);
  }

  for (const t of trades) {
    const key = dedupKey(t);
    // Push trades without a stable id unconditionally — those venues (e.g. Bybit
    // when execId is absent) accept the duplication risk in exchange for live data.
    if (key != null && existing.has(key)) continue;
    if (key != null) existing.add(key);
    buffer.push(t);
  }

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
