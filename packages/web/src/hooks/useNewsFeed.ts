import { useQuery } from '@tanstack/react-query';

import { fetchJson } from '@lib/http';
import type { NewsItem } from '@shared/news';

interface NewsResponse {
  count: number;
  items: NewsItem[];
}

export function useNewsFeed() {
  return useQuery({
    queryKey: ['news'],
    queryFn: () => fetchJson<NewsResponse>('/news?limit=30'),
    refetchInterval: 15_000,
    staleTime: 10_000,
    select: (data) => data.items,
  });
}
