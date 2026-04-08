import { useQuery } from '@tanstack/react-query';

import { useExpiries } from '@features/chain';
import { VENUE_IDS } from '@lib/venue-meta';
import { fetchJson } from '@lib/http';
import type { EnrichedChainResponse, IvSurfaceResponse } from '@shared/enriched';

export const surfaceKeys = {
  surface: (underlying: string, venues: string[]) =>
    ['surface', underlying, venues.slice().sort().join(',')] as const,
};

export function useSurface(underlying: string, venues: string[]) {
  const venueParam = venues.length > 0 ? `&venues=${venues.join(',')}` : '';
  return useQuery({
    queryKey: surfaceKeys.surface(underlying, venues),
    queryFn: () => fetchJson<IvSurfaceResponse>(`/surface?underlying=${underlying}${venueParam}`),
    enabled: Boolean(underlying),
    staleTime: 10_000,
    refetchInterval: 15_000,
    placeholderData: (prev: IvSurfaceResponse | undefined) => prev,
  });
}

export function useAllExpiriesSmile(underlying: string, enabled: boolean) {
  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const venueParam = `&venues=${VENUE_IDS.join(',')}`;

  return useQuery({
    queryKey: ['smile-all', underlying, expiries.join(',')],
    queryFn: async (): Promise<EnrichedChainResponse[]> => {
      const results = await Promise.all(
        expiries.map((exp) =>
          fetchJson<EnrichedChainResponse>(
            `/chains?underlying=${underlying}&expiry=${exp}${venueParam}`,
          ),
        ),
      );
      return results;
    },
    enabled: Boolean(underlying && expiries.length > 0 && enabled),
    staleTime: 30_000,
    placeholderData: (prev: EnrichedChainResponse[] | undefined) => prev,
  });
}
