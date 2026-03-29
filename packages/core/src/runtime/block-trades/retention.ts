import type { BlockTradeEvent } from './types.js';

export const BLOCK_TRADE_RUNTIME_BUFFER_SIZE = 300;
export const BLOCK_TRADE_SEEN_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface InsertBlockTradesResult {
  inserted: BlockTradeEvent[];
  latestByVenue: Map<BlockTradeEvent['venue'], number>;
}

export function insertBlockTrades(
  buffer: BlockTradeEvent[],
  seenTradeTimestamps: Map<string, number>,
  trades: BlockTradeEvent[],
  maxSize = BLOCK_TRADE_RUNTIME_BUFFER_SIZE,
): InsertBlockTradesResult {
  const inserted: BlockTradeEvent[] = [];

  for (const trade of trades) {
    const key = `${trade.venue}:${trade.tradeId}`;
    if (seenTradeTimestamps.has(key)) continue;

    seenTradeTimestamps.set(key, trade.timestamp);
    buffer.push(trade);
    inserted.push(trade);
  }

  buffer.sort((left, right) => right.timestamp - left.timestamp);
  if (buffer.length > maxSize) {
    buffer.splice(maxSize);
  }

  pruneSeenBlockTrades(buffer, seenTradeTimestamps);

  const latestByVenue = new Map<BlockTradeEvent['venue'], number>();
  for (const trade of inserted) {
    const current = latestByVenue.get(trade.venue);
    if (current == null || trade.timestamp > current) {
      latestByVenue.set(trade.venue, trade.timestamp);
    }
  }

  return { inserted, latestByVenue };
}

export function pruneSeenBlockTrades(
  buffer: BlockTradeEvent[],
  seenTradeTimestamps: Map<string, number>,
  retentionMs = BLOCK_TRADE_SEEN_RETENTION_MS,
): void {
  const newestBufferedTs = buffer[0]?.timestamp;
  if (newestBufferedTs == null) return;

  const minTimestamp = newestBufferedTs - retentionMs;
  for (const [key, timestamp] of seenTradeTimestamps) {
    if (timestamp < minTimestamp) {
      seenTradeTimestamps.delete(key);
    }
  }
}
