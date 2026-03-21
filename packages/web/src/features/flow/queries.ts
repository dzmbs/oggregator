import { useQuery } from "@tanstack/react-query";

import { fetchJson } from "@lib/http";

export interface TradeEvent {
  venue:       string;
  instrument:  string;
  underlying:  string;
  side:        "buy" | "sell";
  price:       number;
  size:        number;
  iv:          number | null;
  markPrice:   number | null;
  indexPrice:  number | null;
  isBlock:     boolean;
  timestamp:   number;
}

interface FlowResponse {
  underlying: string;
  count:      number;
  trades:     TradeEvent[];
}

export function useFlow(underlying: string) {
  return useQuery({
    queryKey: ["flow", underlying],
    queryFn:  () => fetchJson<FlowResponse>(`/flow?underlying=${underlying}&limit=200`),
    enabled:  Boolean(underlying),
    refetchInterval: 2_000,
  });
}
