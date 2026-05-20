import { z } from 'zod';

import { VenueIdSchema } from './ws.js';

export const PositionSourceSchema = z.enum([
  'manual',
  'paper',
  'deribit',
  'okx',
  'binance',
  'bybit',
  'derive',
  'coincall',
  'thalex',
  'gateio',
]);
export type PositionSource = z.infer<typeof PositionSourceSchema>;

export const PortfolioSourceSchema = z.enum([
  'manual',
  'paper',
  'deribit',
  'okx',
  'binance',
  'bybit',
  'derive',
  'coincall',
  'thalex',
  'gateio',
]);
export type PortfolioSource = z.infer<typeof PortfolioSourceSchema>;

export const PositionLegSchema = z.object({
  legId: z.string().min(1),
  underlying: z.string().min(1),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  strike: z.number().positive(),
  optionRight: z.enum(['call', 'put']),
  size: z.number().refine((v) => v !== 0, 'size must be non-zero'),
  entryPriceUsd: z.number().positive(),
  entryIv: z.number().nonnegative().nullable(),
  // True when entryIv was back-solved from price+forward+T (not user/venue
  // supplied) so the UI can mark it as model-derived.
  entryIvIsModel: z.boolean().optional(),
  // Realized PnL accumulated by prior partial closes on this leg. Manual
  // upserts that reduce or flip size fold the closed slice into this field
  // instead of dropping it.
  realizedPnlUsd: z.number().default(0),
  entryTs: z.number().int().nonnegative(),
  venueHint: VenueIdSchema.nullable(),
  source: PositionSourceSchema,
});
export type PositionLeg = z.infer<typeof PositionLegSchema>;

export const PositionLegInputSchema = PositionLegSchema.omit({
  legId: true,
  entryTs: true,
  realizedPnlUsd: true,
  entryIvIsModel: true,
}).extend({
  legId: z.string().min(1).optional(),
  entryTs: z.number().int().nonnegative().optional(),
});
export type PositionLegInput = z.infer<typeof PositionLegInputSchema>;

export const VegaByStrikeRowSchema = z.object({
  strike: z.number(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  optionRight: z.enum(['call', 'put']),
  delta: z.number(),
  vega: z.number(),
  gamma: z.number(),
  vanna: z.number(),
  volga: z.number(),
  contracts: z.number(),
});
export type VegaByStrikeRow = z.infer<typeof VegaByStrikeRowSchema>;

export const ExpiryBucketRowSchema = z.object({
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dte: z.number(),
  vega: z.number(),
  gamma: z.number(),
  theta: z.number(),
  contracts: z.number(),
});
export type ExpiryBucketRow = z.infer<typeof ExpiryBucketRowSchema>;

export const BreakEvenIvRowSchema = z.object({
  legId: z.string(),
  strike: z.number(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  optionRight: z.enum(['call', 'put']),
  entryIv: z.number().nullable(),
  currentMarkUsd: z.number().nullable(),
  currentIv: z.number().nonnegative().nullable(),
  breakEvenIv: z.number().nonnegative().nullable(),
  ivCushionPct: z.number().nullable(),
  currentIvIsModel: z.boolean().optional(),
  beNote: z.enum(['capped', 'below_intrinsic', 'above_upper']).optional(),
});
export type BreakEvenIvRow = z.infer<typeof BreakEvenIvRowSchema>;

export const VolShockScenarioSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('parallel'),
    bumpVolPts: z.number(),
  }),
  z.object({
    kind: z.literal('skew_tilt'),
    atmStrike: z.number().positive(),
    slopePerLogK: z.number(),
  }),
  z.object({
    kind: z.literal('term_twist'),
    pivotDays: z.number().nonnegative(),
    slopePerYear: z.number(),
  }),
  z.object({
    kind: z.literal('atm_bump'),
    atmStrike: z.number().positive(),
    widthPct: z.number().positive(),
    bumpVolPts: z.number(),
  }),
]);
export type VolShockScenario = z.infer<typeof VolShockScenarioSchema>;

export const VolShockLegResultSchema = z.object({
  legId: z.string(),
  pnlUsd: z.number(),
  bumpedIv: z.number(),
  bumpedMarkUsd: z.number(),
});
export type VolShockLegResult = z.infer<typeof VolShockLegResultSchema>;

export const VolShockResultSchema = z.object({
  scenario: VolShockScenarioSchema,
  totalPnlUsd: z.number(),
  byLeg: z.array(VolShockLegResultSchema),
});
export type VolShockResult = z.infer<typeof VolShockResultSchema>;

