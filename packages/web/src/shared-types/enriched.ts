export type {
  ChainStats,
  EnrichedChainResponse,
  EnrichedSide,
  EnrichedStrike,
  EstimatedFees,
  GexStrike,
  VenueConnectionState,
  VenueFailure,
  VenueId,
  VenueQuote,
  ServerWsMessage,
  SnapshotMeta,
  WsConnectionState,
  WsSubscriptionRequest,
} from '@oggregator/protocol';

export interface IvSurfaceRow {
  expiry: string;
  dte: number;
  delta10p: number | null;
  delta25p: number | null;
  atm: number | null;
  delta25c: number | null;
  delta10c: number | null;
}

// Fine-grained per-expiry IV grid for the 3D surface view. ivs is aligned to
// IvSurfaceResponse.surfaceFineDeltas (mirrors core FINE_DELTA_GRID).
export interface IvSurfaceFineRow {
  expiry: string;
  dte: number;
  ivs: (number | null)[];
}

// Constant-maturity row produced by total-variance interpolation between
// listed expiries. tenorDays is one of the canonical CMM buckets.
export interface CmmIvSurfaceRow {
  tenorDays: number;
  ivs: (number | null)[];
}

// Per-strike smile point — mirrors core/enrichment.ts SmilePoint.
// Used by the Alpha analyzer and any surface-curve visualization.
export interface SmilePoint {
  strike: number;
  moneyness: number;
  callIv: number | null;
  putIv: number | null;
  blendedIv: number | null;
}

export interface SmileCurve {
  spot: number;
  points: SmilePoint[];
  atmIv: number | null;
  skew: number | null;
}

export type TermStructure = 'contango' | 'flat' | 'backwardation';

export interface VenueAtmPoint {
  expiry: string;
  dte: number;
  atm: number | null;
}

export interface IvSurfaceResponse {
  underlying: string;
  surface: IvSurfaceRow[];
  surfaceFine: IvSurfaceFineRow[];
  // SVI-fitted (or linearly-filled) variant of surfaceFine. Same shape, same
  // delta alignment — populated where the fit succeeds, falling back to
  // linear interpolation across the row otherwise.
  surfaceFineSmoothed: IvSurfaceFineRow[];
  // Constant-maturity grid: one row per canonical tenor (7/14/30/60/90/180/
  // 365d) within the listed-expiry range. Interpolated in total variance.
  surfaceFineCmm: CmmIvSurfaceRow[];
  // Delta tick values aligned 1:1 with each row's ivs[] (typically 0.05–0.95
  // step 0.05). Frontend should render against these instead of hard-coding.
  surfaceFineDeltas: number[];
  termStructure: TermStructure;
  venueAtm: Record<string, VenueAtmPoint[]>;
  // Constant-maturity 30d ATM IV (fraction). Source: IvHistoryService.
  atmIv30d: number | null;
  // Trailing 30d close-to-close annualized RV (fraction). Source: spot candles.
  rv30d: number | null;
  // VRP30d = atmIv30d − rv30d. Positive → IV pricing above realized → option
  // sellers are paid for tail risk. Negative → IV cheap vs realized → caution.
  vrp30d: number | null;
}

// IV history — constant-maturity ATM IV, 25Δ RR, 25Δ butterfly.
// Mirrors core/enrichment.ts IvHistory* types.

export type IvTenor = '7d' | '30d' | '60d' | '90d';

export interface IvHistoryPoint {
  ts: number;
  atmIv: number | null;
  rr25d: number | null;
  bfly25d: number | null;
}

export interface IvHistoryExtrema {
  atmIv: number | null;
  rr25d: number | null;
  bfly25d: number | null;
}

export interface IvHistoryTenorResult {
  current: IvHistoryPoint;
  atmRank: number | null;
  atmPercentile: number | null;
  rrRank: number | null;
  rrPercentile: number | null;
  flyRank: number | null;
  flyPercentile: number | null;
  min: IvHistoryExtrema;
  max: IvHistoryExtrema;
  series: IvHistoryPoint[];
}

export interface IvHistoryResponse {
  underlying: string;
  windowDays: 30 | 90;
  tenors: Record<IvTenor, IvHistoryTenorResult>;
}
