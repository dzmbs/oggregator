import { useQuery } from '@tanstack/react-query';

import { fetchJson } from '@lib/http';
import type { RegimeLabel } from '@lib/analytics/verticalSpread';

export interface RegimeResponse {
  underlying: string;
  ts: number;
  observationCount: number;
  posterior: number[] | null;
  stateLabels: RegimeLabel[] | null;
  dominant: RegimeLabel | null;
  confidence: number | null;
  modelFittedAt: number | null;
  lastTransitionAt: number | null;
}

const SUPPORTED = new Set(['BTC', 'ETH']);

export function useRegimeQuery(underlying: string) {
  const key = underlying.toUpperCase();
  const enabled = SUPPORTED.has(key);
  return useQuery({
    queryKey: ['regime', key],
    queryFn: () => fetchJson<RegimeResponse>(`/regime/${key}`),
    enabled,
    // Regime moves on a 5-minute snapshot loop server-side; refetching every
    // minute is more than fast enough and keeps the trading gate responsive
    // without spamming the route.
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}
