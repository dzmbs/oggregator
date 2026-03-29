import { z } from 'zod';

// ── Venue primitives ──────────────────────────────────────────────

export const VENUE_IDS = ['deribit', 'okx', 'bybit', 'binance', 'derive'] as const;
export type VenueId = (typeof VENUE_IDS)[number];

export const VenueIdSchema = z.enum(VENUE_IDS);

export type VenueConnectionState = 'connected' | 'polling' | 'reconnecting' | 'degraded' | 'down';

/** Browser-side socket lifecycle — distinct from venue health */
export type WsConnectionState =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'stale'
  | 'error'
  | 'closed';

// ── Subscription request ──────────────────────────────────────────

export const WsSubscriptionRequestSchema = z.object({
  underlying: z.string().min(1),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  venues: z.array(VenueIdSchema).min(1),
});

export type WsSubscriptionRequest = z.infer<typeof WsSubscriptionRequestSchema>;

// ── Snapshot metadata ─────────────────────────────────────────────

export const SnapshotMetaSchema = z.object({
  generatedAt: z.number(),
  maxQuoteTs: z.number(),
  staleMs: z.number(),
});

export type SnapshotMeta = z.infer<typeof SnapshotMetaSchema>;

// ── Venue failure ─────────────────────────────────────────────────

export const VenueFailureSchema = z.object({
  venue: VenueIdSchema,
  reason: z.string(),
});

export type VenueFailure = z.infer<typeof VenueFailureSchema>;

// ── Client → Server ───────────────────────────────────────────────

export const ClientWsMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    subscriptionId: z.string().min(1),
    request: WsSubscriptionRequestSchema,
  }),
  z.object({
    type: z.literal('unsubscribe'),
  }),
]);

export type ClientWsMessage = z.infer<typeof ClientWsMessageSchema>;

// ── Server → Client ──────────────────────────────────────────────

export const VenueConnectionStateSchema = z.enum([
  'connected',
  'polling',
  'reconnecting',
  'degraded',
  'down',
]);
const VenueStateSchema = VenueConnectionStateSchema;

const NullableNumberSchema = z.number().nullable();

export interface EstimatedFees {
  maker: number;
  taker: number;
}

export interface VenueQuote {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  bidSize: number | null;
  askSize: number | null;
  markIv: number | null;
  bidIv: number | null;
  askIv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  spreadPct: number | null;
  totalCost: number | null;
  estimatedFees: EstimatedFees | null;
  openInterest: number | null;
  volume24h: number | null;
  openInterestUsd: number | null;
  volume24hUsd: number | null;
}

export interface EnrichedSide {
  venues: Partial<Record<VenueId, VenueQuote>>;
  bestIv: number | null;
  bestVenue: VenueId | null;
}

export interface EnrichedStrike {
  strike: number;
  call: EnrichedSide;
  put: EnrichedSide;
}

export interface GexStrike {
  strike: number;
  gexUsdMillions: number;
}

export interface ChainStats {
  spotIndexUsd: number | null;
  indexPriceUsd: number | null;
  basisPct: number | null;
  atmStrike: number | null;
  atmIv: number | null;
  putCallOiRatio: number | null;
  totalOiUsd: number | null;
  skew25d: number | null;
}

export interface EnrichedChainResponse {
  underlying: string;
  expiry: string;
  dte: number;
  stats: ChainStats;
  strikes: EnrichedStrike[];
  gex: GexStrike[];
}

export interface VenueDelta {
  venue: VenueId;
  symbol: string;
  ts: number;
  quote?: {
    bid?: { raw?: number | null; rawCurrency?: string; usd?: number | null };
    ask?: { raw?: number | null; rawCurrency?: string; usd?: number | null };
    mark?: { raw?: number | null; rawCurrency?: string; usd?: number | null };
    last?: { raw?: number | null; rawCurrency?: string; usd?: number | null } | null;
    bidSize?: number | null;
    askSize?: number | null;
    underlyingPriceUsd?: number | null;
    indexPriceUsd?: number | null;
    volume24h?: number | null;
    openInterest?: number | null;
    openInterestUsd?: number | null;
    volume24hUsd?: number | null;
    estimatedFees?: EstimatedFees | null;
    timestamp?: number | null;
    source?: string;
  };
  greeks?: {
    delta?: number | null;
    gamma?: number | null;
    theta?: number | null;
    vega?: number | null;
    rho?: number | null;
    markIv?: number | null;
    bidIv?: number | null;
    askIv?: number | null;
  };
}

const EstimatedFeesSchema = z.object({
  maker: z.number(),
  taker: z.number(),
});

