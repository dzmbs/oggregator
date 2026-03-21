import type { DataSource, OptionRight, VenueId } from '../types/common.js';

// ── Greeks ────────────────────────────────────────────────────────

export interface OptionGreeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  markIv: number | null;
  bidIv: number | null;
  askIv: number | null;
}

export const EMPTY_GREEKS: OptionGreeks = {
  delta: null,
  gamma: null,
  theta: null,
  vega: null,
  rho: null,
  markIv: null,
  bidIv: null,
  askIv: null,
};

// ── Normalized option data ────────────────────────────────────────

export interface PremiumValue {
  raw: number | null;
  rawCurrency: string;
  usd: number | null;
}

export interface EstimatedFees {
  maker: number;
  taker: number;
}

export interface NormalizedQuote {
  bid: PremiumValue;
  ask: PremiumValue;
  mark: PremiumValue;
  last: PremiumValue | null;
  bidSize: number | null;
  askSize: number | null;
  underlyingPriceUsd: number | null;
  indexPriceUsd: number | null;
  volume24h: number | null;
  openInterest: number | null;
  estimatedFees: EstimatedFees | null;
  timestamp: number | null;
  source: DataSource;
}

export interface NormalizedOptionContract {
  venue: VenueId;
  symbol: string;
  exchangeSymbol: string;
  base: string;
  settle: string;
  expiry: string;
  strike: number;
  right: OptionRight;
  inverse: boolean;
  contractSize: number | null;
  tickSize: number | null;
  minQty: number | null;
  makerFee: number | null;
  takerFee: number | null;
  greeks: OptionGreeks;
  quote: NormalizedQuote;
}

// ── Chain types ───────────────────────────────────────────────────

export interface ChainRequest {
  underlying: string;
  expiry: string;
  venues?: VenueId[];
}

export interface VenueOptionChain {
  venue: VenueId;
  underlying: string;
  expiry: string;
  asOf: number;
  contracts: Record<string, NormalizedOptionContract>;
}

export interface ComparisonRow {
  strike: number;
  call: Partial<Record<VenueId, NormalizedOptionContract>>;
  put: Partial<Record<VenueId, NormalizedOptionContract>>;
}

export interface ComparisonChain {
  underlying: string;
  expiry: string;
  asOf: number;
  rows: ComparisonRow[];
}

// ── Streaming types ───────────────────────────────────────────────

export interface VenueDelta {
  venue: VenueId;
  symbol: string;
  ts: number;
  quote?: Partial<NormalizedQuote>;
  greeks?: Partial<OptionGreeks>;
}

export type VenueConnectionState = 'connected' | 'polling' | 'reconnecting' | 'degraded' | 'down';

export interface VenueStatus {
  venue: VenueId;
  state: VenueConnectionState;
  ts: number;
  message?: string;
}

// ── WS protocol types ─────────────────────────────────────────────

export interface WsSubscriptionRequest {
  underlying: string;
  expiry: string;
  venues: VenueId[];
}

export interface SnapshotMeta {
  generatedAt: number;
  maxQuoteTs: number;
  staleMs: number;
}

export type ClientWsMessage =
  | { type: 'subscribe'; subscriptionId: string; request: WsSubscriptionRequest }
  | { type: 'unsubscribe' };

export interface VenueFailure {
  venue: VenueId;
  reason: string;
}

export type ServerWsMessage =
  | { type: 'subscribed'; subscriptionId: string; request: WsSubscriptionRequest; serverTime: number; failedVenues?: VenueFailure[] }
  | { type: 'snapshot'; subscriptionId: string; seq: number; request: WsSubscriptionRequest; meta: SnapshotMeta; data: unknown }
  | { type: 'status'; subscriptionId: string; venue: VenueId; state: VenueConnectionState; ts: number; message?: string }
  | { type: 'error'; subscriptionId: string | null; code: string; message: string; retryable: boolean };
