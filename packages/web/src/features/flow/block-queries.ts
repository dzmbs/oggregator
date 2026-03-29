import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchJson } from '@lib/http';
import type { HistoryRange, HistorySummary, TradeHistoryCursor } from './queries';

export interface BlockTradeLeg {
  instrument: string;
  direction: 'buy' | 'sell';
  price: number;
  size: number;
  ratio: number;
}

export interface BlockTradeEvent {
  venue: string;
  tradeUid: string;
  tradeId: string;
  timestamp: number;
  underlying: string;
  direction: 'buy' | 'sell';
  strategy: string | null;
  legs: BlockTradeLeg[];
  totalSize: number;
  premiumUsd: number | null;
  notionalUsd: number;
  referencePriceUsd: number | null;
  indexPrice: number | null;
}

interface BlockFlowResponse {
  count: number;
  trades: BlockTradeEvent[];
}

interface BlockFlowHistoryResponse {
  available: boolean;
  trades: BlockTradeEvent[];
  nextCursor: TradeHistoryCursor | null;
}

export interface BlockHistoryPageQuery {
  underlying: string;
  venues: string[];
  range: HistoryRange;
  cursor?: TradeHistoryCursor | null;
  limit?: number;
}

export function useBlockFlow(underlying?: string) {
  const params = underlying ? `?underlying=${underlying}&limit=200` : '?limit=200';
  return useQuery({
    queryKey: ['block-flow', underlying ?? 'all'],
    queryFn: () => fetchJson<BlockFlowResponse>(`/block-flow${params}`),
    refetchInterval: 30_000,
  });
}

export function useBlockFlowHistorySummary(
  underlying: string,
  venues: string[],
  range: HistoryRange,
  enabled = true,
) {
  const query = useMemo(
    () => buildHistoryParams({ underlying, venues, range }),
    [range, underlying, venues],
  );

  return useQuery({
    queryKey: ['block-flow-history-summary', underlying, venues.join(','), range.start, range.end],
    queryFn: () => fetchJson<HistorySummary>(`/block-flow/history/summary?${query.toString()}`),
    enabled: Boolean(underlying) && enabled,
  });
}

export function useBlockFlowHistoryPage(query: BlockHistoryPageQuery, enabled = true) {
  const params = useMemo(() => buildHistoryParams(query), [query]);

  return useQuery({
    queryKey: [
      'block-flow-history-page',
      query.underlying,
      query.venues.join(','),
      query.range.start,
      query.range.end,
      query.cursor?.beforeTs ?? null,
      query.cursor?.beforeUid ?? null,
      query.limit ?? 100,
    ],
    queryFn: () => fetchJson<BlockFlowHistoryResponse>(`/block-flow/history?${params.toString()}`),
    enabled: Boolean(query.underlying) && enabled,
  });
}

function buildHistoryParams(
  query: BlockHistoryPageQuery | { underlying: string; venues: string[]; range: HistoryRange },
): URLSearchParams {
  const params = new URLSearchParams({ underlying: query.underlying });
  if (query.venues.length > 0) params.set('venues', query.venues.join(','));
  if (query.range.start) params.set('start', query.range.start);
  if (query.range.end) params.set('end', query.range.end);
  if ('cursor' in query && query.cursor) {
    params.set('beforeTs', query.cursor.beforeTs);
    params.set('beforeUid', query.cursor.beforeUid);
  }
  if ('limit' in query && query.limit) params.set('limit', String(query.limit));
  return params;
}
