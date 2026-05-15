import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type {
  InstrumentCandle,
  InstrumentCandleInterval,
  InstrumentCandleRange,
  InstrumentCandlesResponse,
  VenueId,
} from '@oggregator/protocol';
import { fetchJson } from '@lib/http';
import type { EnrichedChainResponse } from '@shared/enriched';

export function applyLiveTick(
  candles: readonly InstrumentCandle[],
  liveMid: number | null,
): InstrumentCandle[] {
  if (liveMid == null || candles.length === 0) return candles as InstrumentCandle[];
  const last = candles[candles.length - 1]!;
  const next: InstrumentCandle = {
    ...last,
    c: liveMid,
    h: Math.max(last.h, liveMid),
    l: Math.min(last.l, liveMid),
  };
  return [...candles.slice(0, -1), next];
}

interface UseInstrumentCandlesArgs {
  venue: VenueId;
  symbol: string;
  interval: InstrumentCandleInterval;
  range: InstrumentCandleRange;
  enabled?: boolean;
  liveMid?: number | null;
}

export function useInstrumentCandles({
  venue,
  symbol,
  interval,
  range,
  enabled = true,
  liveMid = null,
}: UseInstrumentCandlesArgs) {
  const query = useQuery<InstrumentCandlesResponse>({
    queryKey: ['instrument-candles', venue, symbol, interval, range],
    queryFn: () =>
      fetchJson<InstrumentCandlesResponse>(
        `/instrument-candles?venue=${venue}&symbol=${encodeURIComponent(symbol)}&interval=${interval}&range=${range}`,
      ),
    enabled,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const candles = useMemo(
    () => applyLiveTick(query.data?.candles ?? [], liveMid),
    [query.data?.candles, liveMid],
  );

  return {
    ...query,
    candles,
    markLine: query.data?.markLine ?? [],
  };
}

export function useLiveMidFromChain(
  underlying: string,
  expiry: string,
  strike: number,
  type: 'call' | 'put',
  venue: VenueId,
): number | null {
  const qc = useQueryClient();
  const entries = qc.getQueriesData<EnrichedChainResponse>({
    queryKey: ['chain', underlying, expiry],
  });
  for (const [, data] of entries) {
    if (!data) continue;
    const row = data.strikes.find((s) => s.strike === strike);
    if (!row) continue;
    const side = type === 'call' ? row.call : row.put;
    const mid = side.venues[venue]?.mid;
    if (mid != null) return mid;
  }
  return null;
}
