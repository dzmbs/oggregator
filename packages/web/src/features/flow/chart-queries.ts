import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchJson } from '@lib/http';
import type { HistoryRange, TradeEvent, TradeHistoryCursor } from './queries';

export interface InstrumentRow {
  instrument: string;
  count: number;
  lastTs: string;
  lastPrice: number | null;
  lastReferencePriceUsd: number | null;
  optionType: 'call' | 'put' | null;
  strike: number | null;
  expiry: string | null;
}

interface InstrumentListResponse {
  available: boolean;
  instruments: InstrumentRow[];
}

interface InstrumentTradesResponse {
  available: boolean;
  trades: TradeEvent[];
  nextCursor: TradeHistoryCursor | null;
}

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
      args.limit ?? 50,
    ],
    queryFn: () => fetchJson<InstrumentListResponse>(`/flow/instruments?${params.toString()}`),
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
      args.limit ?? 500,
    ],
    queryFn: () =>
      fetchJson<InstrumentTradesResponse>(`/flow/instrument-trades?${params.toString()}`),
    enabled: Boolean(args.underlying && args.venue && args.instrument) && enabled,
    refetchInterval: 2_000,
  });
}
