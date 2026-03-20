export { buildComparisonChain } from './aggregator.js';
export { registerAdapter, getAdapter, getAllAdapters, getRegisteredVenues } from './registry.js';
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
  GetChainResponse,
  ServerWsMessage,
  ClientWsMessage,
} from './types.js';

export { EMPTY_GREEKS } from './types.js';

export {
  buildEnrichedChain,
  computeIvSurface,
  computeTermStructure,
  computeDte,
  enrichComparisonRow,
  computeChainStats,
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
