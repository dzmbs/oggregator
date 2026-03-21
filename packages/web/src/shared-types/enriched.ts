// Enrichment types mirrored from packages/core/src/core/enrichment.ts.
// Web doesn't depend on core directly — these must stay in sync manually.
// WS protocol types come from @oggregator/protocol (shared, not duplicated).

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

export type {
  WsSubscriptionRequest,
  SnapshotMeta,
  VenueFailure,
  ServerWsMessage,
  WsConnectionState,
  VenueConnectionState,
} from '@oggregator/protocol';
