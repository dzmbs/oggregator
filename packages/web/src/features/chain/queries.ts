import { useQuery } from "@tanstack/react-query";

import { fetchJson } from "@lib/http";
import type { EnrichedChainResponse } from "@shared/enriched";

// ── Response types matching the live API ──────────────────────────────────

interface UnderlyingsResponse {
  underlyings: string[];
  byVenue: Array<{ venue: string; underlyings: string[] }>;
}

interface ExpiriesResponse {
  underlying: string;
  expiries: string[];
  byVenue: Array<{ venue: string; expiries: string[] }>;
}

// ── Query key factories ───────────────────────────────────────────────────

export const chainKeys = {
  underlyings: ()                                                     => ["underlyings"] as const,
  expiries:    (underlying: string)                                   => ["expiries", underlying] as const,
  chain:       (underlying: string, expiry: string, venues: string[]) =>
    ["chain", underlying, expiry, venues.slice().sort().join(",")] as const,
  surface:     (underlying: string)                                   => ["surface", underlying] as const,
  venues:      ()                                                     => ["venues"] as const,
};

// ── Hooks ─────────────────────────────────────────────────────────────────

interface UnderlyingsResult {
  underlyings: string[];
  byVenue: Array<{ venue: string; underlyings: string[] }>;
}

export function useUnderlyings() {
  return useQuery({
    queryKey: chainKeys.underlyings(),
    queryFn:  () => fetchJson<UnderlyingsResponse>("/underlyings"),
    staleTime: 60_000,
    select: (data): UnderlyingsResult => {
      const order = ["BTC", "ETH", "SOL"];
      const sorted = [...data.underlyings].sort(
        (a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) -
                  (order.indexOf(b) === -1 ? 99 : order.indexOf(b)),
      );
      return { underlyings: sorted, byVenue: data.byVenue };
    },
  });
}

interface ExpiriesResult {
  expiries: string[];
  byVenue: Array<{ venue: string; expiries: string[] }>;
}

export function useExpiries(underlying: string) {
  return useQuery({
    queryKey: chainKeys.expiries(underlying),
    queryFn:  () => fetchJson<ExpiriesResponse>(`/expiries?underlying=${underlying}`),
    enabled:  Boolean(underlying),
    staleTime: 30_000,
    select: (data): ExpiriesResult => ({ expiries: data.expiries, byVenue: data.byVenue }),
  });
}

export function useChainQuery(underlying: string, expiry: string, venues: string[]) {
  const venueParam = venues.length > 0 ? `&venues=${venues.join(",")}` : "";
  return useQuery({
    queryKey: chainKeys.chain(underlying, expiry, venues),
    queryFn:  () =>
      fetchJson<EnrichedChainResponse>(
        `/chains?underlying=${underlying}&expiry=${expiry}${venueParam}`,
      ),
    enabled: Boolean(underlying && expiry),
    // No polling — useChainWs pushes live updates into this cache via server WS
  });
}

export function useVenues() {
  return useQuery({
    queryKey: chainKeys.venues(),
    queryFn:  () => fetchJson<string[]>("/venues"),
    staleTime: 5 * 60_000,
  });
}

// ── Stats (DVOL + spot) ───────────────────────────────────────────────────

export interface StatsResponse {
  underlying: string;
  spot: {
    price:         number;
    change24hPct:  number;
    high24h:       number;
    low24h:        number;
  } | null;
  dvol: {
    current:    number;
    ivr:        number;
    ivChange1d: number;
    high52w:    number;
    low52w:     number;
  } | null;
}

export function useStats(underlying: string) {
  return useQuery({
    queryKey: ["stats", underlying],
    queryFn:  () => fetchJson<StatsResponse>(`/stats?underlying=${underlying}`),
    enabled:  Boolean(underlying),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}
