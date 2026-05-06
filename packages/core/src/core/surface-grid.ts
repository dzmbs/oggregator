import type { VenueId } from '../types/common.js';
import { getAdapter, getAllAdapters } from './registry.js';
import { buildComparisonChain } from './aggregator.js';
import {
  buildEnrichedChain,
  computeChainStats,
  computeDte,
  computeIvSurface,
  computeIvSurfaceFine,
  type EnrichedStrike,
  type IvSurfaceRow,
  type IvSurfaceFineRow,
} from './enrichment.js';
import { smoothFineSurfaceRow } from './iv-surface-smoothing.js';
import type { ChainRequest, VenueOptionChain } from './types.js';

const DAYS_IN_YEAR = 365;

export interface SurfaceGridEntry {
  expiry: string;
  dte: number;
  surfaceRow: IvSurfaceRow;
  surfaceFineRow: IvSurfaceFineRow;
  surfaceFineSmoothedRow: IvSurfaceFineRow;
  atmStrike: EnrichedStrike | null;
  strikes: EnrichedStrike[];
  // Per-expiry basis as a percentage of spot. Surfaced here so consumers that
  // already iterate the grid (e.g. RegimeService for 30d-CMM basis) don't
  // need to re-call computeChainStats.
  basisPct: number | null;
}

export interface BuildSurfaceGridOptions {
  underlying: string;
  venues?: VenueId[];
}

/**
 * Builds an IV surface grid (one row per listed expiry) by fetching chains
 * from each requested venue and running shared enrichment.
 *
 * Extracted from the /api/surface route so the same code path feeds the
 * REST response and the IvHistoryService snapshot loop.
 */
export async function buildIvSurfaceGrid({
  underlying,
  venues,
}: BuildSurfaceGridOptions): Promise<SurfaceGridEntry[]> {
  const requestedVenues: VenueId[] = venues ?? getAllAdapters().map((a) => a.venue);

  const allExpiries = new Set<string>();
  for (const venueId of requestedVenues) {
    try {
      const adapter = getAdapter(venueId);
      const expiries = await adapter.listExpiries(underlying);
      for (const e of expiries) allExpiries.add(e);
    } catch {
      // Not every venue lists every underlying.
    }
  }

  const sortedExpiries = [...allExpiries].sort();
  const entries: SurfaceGridEntry[] = [];

  for (const expiry of sortedExpiries) {
    const request: ChainRequest = { underlying, expiry, venues: requestedVenues };

    const settled = await Promise.allSettled(
      requestedVenues.map((venueId) => getAdapter(venueId).fetchOptionChain(request)),
    );

    const chains: VenueOptionChain[] = settled
      .filter((r): r is PromiseFulfilledResult<VenueOptionChain> => r.status === 'fulfilled')
      .map((r) => r.value);

    if (chains.length === 0) continue;

    const comparison = buildComparisonChain(underlying, expiry, chains);
    const enriched = buildEnrichedChain(underlying, expiry, comparison.rows, chains);
    const stats = computeChainStats(enriched.strikes, chains);
    const refPrice = stats.indexPriceUsd ?? stats.forwardPriceUsd;
    const dte = computeDte(expiry);
    const surfaceRow = computeIvSurface(expiry, dte, enriched.strikes, refPrice);
    const surfaceFineRow = computeIvSurfaceFine(expiry, dte, enriched.strikes);
    const T = dte > 0 ? dte / DAYS_IN_YEAR : 0;
    const surfaceFineSmoothedRow = smoothFineSurfaceRow(
      surfaceFineRow,
      enriched.strikes,
      refPrice,
      T,
    );

    let atmStrike: EnrichedStrike | null = null;
    if (refPrice != null && enriched.strikes.length > 0) {
      let bestDist = Infinity;
      for (const s of enriched.strikes) {
        const dist = Math.abs(s.strike - refPrice);
        if (dist < bestDist) {
          bestDist = dist;
          atmStrike = s;
        }
      }
    }

    entries.push({
      expiry,
      dte,
      surfaceRow,
      surfaceFineRow,
      surfaceFineSmoothedRow,
      atmStrike,
      strikes: enriched.strikes,
      basisPct: stats.basisPct,
    });
  }

  return entries;
}
