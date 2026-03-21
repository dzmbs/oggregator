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

// ── WS protocol types — re-exported from @oggregator/protocol ─────

export type {
  WsSubscriptionRequest,
  SnapshotMeta,
  VenueFailure,
  ClientWsMessage,
  ServerWsMessage,
} from '@oggregator/protocol';
