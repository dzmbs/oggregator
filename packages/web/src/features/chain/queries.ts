import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { fetchJson } from '@lib/http';
import type { EnrichedChainResponse, GexStrike } from '@shared/enriched';

// ── Response types matching the live API ──────────────────────────────────

interface UnderlyingsResponse {
  underlyings: string[];
  byVenue: Array<{ venue: string; underlyings: string[] }>;
}

export interface ExpiryTimestamp {
  expiry: string;
  expiryTs: number | null;
}

interface ExpiriesResponse {
  underlying: string;
  expiries: string[];
  timestamps?: ExpiryTimestamp[];
  byVenue: Array<{ venue: string; expiries: string[]; timestamps?: ExpiryTimestamp[] }>;
}

// ── Query key factories ───────────────────────────────────────────────────

export const chainKeys = {
  underlyings: () => ['underlyings'] as const,
  expiries: (underlying: string) => ['expiries', underlying] as const,
  chain: (underlying: string, expiry: string, venues: string[]) =>
    ['chain', underlying, expiry, venues.slice().sort().join(',')] as const,
  gexAllExpiries: (underlying: string, venues: string[]) =>
    ['gex-all-expiries', underlying, venues.slice().sort().join(',')] as const,
  surface: (underlying: string) => ['surface', underlying] as const,
  venues: () => ['venues'] as const,
};

export interface AllExpiriesGexResponse {
  underlying: string;
  expiries: string[];
  spotPrice: number | null;
  gex: GexStrike[];
}

// ── Hooks ─────────────────────────────────────────────────────────────────

interface UnderlyingsResult {
  underlyings: string[];
  byVenue: Array<{ venue: string; underlyings: string[] }>;
}

export function useUnderlyings() {
  return useQuery({
    queryKey: chainKeys.underlyings(),
    queryFn: () => fetchJson<UnderlyingsResponse>('/underlyings'),
    staleTime: 60_000,
    select: (data): UnderlyingsResult => {
      const order = ['BTC', 'ETH', 'SOL'];
      const sorted = [...data.underlyings].sort(
        (a, b) =>
          (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) -
          (order.indexOf(b) === -1 ? 99 : order.indexOf(b)),
      );
      return { underlyings: sorted, byVenue: data.byVenue };
    },
  });
}

interface ExpiriesResult {
  expiries: string[];
  timestamps: ExpiryTimestamp[];
  byVenue: Array<{ venue: string; expiries: string[] }>;
}

export function useExpiries(underlying: string) {
  return useQuery({
    queryKey: chainKeys.expiries(underlying),
    queryFn: () => fetchJson<ExpiriesResponse>(`/expiries?underlying=${underlying}`),
    enabled: Boolean(underlying),
    staleTime: 30_000,
    placeholderData: (prev: ExpiriesResponse | undefined) => prev,
    select: (data): ExpiriesResult => ({
      expiries: data.expiries,
      timestamps: data.timestamps ?? data.expiries.map((expiry) => ({ expiry, expiryTs: null })),
      byVenue: data.byVenue,
    }),
  });
}

export function useChainQuery(
  underlying: string,
  expiry: string,
  venues: string[],
  options?: { refetchInterval?: number; enabled?: boolean },
) {
  const venueParam = venues.length > 0 ? `&venues=${venues.join(',')}` : '';
  return useQuery({
    queryKey: chainKeys.chain(underlying, expiry, venues),
    queryFn: () =>
      fetchJson<EnrichedChainResponse>(
        `/chains?underlying=${underlying}&expiry=${expiry}${venueParam}`,
      ),
    enabled: Boolean(underlying && expiry) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval,
  });
}

/**
 * Returns a stable prefetch callback for the chain query. Wire it to hover /
 * pointer-enter on tenor tabs: by the time the user clicks, the REST response
 * has populated TanStack cache AND warmed the server-side runtime, so the
 * subsequent WS resubscribe gets an in-memory snapshot back instantly.
 */
export function usePrefetchChain(underlying: string, activeVenues: string[]) {
  const qc = useQueryClient();
  return useCallback(
    (targetExpiry: string) => {
      if (!underlying || !targetExpiry) return;
      const venueParam =
        activeVenues.length > 0 ? `&venues=${activeVenues.join(',')}` : '';
      void qc.prefetchQuery({
        queryKey: chainKeys.chain(underlying, targetExpiry, activeVenues),
        queryFn: () =>
          fetchJson<EnrichedChainResponse>(
            `/chains?underlying=${underlying}&expiry=${targetExpiry}${venueParam}`,
          ),
        staleTime: 10_000,
      });
    },
    [qc, underlying, activeVenues],
  );
}

export function useAllExpiriesGex(
  underlying: string,
  venues: string[],
  options?: { enabled?: boolean; refetchInterval?: number },
) {
  const venueParam = venues.length > 0 ? `&venues=${venues.join(',')}` : '';
  return useQuery({
    queryKey: chainKeys.gexAllExpiries(underlying, venues),
    queryFn: () =>
      fetchJson<AllExpiriesGexResponse>(`/gex-all-expiries?underlying=${underlying}${venueParam}`),
    enabled: Boolean(underlying) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? 15_000,
    staleTime: 10_000,
  });
}

export function useVenues() {
  return useQuery({
    queryKey: chainKeys.venues(),
    queryFn: () => fetchJson<string[]>('/venues'),
    staleTime: 5 * 60_000,
  });
}

// ── Stats (DVOL + spot) ───────────────────────────────────────────────────

export interface StatsResponse {
  underlying: string;
  spot: {
    price: number;
    change24hPct: number;
    high24h: number;
    low24h: number;
  } | null;
  dvol: {
    current: number;
    ivr: number;
    ivChange1d: number;
    high52w: number;
    low52w: number;
  } | null;
}

export function useStats(underlying: string) {
  return useQuery({
    queryKey: ['stats', underlying],
    queryFn: () => fetchJson<StatsResponse>(`/stats?underlying=${underlying}`),
    enabled: Boolean(underlying),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}
