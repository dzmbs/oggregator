import { z } from 'zod';

export const ThalexPortfolioEntrySchema = z
  .object({
    instrument_name: z.string(),
    position: z.number(),
    average_price: z.number().nullable().optional(),
    mark_price: z.number().nullable().optional(),
    delta: z.number().nullable().optional(),
    gamma: z.number().nullable().optional(),
    vega: z.number().nullable().optional(),
    theta: z.number().nullable().optional(),
    unrealized_pnl: z.number().nullable().optional(),
  })
  .passthrough();
export type ThalexPortfolioEntry = z.infer<typeof ThalexPortfolioEntrySchema>;

export const ThalexPortfolioNotificationSchema = z.object({
  channel_name: z.string(),
  notification: z.array(ThalexPortfolioEntrySchema),
  snapshot: z.boolean().optional(),
});
export type ThalexPortfolioNotification = z.infer<typeof ThalexPortfolioNotificationSchema>;

export const ThalexJsonRpcResultSchema = z.object({
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  result: z.unknown().optional(),
});
export const ThalexJsonRpcErrorSchema = z.object({
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  error: z.object({ code: z.number(), message: z.string() }),
});

export const ThalexLoginResultSchema = z.object({
  account_number: z.string(),
});
export type ThalexLoginResult = z.infer<typeof ThalexLoginResultSchema>;

export const ThalexSubscribedChannelsSchema = z.array(z.string());
export type ThalexSubscribedChannels = z.infer<typeof ThalexSubscribedChannelsSchema>;
