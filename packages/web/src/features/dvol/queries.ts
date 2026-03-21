import { useQuery } from "@tanstack/react-query";

import { fetchJson } from "@lib/http";

export interface DvolCandle {
  timestamp: number;
  open:      number;
  high:      number;
  low:       number;
  close:     number;
}

interface DvolHistoryResponse {
  currency: string;
  count:    number;
  candles:  DvolCandle[];
}

export function useDvolHistory(currency: string) {
  return useQuery({
    queryKey: ["dvol-history", currency],
    queryFn:  () => fetchJson<DvolHistoryResponse>(`/dvol-history?currency=${currency}`),
    enabled:  Boolean(currency),
    staleTime: 5 * 60_000,
  });
}
