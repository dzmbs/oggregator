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
  url: string;
  connect: (ws: WebSocket, underlying: string) => void;
  parse: (msg: unknown, underlying: string) => TradeEvent[];
  seed?: (underlying: string) => Promise<TradeEvent[]>;
  startKeepalive?: (ws: WebSocket) => ReturnType<typeof setInterval>;
}
