// Types matching @oggregator/core enrichment output.
// Defined locally since the web package doesn't add @oggregator/core as a dependency.
// These must stay in sync with packages/core/src/core/enrichment.ts

export type VenueId = "deribit" | "okx" | "binance" | "bybit" | "derive";

export interface EstimatedFees {
  maker: number;
  taker: number;
}

export interface VenueQuote {
  bid:           number | null;
  ask:           number | null;
  mid:           number | null;
  bidSize:       number | null;
  askSize:       number | null;
  markIv:        number | null;
  bidIv:         number | null;
  askIv:         number | null;
  delta:         number | null;
  gamma:         number | null;
  theta:         number | null;
  vega:          number | null;
  spreadPct:     number | null;
  totalCost:     number | null;
  estimatedFees: EstimatedFees | null;
  openInterest:  number | null;
}

export interface EnrichedSide {
  venues:    Partial<Record<VenueId, VenueQuote>>;
  bestIv:    number | null;
  bestVenue: VenueId | null;
}

export interface EnrichedStrike {
  strike: number;
  call:   EnrichedSide;
  put:    EnrichedSide;
}

export interface IvSurfaceRow {
  expiry:   string;
  dte:      number;
  delta10p: number | null;
  delta25p: number | null;
  atm:      number | null;
  delta25c: number | null;
  delta10c: number | null;
}

export interface GexStrike {
  strike:         number;
  gexUsdMillions: number;
}

export type TermStructure = "contango" | "flat" | "backwardation";

export interface ChainStats {
  spotIndexUsd:    number | null;
  forwardPriceUsd: number | null;
  forwardBasisPct: number | null;
  atmStrike:       number | null;
  atmIv:           number | null;
  putCallOiRatio:  number | null;
  totalOiUsd:      number | null;
  skew25d:         number | null;
}

export interface EnrichedChainResponse {
  underlying: string;
  expiry:     string;
  dte:        number;
  stats:      ChainStats;
  strikes:    EnrichedStrike[];
  gex:        GexStrike[];
}

export interface IvSurfaceResponse {
  underlying:    string;
  surface:       IvSurfaceRow[];
  termStructure: TermStructure;
}

// ── WS protocol types ─────────────────────────────────────────────

export interface WsSubscriptionRequest {
  underlying: string;
  expiry:     string;
  venues:     VenueId[];
}

export interface SnapshotMeta {
  generatedAt: number;
  maxQuoteTs:  number;
  staleMs:     number;
}

export type WsConnectionState = "connecting" | "live" | "reconnecting" | "stale" | "error" | "closed";

export interface VenueFailure {
  venue:  VenueId;
  reason: string;
}

export type ServerWsMessage =
  | { type: "subscribed"; subscriptionId: string; request: WsSubscriptionRequest; serverTime: number; failedVenues?: VenueFailure[] }
  | { type: "snapshot";   subscriptionId: string; seq: number; request: WsSubscriptionRequest; meta: SnapshotMeta; data: EnrichedChainResponse }
  | { type: "status";     subscriptionId: string; venue: VenueId; state: "connected" | "polling" | "reconnecting" | "degraded" | "down"; ts: number; message?: string }
  | { type: "error";      subscriptionId: string | null; code: string; message: string; retryable: boolean };
