export { buildComparisonChain } from './aggregator.js';
export { registerAdapter, getAdapter, getAllAdapters, getRegisteredVenues } from './registry.js';
export {
  VenueSubscriptionCoordinator,
  type VenueSubscriptionHandle,
  type VenueSubscriptionListener,
} from './subscription-coordinator.js';
export { parseOptionSymbol, formatOptionSymbol, strikeKey } from './symbol.js';
export type { CanonicalOption } from './symbol.js';

export type {
  OptionGreeks,
  EstimatedFees,
  PremiumValue,
  NormalizedQuote,
  NormalizedOptionContract,
  ChainRequest,
  VenueOptionChain,
  ComparisonRow,
  ComparisonChain,
  VenueDelta,
  VenueConnectionState,
  VenueStatus,
  WsSubscriptionRequest,
  SnapshotMeta,
  VenueFailure,
  ServerWsMessage,
  ClientWsMessage,
} from './types.js';

export { ClientWsMessageSchema, ServerWsMessageSchema } from '@oggregator/protocol';

export { EMPTY_GREEKS } from './types.js';

export {
  buildEnrichedChain,
  computeIvSurface,
  computeTermStructure,
  computeDte,
  enrichComparisonRow,
  computeChainStats,
  computeGex,
} from './enrichment.js';

export type {
  EnrichedChainResponse,
  EnrichedStrike,
  EnrichedSide,
  VenueQuote,
  IvSurfaceRow,
  GexStrike,
  ChainStats,
  TermStructure,
} from './enrichment.js';

export {
  ChainRuntime,
  ChainRuntimeRegistry,
  ChainProjection,
  VenueHealthManager,
  type ChainRuntimeDeltaEvent,
  type ChainRuntimeEvent,
  type ChainRuntimeListener,
  type ChainRuntimeOptions,
  type ChainRuntimeSnapshotEvent,
  type ChainRuntimeStatusEvent,
  type ChainProjectionDelta,
} from '../runtime/chain/index.js';

export {
  SpotRuntime,
  type SpotRuntimeEvent,
  type SpotRuntimeHealth,
  type SpotRuntimeListener,
  type SpotRuntimeOptions,
  type SpotRuntimeSnapshotEvent,
  type SpotSnapshot,
} from '../runtime/spot/index.js';

export {
  TradeRuntime,
  getDeribitTradeCurrency,
  getDeribitUnderlyingFromInstrument,
  normalizeTradeUnderlying,
  type TradeEvent,
  type TradeRuntimeHealth,
} from '../runtime/trades/index.js';

export {
  BlockTradeRuntime,
  type BlockTradeEvent,
  type BlockTradeLeg,
  type BlockTradeRuntimeHealth,
} from '../runtime/block-trades/index.js';
