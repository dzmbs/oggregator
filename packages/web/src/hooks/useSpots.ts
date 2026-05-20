import { useQuery } from '@tanstack/react-query';

import { fetchJson } from '@lib/http';
import type { SpotItem } from '@shared/news';

interface SpotsResponse {
  items: SpotItem[];
}

export function useSpots() {
  return useQuery({
    queryKey: ['spots'],
    queryFn: () => fetchJson<SpotsResponse>('/spots'),
    refetchInterval: 5_000,
    staleTime: 3_000,
    select: (data) => data.items,
  });
}
