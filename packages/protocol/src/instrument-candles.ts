import { z } from 'zod';
import { VenueIdSchema } from './ws.js';

export const InstrumentCandleIntervalSchema = z.enum([
  '1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M',
]);
export type InstrumentCandleInterval = z.infer<typeof InstrumentCandleIntervalSchema>;

export const InstrumentCandleRangeSchema = z.enum(['1d', '7d', '30d', 'max']);
export type InstrumentCandleRange = z.infer<typeof InstrumentCandleRangeSchema>;

export const InstrumentCandleSchema = z.object({
  ts: z.number(),        // milliseconds, UTC, bucket start
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  vol: z.number(),       // trade volume; 0 for synthetic bars
  synthetic: z.boolean(), // true when bar is mark-filled (no trades)
});
export type InstrumentCandle = z.infer<typeof InstrumentCandleSchema>;

export const InstrumentMarkPointSchema = z.object({
  ts: z.number(),
  c: z.number(),
});
export type InstrumentMarkPoint = z.infer<typeof InstrumentMarkPointSchema>;

export const InstrumentCandlesResponseSchema = z.object({
  venue: VenueIdSchema,
  symbol: z.string(),
  interval: InstrumentCandleIntervalSchema,
  candles: z.array(InstrumentCandleSchema),
  markLine: z.array(InstrumentMarkPointSchema),
});
export type InstrumentCandlesResponse = z.infer<typeof InstrumentCandlesResponseSchema>;
