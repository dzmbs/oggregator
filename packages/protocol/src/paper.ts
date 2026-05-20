import { z } from 'zod';

export const PaperOrderLegSchema = z.object({
  index: z.number().int().nonnegative(),
  side: z.enum(['buy', 'sell']),
  optionRight: z.enum(['call', 'put']),
  underlying: z.string().min(1),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  strike: z.number().positive(),
  quantity: z.number().positive(),
  preferredVenues: z
    .array(z.enum(['deribit', 'okx', 'bybit', 'binance', 'derive', 'coincall', 'thalex', 'gateio']))
    .nullable(),
});

export type PaperOrderLeg = z.infer<typeof PaperOrderLegSchema>;

export const PlaceOrderRequestSchema = z.object({
  clientOrderId: z.string().optional(),
  legs: z.array(
    PaperOrderLegSchema.omit({ index: true }).extend({
      preferredVenues: PaperOrderLegSchema.shape.preferredVenues.optional(),
    }),
  ).min(1),
  venueFilter: z
    .array(z.enum(['deribit', 'okx', 'bybit', 'binance', 'derive', 'coincall', 'thalex', 'gateio']))
    .default([]),
});

export type PlaceOrderRequest = z.infer<typeof PlaceOrderRequestSchema>;

export const PaperTradeStatusSchema = z.enum(['open', 'closed']);
export const PaperTradeOrderIntentSchema = z.enum([
  'open',
  'add',
  'reduce',
  'close',
  'roll',
  'settlement',
]);
export const PaperTradeNoteKindSchema = z.enum(['thesis', 'invalidation', 'review', 'note']);

export const CreatePaperTradeRequestSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  strategyName: z.string().min(1).max(120).optional(),
  thesis: z.string().min(1).max(2_000).optional(),
  invalidation: z.string().min(1).max(2_000).optional(),
  order: PlaceOrderRequestSchema,
});

export type CreatePaperTradeRequest = z.infer<typeof CreatePaperTradeRequestSchema>;

export const CreatePaperTradeNoteRequestSchema = z.object({
  kind: PaperTradeNoteKindSchema,
  content: z.string().min(1).max(2_000),
  tags: z.array(z.string().min(1).max(32)).max(12).default([]),
});

export type CreatePaperTradeNoteRequest = z.infer<typeof CreatePaperTradeNoteRequestSchema>;

export const ReducePaperTradeRequestSchema = z.object({
  fraction: z.number().positive().max(1),
});

export type ReducePaperTradeRequest = z.infer<typeof ReducePaperTradeRequestSchema>;

export const InitPaperAccountRequestSchema = z.object({
  initialCashUsd: z.number().int().min(1_000).max(100_000).multipleOf(1_000),
});

export type InitPaperAccountRequest = z.infer<typeof InitPaperAccountRequestSchema>;

export interface PaperOrderDto {
  id: string;
  clientOrderId: string;
  accountId: string;
  status: 'accepted' | 'filled' | 'rejected' | 'cancelled';
  legs: PaperOrderLeg[];
  submittedAt: string;
  filledAt: string | null;
  rejectionReason: string | null;
  totalDebitUsd: number | null;
}

export interface PaperFillDto {
  id: string;
  orderId: string;
  legIndex: number;
  venue: string;
  side: 'buy' | 'sell';
  optionRight: 'call' | 'put';
  underlying: string;
  expiry: string;
  strike: number;
  quantity: number;
  requestedQuantity: number;
  priceUsd: number;
  feesUsd: number;
  slippageUsd: number;
  partialFill: boolean;
  benchmarkBidUsd: number | null;
  benchmarkAskUsd: number | null;
  benchmarkMidUsd: number | null;
  underlyingSpotUsd: number | null;
  filledAt: string;
}

export interface PaperPositionDto {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
  netQuantity: number;
  avgEntryPriceUsd: number;
  realizedPnlUsd: number;
  markPriceUsd: number | null;
  unrealizedPnlUsd: number | null;
  openedAt: string;
  lastFillAt: string;
}

export interface PaperPnlDto {
  cashUsd: number;
  realizedUsd: number;
  unrealizedUsd: number;
  equityUsd: number;
  generatedAt: string;
}

export interface PaperAccountDto {
  id: string;
  label: string;
  initialCashUsd: number;
  createdAt: string | null;
  isInitialized: boolean;
}

export interface PaperRiskDto {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

export interface PaperTradeLegDto extends PaperPositionDto {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  markIv: number | null;
  underlyingPriceUsd: number | null;
  marketSourceVenue: string | null;
  marketSourceLabel: string;
}

export interface PaperTradeNoteDto {
  id: string;
  tradeId: string;
  kind: z.infer<typeof PaperTradeNoteKindSchema>;
  content: string;
  tags: string[];
  createdAt: string;
}

export interface PaperActivityDto {
  id: string;
  tradeId: string | null;
  kind: string;
  summary: string;
  payload: unknown;
  ts: string;
}

export interface PaperTradeOrderLinkDto {
  intent: z.infer<typeof PaperTradeOrderIntentSchema>;
  order: PaperOrderDto;
}

export interface PaperTradeSummaryDto {
  id: string;
  accountId: string;
  underlying: string;
  label: string;
  strategyName: string;
  status: z.infer<typeof PaperTradeStatusSchema>;
  entrySpotUsd: number | null;
  currentSpotUsd: number | null;
  openedAt: string;
  closedAt: string | null;
  netPremiumUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  openLegs: number;
  risk: PaperRiskDto;
}

export interface PaperTradeDetailDto extends PaperTradeSummaryDto {
  legs: PaperTradeLegDto[];
  orders: PaperTradeOrderLinkDto[];
  fills: PaperFillDto[];
  notes: PaperTradeNoteDto[];
  activity: PaperActivityDto[];
}

export interface PaperOverviewDto {
  pnl: PaperPnlDto;
  risk: PaperRiskDto;
  openTradeCount: number;
  closedTradeCount: number;
}

export type PaperWsServerMessage =
  | { type: 'hello'; accountId: string; serverTime: number }
  | { type: 'positions'; positions: PaperPositionDto[] }
  | { type: 'pnl'; pnl: PaperPnlDto }
  | { type: 'order'; order: PaperOrderDto; fills: PaperFillDto[] }
  | { type: 'trade'; trade: PaperTradeDetailDto }
  | { type: 'activity'; activity: PaperActivityDto }
  | { type: 'error'; code: string; message: string };
