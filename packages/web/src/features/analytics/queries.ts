import { useQuery } from '@tanstack/react-query';

import { fetchJson } from '@lib/http';
import type { EnrichedChainResponse } from '@shared/enriched';
import { useExpiries } from '@features/chain/queries';

/**
 * Fetches chain data for ALL expiries of an underlying and merges them.
 * Used by analytics charts that need cross-expiry aggregation (OI by strike,
 * volume by venue, put/call ratio).
 */
export function useAllExpiriesChain(underlying: string, venues: string[]) {
  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];

  return useQuery({
    queryKey: ['analytics', underlying, venues.join(','), expiries.join(',')],
    queryFn: async (): Promise<EnrichedChainResponse[]> => {
      const venueParam = venues.length > 0 ? `&venues=${venues.join(',')}` : '';
      const results = await Promise.all(
        expiries.map((exp) =>
          fetchJson<EnrichedChainResponse>(
            `/chains?underlying=${underlying}&expiry=${exp}${venueParam}`,
          ),
        ),
      );
      return results;
    },
    enabled: Boolean(underlying && expiries.length > 0),
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev: EnrichedChainResponse[] | undefined) => prev,
  });
}
