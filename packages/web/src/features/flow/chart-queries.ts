import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { fetchJson } from '@lib/http';
import type { HistoryRange, TradeEvent, TradeHistoryCursor } from './queries';

const InstrumentRowSchema = z.object({
  instrument: z.string(),
  count: z.number(),
  lastTs: z.string(),
  lastPrice: z.number().nullable(),
  lastReferencePriceUsd: z.number().nullable(),
  optionType: z.enum(['call', 'put']).nullable(),
  strike: z.number().nullable(),
  expiry: z.string().nullable(),
});
export type InstrumentRow = z.infer<typeof InstrumentRowSchema>;

const InstrumentListResponseSchema = z.object({
  available: z.boolean(),
  instruments: z.array(InstrumentRowSchema),
});

const TradeEventSchema: z.ZodType<TradeEvent> = z.object({
  venue: z.string(),
  tradeUid: z.string(),
  tradeId: z.string().nullable().optional(),
  instrument: z.string(),
  underlying: z.string(),
  side: z.enum(['buy', 'sell']),
  price: z.number(),
  size: z.number(),
  iv: z.number().nullable(),
  markPrice: z.number().nullable(),
  indexPrice: z.number().nullable(),
  premiumUsd: z.number().nullable(),
  notionalUsd: z.number().nullable(),
  referencePriceUsd: z.number().nullable(),
  isBlock: z.boolean(),
  timestamp: z.number(),
}) as z.ZodType<TradeEvent>;

const TradeHistoryCursorSchema: z.ZodType<TradeHistoryCursor> = z.object({
  beforeTs: z.string(),
  beforeUid: z.string(),
});

const InstrumentTradesResponseSchema = z.object({
  available: z.boolean(),
  trades: z.array(TradeEventSchema),
  nextCursor: TradeHistoryCursorSchema.nullable(),
});

export interface InstrumentListQueryArgs {
  underlying: string;
  venue: string;
  range: HistoryRange;
  limit?: number;
}

export interface InstrumentTradesQueryArgs {
  underlying: string;
  venue: string;
  instrument: string;
  range: HistoryRange;
  limit?: number;
}

async function fetchAndValidate<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const raw = await fetchJson<unknown>(path);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid response from ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function useInstrumentList(args: InstrumentListQueryArgs, enabled = true) {
  const params = useMemo(() => {
    const p = new URLSearchParams({ underlying: args.underlying, venue: args.venue });
    if (args.range.start) p.set('start', args.range.start);
    if (args.range.end) p.set('end', args.range.end);
    if (args.limit) p.set('limit', String(args.limit));
    return p;
  }, [args.underlying, args.venue, args.range.start, args.range.end, args.limit]);

  return useQuery({
    queryKey: [
      'flow-instruments',
      args.underlying,
      args.venue,
      args.range.start,
      args.range.end,
      args.limit,
    ],
    queryFn: () =>
      fetchAndValidate(`/flow/instruments?${params.toString()}`, InstrumentListResponseSchema),
    enabled: Boolean(args.underlying && args.venue) && enabled,
  });
}

export function useInstrumentTrades(args: InstrumentTradesQueryArgs, enabled = true) {
  const params = useMemo(() => {
    const p = new URLSearchParams({
      underlying: args.underlying,
      venue: args.venue,
      instrument: args.instrument,
    });
    if (args.range.start) p.set('start', args.range.start);
    if (args.range.end) p.set('end', args.range.end);
    if (args.limit) p.set('limit', String(args.limit));
    return p;
  }, [args.underlying, args.venue, args.instrument, args.range.start, args.range.end, args.limit]);

  return useQuery({
    queryKey: [
      'flow-instrument-trades',
      args.underlying,
      args.venue,
      args.instrument,
      args.range.start,
      args.range.end,
      args.limit,
    ],
    queryFn: () =>
      fetchAndValidate(
        `/flow/instrument-trades?${params.toString()}`,
        InstrumentTradesResponseSchema,
      ),
    enabled: Boolean(args.underlying && args.venue && args.instrument) && enabled,
    refetchInterval: 2_000,
  });
}
