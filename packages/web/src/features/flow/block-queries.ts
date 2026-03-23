import { useQuery } from "@tanstack/react-query";

import { fetchJson } from "@lib/http";

export interface BlockTradeLeg {
  instrument: string;
  direction: "buy" | "sell";
  price:     number;
  size:      number;
  ratio:     number;
}

export interface BlockTradeEvent {
  venue:        string;
  tradeId:      string;
  timestamp:    number;
  underlying:   string;
  direction:    "buy" | "sell";
  strategy:     string | null;
  legs:         BlockTradeLeg[];
  totalSize:    number;
  notionalUsd:  number;
  indexPrice:   number | null;
}

interface BlockFlowResponse {
  count:  number;
  trades: BlockTradeEvent[];
}

export function useBlockFlow(underlying?: string) {
  const params = underlying ? `?underlying=${underlying}&limit=200` : "?limit=200";
  return useQuery({
    queryKey: ["block-flow", underlying ?? "all"],
    queryFn:  () => fetchJson<BlockFlowResponse>(`/block-flow${params}`),
    refetchInterval: 30_000,
  });
}