const VenueQuoteSchema = z.object({
  bid: NullableNumberSchema,
  ask: NullableNumberSchema,
  mid: NullableNumberSchema,
  bidSize: NullableNumberSchema,
  askSize: NullableNumberSchema,
  markIv: NullableNumberSchema,
  bidIv: NullableNumberSchema,
  askIv: NullableNumberSchema,
  delta: NullableNumberSchema,
  gamma: NullableNumberSchema,
  theta: NullableNumberSchema,
  vega: NullableNumberSchema,
  spreadPct: NullableNumberSchema,
  totalCost: NullableNumberSchema,
  estimatedFees: EstimatedFeesSchema.nullable(),
  openInterest: NullableNumberSchema,
  volume24h: NullableNumberSchema,
  openInterestUsd: NullableNumberSchema,
  volume24hUsd: NullableNumberSchema,
});

const EnrichedSideSchema = z.object({
  venues: z.record(z.string(), VenueQuoteSchema),
  bestIv: NullableNumberSchema,
  bestVenue: VenueIdSchema.nullable(),
});

const EnrichedStrikeSchema = z.object({
  strike: z.number(),
  call: EnrichedSideSchema,
  put: EnrichedSideSchema,
});

const GexStrikeSchema = z.object({
  strike: z.number(),
  gexUsdMillions: z.number(),
});

const ChainStatsSchema = z.object({
  spotIndexUsd: NullableNumberSchema,
  indexPriceUsd: NullableNumberSchema,
  basisPct: NullableNumberSchema,
  atmStrike: NullableNumberSchema,
  atmIv: NullableNumberSchema,
  putCallOiRatio: NullableNumberSchema,
  totalOiUsd: NullableNumberSchema,
  skew25d: NullableNumberSchema,
});

export const EnrichedChainResponseSchema = z.object({
  underlying: z.string(),
  expiry: z.string(),
  dte: z.number(),
  stats: ChainStatsSchema,
  strikes: z.array(EnrichedStrikeSchema),
  gex: z.array(GexStrikeSchema),
});

const PremiumValueSchema = z.object({
  raw: z.number().nullable().optional(),
  rawCurrency: z.string().optional(),
  usd: z.number().nullable().optional(),
});

export const VenueDeltaSchema = z.object({
  venue: VenueIdSchema,
  symbol: z.string(),
  ts: z.number(),
  quote: z
    .object({
      bid: PremiumValueSchema.optional(),
      ask: PremiumValueSchema.optional(),
      mark: PremiumValueSchema.optional(),
      last: PremiumValueSchema.nullable().optional(),
      bidSize: NullableNumberSchema.optional(),
      askSize: NullableNumberSchema.optional(),
      underlyingPriceUsd: NullableNumberSchema.optional(),
      indexPriceUsd: NullableNumberSchema.optional(),
      volume24h: NullableNumberSchema.optional(),
      openInterest: NullableNumberSchema.optional(),
      openInterestUsd: NullableNumberSchema.optional(),
      volume24hUsd: NullableNumberSchema.optional(),
      estimatedFees: EstimatedFeesSchema.nullable().optional(),
      timestamp: NullableNumberSchema.optional(),
      source: z.string().optional(),
    })
    .partial()
    .optional(),
  greeks: z
    .object({
      delta: NullableNumberSchema.optional(),
      gamma: NullableNumberSchema.optional(),
      theta: NullableNumberSchema.optional(),
      vega: NullableNumberSchema.optional(),
      rho: NullableNumberSchema.optional(),
      markIv: NullableNumberSchema.optional(),
      bidIv: NullableNumberSchema.optional(),
      askIv: NullableNumberSchema.optional(),
    })
    .partial()
    .optional(),
});

export const DeltaPatchSchema = z.object({
  stats: ChainStatsSchema,
  strikes: z.array(EnrichedStrikeSchema),
  gex: z.array(GexStrikeSchema),
});

export const ServerWsMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribed'),
    subscriptionId: z.string(),
    request: WsSubscriptionRequestSchema,
    serverTime: z.number(),
    failedVenues: z.array(VenueFailureSchema).optional(),
  }),
  z.object({
    type: z.literal('snapshot'),
    subscriptionId: z.string(),
    seq: z.number(),
    request: WsSubscriptionRequestSchema,
    meta: SnapshotMetaSchema,
    data: EnrichedChainResponseSchema,
  }),
  z.object({
    type: z.literal('delta'),
    subscriptionId: z.string(),
    seq: z.number(),
    request: WsSubscriptionRequestSchema,
    meta: SnapshotMetaSchema,
    deltas: z.array(VenueDeltaSchema),
    patch: DeltaPatchSchema,
  }),
  z.object({
    type: z.literal('status'),
    subscriptionId: z.string(),
    venue: VenueIdSchema,
    state: VenueStateSchema,
    ts: z.number(),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('error'),
    subscriptionId: z.string().nullable(),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);

export type ServerWsMessage = z.infer<typeof ServerWsMessageSchema>;
