import { z } from "zod";

const VenueIdSchema = z.enum(["deribit", "okx", "binance", "bybit", "derive"]);

const WsRequestSchema = z.object({
  underlying: z.string(),
  expiry: z.string(),
  venues: z.array(VenueIdSchema),
});

const SnapshotMetaSchema = z.object({
  generatedAt: z.number(),
  maxQuoteTs: z.number(),
  staleMs: z.number(),
});

const VenueFailureSchema = z.object({
  venue: VenueIdSchema,
  reason: z.string(),
});

const VenueStateSchema = z.enum(["connected", "polling", "reconnecting", "degraded", "down"]);

const SubscribedSchema = z.object({
  type: z.literal("subscribed"),
  subscriptionId: z.string(),
  request: WsRequestSchema,
  serverTime: z.number(),
  failedVenues: z.array(VenueFailureSchema).optional(),
});

const SnapshotSchema = z.object({
  type: z.literal("snapshot"),
  subscriptionId: z.string(),
  seq: z.number(),
  request: WsRequestSchema,
  meta: SnapshotMetaSchema,
  data: z.unknown(),
});

const StatusSchema = z.object({
  type: z.literal("status"),
  subscriptionId: z.string(),
  venue: VenueIdSchema,
  state: VenueStateSchema,
  ts: z.number(),
  message: z.string().optional(),
});

const ErrorSchema = z.object({
  type: z.literal("error"),
  subscriptionId: z.string().nullable(),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

export const ServerWsMessageSchema = z.discriminatedUnion("type", [
  SubscribedSchema,
  SnapshotSchema,
  StatusSchema,
  ErrorSchema,
]);

export type ValidatedServerWsMessage = z.infer<typeof ServerWsMessageSchema>;