export const PortfolioTotalsSchema = z.object({
  netDeltaUsd: z.number(),
  netGammaUsd: z.number(),
  netVegaUsd: z.number(),
  netThetaUsd: z.number(),
  netVannaUsd: z.number(),
  netVolgaUsd: z.number(),
  unrealizedPnlUsd: z.number(),
});
export type PortfolioTotals = z.infer<typeof PortfolioTotalsSchema>;

export const ShockGridCellSchema = z.object({
  atmShiftVolPts: z.number(),
  skewShiftPerLogK: z.number(),
  totalPnlUsd: z.number(),
});
export type ShockGridCell = z.infer<typeof ShockGridCellSchema>;

export const PortfolioPnlCurveStatusSchema = z.enum([
  'ok',
  'empty',
  'mixed_underlyings',
  'missing_marks',
]);
export type PortfolioPnlCurveStatus = z.infer<typeof PortfolioPnlCurveStatusSchema>;

export const PortfolioPnlPointSchema = z.object({
  underlyingPriceUsd: z.number().positive(),
  nowPnlUsd: z.number(),
  forwardPnlUsd: z.number().nullable(),
  expiryPnlUsd: z.number(),
});
export type PortfolioPnlPoint = z.infer<typeof PortfolioPnlPointSchema>;

export const PortfolioPnlCurveSchema = z.object({
  status: PortfolioPnlCurveStatusSchema,
  underlying: z.string().nullable(),
  currentSpotUsd: z.number().positive().nullable(),
  breakEvenPricesUsd: z.array(z.number().positive()),
  maxProfitUsd: z.number().nullable(),
  maxLossUsd: z.number().nullable(),
  upsideBounded: z.boolean(),
  downsideBounded: z.boolean(),
  points: z.array(PortfolioPnlPointSchema),
});
export type PortfolioPnlCurve = z.infer<typeof PortfolioPnlCurveSchema>;

export const StrategyKindSchema = z.enum([
  'naked',
  'call_spread',
  'put_spread',
  'straddle',
  'strangle',
]);
export type StrategyKind = z.infer<typeof StrategyKindSchema>;

export const StrategyGroupSchema = z.object({
  groupId: z.string(),
  kind: StrategyKindSchema,
  underlying: z.string(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  legIds: z.array(z.string()),
  // Signed net entry premium: positive = net debit paid, negative = net
  // credit received. Sum over legs of entryPriceUsd * size, where size is
  // signed (positive long, negative short).
  netEntryPremiumUsd: z.number(),
  debitOrCredit: z.enum(['debit', 'credit', 'flat']),
  // Max profit / loss known in closed form for verticals; null when the
  // structure has unbounded payoff in one direction (naked / strangle short
  // calls etc.).
  maxProfitUsd: z.number().nullable(),
  maxLossUsd: z.number().nullable(),
  breakEvenSpotsUsd: z.array(z.number()),
});
export type StrategyGroup = z.infer<typeof StrategyGroupSchema>;

export const PortfolioMetricsSchema = z.object({
  accountId: z.string(),
  generatedAt: z.number().int(),
  forwardDays: z.number().int().nonnegative(),
  totals: PortfolioTotalsSchema,
  pnlCurve: PortfolioPnlCurveSchema,
  byStrike: z.array(VegaByStrikeRowSchema),
  byExpiry: z.array(ExpiryBucketRowSchema),
  breakEven: z.array(BreakEvenIvRowSchema),
  shockGrid: z.array(z.array(ShockGridCellSchema)),
  strategies: z.array(StrategyGroupSchema),
});
export type PortfolioMetrics = z.infer<typeof PortfolioMetricsSchema>;

export const PortfolioWsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    subscriptionId: z.string(),
    forwardDays: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('unsubscribe'),
    subscriptionId: z.string(),
  }),
]);
export type PortfolioWsClientMessage = z.infer<typeof PortfolioWsClientMessageSchema>;

export const PortfolioWsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    accountId: z.string(),
    serverTime: z.number().int(),
  }),
  z.object({
    type: z.literal('snapshot'),
    seq: z.number().int().nonnegative(),
    metrics: PortfolioMetricsSchema,
    positions: z.array(PositionLegSchema),
  }),
  z.object({
    type: z.literal('delta'),
    seq: z.number().int().nonnegative(),
    metrics: PortfolioMetricsSchema,
    changedLegIds: z.array(z.string()),
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
]);
export type PortfolioWsServerMessage = z.infer<typeof PortfolioWsServerMessageSchema>;
