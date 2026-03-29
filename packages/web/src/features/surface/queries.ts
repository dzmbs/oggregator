import { useQuery } from '@tanstack/react-query';

import { fetchJson } from '@lib/http';
import type { IvSurfaceResponse } from '@shared/enriched';

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
