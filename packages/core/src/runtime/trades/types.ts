import type WebSocket from 'ws';
import type { VenueId } from '../../types/common.js';

export interface TradeEvent {
  venue: VenueId;
  tradeId: string | null;
  instrument: string;
  underlying: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  iv: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  isBlock: boolean;
  timestamp: number;
}

export interface TradeRuntimeHealth {
  venue: VenueId;
  underlying: string;
  connected: boolean;
  lastMessageAt: number | null;
  lastTradeAt: number | null;
  lastStatusAt: number | null;
  reconnects: number;
  errors: number;
  seedTrades: number;
  bufferedTrades: number;
}

export interface TradeStreamState {
  connected: boolean;
  lastMessageAt: number | null;
  lastTradeAt: number | null;
  lastStatusAt: number | null;
  reconnects: number;
  errors: number;
  seedTrades: number;
}

export interface VenueStream {
  venue: VenueId;
  // Some venues (Coincall) require a freshly-signed URL per connect — a bare
  // string is stale after the first timestamped signature. Allow a thunk.
  url: string | (() => string);
  connect: (ws: WebSocket, underlying: string) => void;
  parse: (msg: unknown, underlying: string) => TradeEvent[];
  seed?: (underlying: string) => Promise<TradeEvent[]>;
  // Set on venues whose WS stream alone produces sparse history (e.g. Coincall
  // has per-symbol prints with no bulk history endpoint). The runtime invokes
  // `seed()` on this interval after startup; tradeId-based dedup in
  // pushTradeEvents prevents duplicates across reseeds.
  reseedIntervalMs?: number;
  startKeepalive?: (ws: WebSocket) => ReturnType<typeof setInterval>;
}
