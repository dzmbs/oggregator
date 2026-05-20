import { z } from 'zod';

export const DerivePositionSchema = z.object({
  instrument_name: z.string(),
  instrument_type: z.enum(['option', 'perp', 'erc20']),
  amount: z.string(),
  average_price: z.string(),
  mark_price: z.string(),
  index_price: z.string(),
  creation_timestamp: z.number().int(),
  delta: z.string().optional(),
  gamma: z.string().optional(),
  theta: z.string().optional(),
  vega: z.string().optional(),
  unrealized_pnl: z.string().optional(),
});
export type DerivePosition = z.infer<typeof DerivePositionSchema>;

export const DerivePositionsResponseSchema = z.object({
  positions: z.array(DerivePositionSchema),
  subaccount_id: z.number().int(),
});
export type DerivePositionsResponse = z.infer<typeof DerivePositionsResponseSchema>;

export const DeriveJsonRpcEnvelopeSchema = z.object({
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
export type DeriveJsonRpcEnvelope = z.infer<typeof DeriveJsonRpcEnvelopeSchema>;
