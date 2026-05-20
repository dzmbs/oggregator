// packages/web/src/features/analytics/oi-by-strike/queries.ts
import { useQuery } from '@tanstack/react-query';

import { fetchJson } from '@lib/http';
import type {
  SpotCandleCurrency,
  SpotCandleResolutionSec,
  SpotCandlesResponse,
} from '@shared/common';

export function useSpotCandles(
  currency: SpotCandleCurrency,
  resolution: SpotCandleResolutionSec,
  buckets: number,
) {
  return useQuery({
    queryKey: ['spot-candles', currency, resolution, buckets],
    queryFn: () =>
      fetchJson<SpotCandlesResponse>(
        `/spot-candles?currency=${currency}&resolution=${resolution}&buckets=${buckets}`,
      ),
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev: SpotCandlesResponse | undefined) => prev,
  });
}
