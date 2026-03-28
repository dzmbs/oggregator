// types/common — shared primitives
export type { VenueId, OptionRight, DataSource } from './types/common.js';
export { VENUE_IDS } from './types/common.js';

// core — canonical types, aggregator, registry, symbol utils
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
} from './core/types.js';
export { EMPTY_GREEKS } from './core/types.js';
export { ClientWsMessageSchema, ServerWsMessageSchema } from '@oggregator/protocol';

export { buildComparisonChain } from './core/aggregator.js';
export { registerAdapter, getAdapter, getAllAdapters, getRegisteredVenues } from './core/registry.js';
export { parseOptionSymbol, formatOptionSymbol, strikeKey } from './core/symbol.js';
export type { CanonicalOption } from './core/symbol.js';

export {
  buildEnrichedChain,
  computeIvSurface,
  computeTermStructure,
  computeDte,
  enrichComparisonRow,
  computeChainStats,
} from './core/enrichment.js';

export type {
  EnrichedChainResponse,
  EnrichedStrike,
  EnrichedSide,
  VenueQuote,
  IvSurfaceRow,
  GexStrike,
  ChainStats,
  TermStructure,
} from './core/enrichment.js';

// feeds/shared — adapter interfaces
export type { OptionVenueAdapter, VenueCapabilities, StreamHandlers } from './feeds/shared/types.js';
export { BaseAdapter } from './feeds/shared/base.js';

// services
export { DvolService, type DvolSnapshot, type DvolCandle, type HvPoint } from './services/dvol.js';
export { SpotService, type SpotSnapshot } from './services/spot.js';
export {
  FlowService,
  getDeribitTradeCurrency,
  getDeribitUnderlyingFromInstrument,
  normalizeTradeUnderlying,
  type TradeEvent,
} from './services/flow.js';
export { BlockFlowService, type BlockTradeEvent, type BlockTradeLeg } from './services/block-flow.js';
export {
  buildBlockTradeUid,
  buildLiveTradeUid,
  computeBlockTradeAmounts,
  computeLiveTradeAmounts,
  getVenueContractMultiplier,
  isInversePremiumVenue,
  parseTradeInstrument,
  type ParsedTradeInstrument,
  type TradeAmounts,
} from './services/trade-persistence.js';

// feeds — venue adapters
export { DeribitWsAdapter } from './feeds/deribit/index.js';
export { OkxWsAdapter } from './feeds/okx/index.js';
export { BinanceWsAdapter } from './feeds/binance/index.js';
export { BybitWsAdapter } from './feeds/bybit/index.js';
export { DeriveWsAdapter } from './feeds/derive/index.js';
