// types/common — shared primitives
export type { VenueId, OptionRight, DataSource } from './types/common.js';
export { VENUE_IDS } from './types/common.js';

export { logger, feedLogger } from './utils/logger.js';

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
export {
  registerAdapter,
  getAdapter,
  getAllAdapters,
  getRegisteredVenues,
} from './core/registry.js';
export {
  VenueSubscriptionCoordinator,
  type VenueSubscriptionHandle,
  type VenueSubscriptionListener,
} from './core/subscription-coordinator.js';
export { parseOptionSymbol, formatOptionSymbol, strikeKey } from './core/symbol.js';
export type { CanonicalOption } from './core/symbol.js';

export {
  buildEnrichedChain,
  computeIvSurface,
  computeIvSurfaceFine,
  computeSmile,
  computeTermStructure,
  computeDte,
  enrichComparisonRow,
  computeChainStats,
  computeGex,
  interpTenor,
  FINE_DELTA_GRID,
  ULTRA_FINE_DELTA_GRID,
} from './core/enrichment.js';

export { buildIvSurfaceGrid } from './core/surface-grid.js';
export type { SurfaceGridEntry, BuildSurfaceGridOptions } from './core/surface-grid.js';

export {
  computeCmmIvSurface,
  fillRowLinear,
  fitRowFromStrikesSvi,
  liftRowToGrid,
  smoothFineSurfaceRow,
  DEFAULT_CMM_TENORS,
  DENSE_CMM_TENORS,
  type CmmIvSurfaceRow,
} from './core/iv-surface-smoothing.js';

export type {
  EnrichedChainResponse,
  EnrichedStrike,
  EnrichedSide,
  VenueQuote,
  IvSurfaceRow,
  IvSurfaceFineRow,
  SmilePoint,
  SmileCurve,
  GexStrike,
  ChainStats,
  TermStructure,
  IvTenor,
  IvHistoryPoint,
  IvHistoryExtrema,
  IvHistoryTenorResult,
  IvHistoryResponse,
} from './core/enrichment.js';

// feeds/shared — adapter interfaces
export type {
  OptionVenueAdapter,
  VenueCapabilities,
  StreamHandlers,
} from './feeds/shared/types.js';
export { BaseAdapter } from './feeds/shared/base.js';

// runtime
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
} from './runtime/chain/index.js';

// runtime
export {
  SpotRuntime,
  type SpotRuntimeEvent,
  type SpotRuntimeHealth,
  type SpotRuntimeListener,
  type SpotRuntimeOptions,
  type SpotRuntimeSnapshotEvent,
  type SpotSnapshot,
} from './runtime/spot/index.js';

// services
export { DvolService, type DvolSnapshot, type DvolCandle, type HvPoint } from './services/dvol.js';
export {
  SpotCandleService,
  type SpotCandle,
  type SpotCandleCurrency,
  type SpotCandleResolutionSec,
} from './services/spot-candles.js';
export { realizedVol } from './services/realized-vol.js';
export {
  backward,
  fitGaussianHmm,
  forward,
  gaussianLogPdf,
  logSumExp,
  smoothedPosteriors,
  viterbi,
  type BackwardResult,
  type FitOptions,
  type FitResult,
  type ForwardResult,
  type HmmModel,
  type ViterbiResult,
} from './services/regime-hmm.js';
export {
  applyStandardization,
  fitStandardization,
  interpBasisToTenor,
  labelStatesByVolLevel,
  RegimeService,
  type BasisPoint,
  type RegimeInputs,
  type RegimeLabel,
  type RegimePersistedModel,
  type RegimePersistedObservation,
  type RegimePersistence,
  type RegimeQueryResult,
  type RegimeServiceDeps,
  type RegimeServiceOptions,
  type StandardizationParams,
} from './services/regime.js';
export {
  fitSvi,
  sviIv,
  sviTotalVariance,
  type SviParams,
  type FitPoint as SviFitPoint,
} from './services/svi-fit.js';
export {
  IvHistoryService,
  type IvHistoryDeps,
  type IvHistoryOptions,
  type IvHistoryPersistence,
  type IvHistoryPointSource,
  type PersistedIvHistoryPoint,
} from './services/iv-history.js';
export {
  TradeRuntime,
  getDeribitTradeCurrency,
  getDeribitUnderlyingFromInstrument,
  normalizeTradeUnderlying,
  type TradeEvent,
  type TradeRuntimeHealth,
} from './runtime/trades/index.js';
export {
  BlockTradeRuntime,
  type BlockTradeEvent,
  type BlockTradeLeg,
  type BlockTradeRuntimeHealth,
} from './runtime/block-trades/index.js';
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
} from './trade-persistence.js';

// Black-76 helpers (re-exported for downstream Greek work)
export {
  d1,
  pdf,
  cdf,
  price76,
  vega76,
  delta76,
  gamma76,
  solveIv,
  thetaPerDay,
  yearsToExpiry,
} from './feeds/thalex/bs-solver.js';

// portfolio module
export type {
  PositionLeg,
  MarkContext,
  MarkProvider,
  PositionStore,
  PositionStoreEvent,
  PositionStoreListener,
  PortfolioPersistence,
} from './portfolio/index.js';
export {
  InMemoryPositionStore,
  generateLegId,
  vanna76,
  volga76,
  aggregateGreeksByStrike,
  aggregateGreeksByExpiry,
  breakEvenIvCurve,
  buildPortfolioPnlCurve,
  computeTotals,
  attachMarks,
  legMarkFromShockedIv,
  applyVolShock,
  computeShockPnl,
  computeShockGrid,
} from './portfolio/index.js';
export {
  PortfolioRuntime,
  type ChainSurfaceProvider,
  type PortfolioRuntimeEvent,
  type PortfolioRuntimeListener,
  type PortfolioRuntimeOptions,
  type PortfolioSnapshotEvent,
  type PortfolioDeltaEvent,
  type PortfolioErrorEvent,
} from './runtime/portfolio/index.js';

// private (per-user, authenticated) venue adapters
export {
  DerivePrivateClient,
  type DerivePrivateCreds,
  type DerivePositionsListener,
  signLoginMessage as signDeriveLoginMessage,
  recoverSignerAddress as recoverDeriveSignerAddress,
} from './feeds/derive-private/index.js';
export {
  ThalexPrivateClient,
  type ThalexPrivateCreds,
  type ThalexPositionsListener,
  mintAuthToken as mintThalexAuthToken,
} from './feeds/thalex-private/index.js';

// feeds — venue adapters
export { DeribitWsAdapter } from './feeds/deribit/index.js';
export { OkxWsAdapter } from './feeds/okx/index.js';
export { BinanceWsAdapter } from './feeds/binance/index.js';
export { BybitWsAdapter } from './feeds/bybit/index.js';
export { DeriveWsAdapter } from './feeds/derive/index.js';
export { CoincallWsAdapter } from './feeds/coincall/index.js';
export { ThalexWsAdapter } from './feeds/thalex/index.js';
export { GateioWsAdapter } from './feeds/gateio/index.js';
