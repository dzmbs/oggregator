import type { VenueId } from '../types/common.js';
import { getAdapter, getAllAdapters } from './registry.js';
import { buildComparisonChain } from './aggregator.js';
import {
  buildEnrichedChain,
  computeChainStats,
  computeDte,
  computeIvSurface,
  computeIvSurfaceFine,
  ULTRA_FINE_DELTA_GRID,
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
  venueSurfaceFineRow: Partial<Record<VenueId, IvSurfaceFineRow>>;
  venueSurfaceFineSmoothedRow: Partial<Record<VenueId, IvSurfaceFineRow>>;
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
  // Default false — per-venue surfaces add ~5× SVI fits per expiry. Only the
  // /api/surface route needs them; IvHistoryService and RegimeService consume
  // the cross-venue rows only and should leave this off.
  includeVenueSurfaces?: boolean;
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
  includeVenueSurfaces = false,
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
      ULTRA_FINE_DELTA_GRID,
    );

    const venueSurfaceFineRow: Partial<Record<VenueId, IvSurfaceFineRow>> = {};
    const venueSurfaceFineSmoothedRow: Partial<Record<VenueId, IvSurfaceFineRow>> = {};
    if (includeVenueSurfaces) {
      for (const v of requestedVenues) {
        const fine = computeIvSurfaceFine(expiry, dte, enriched.strikes, v);
        if (fine.ivs.every((iv) => iv == null)) continue;
        venueSurfaceFineRow[v] = fine;
        venueSurfaceFineSmoothedRow[v] = smoothFineSurfaceRow(
          fine,
          enriched.strikes,
          refPrice,
          T,
          ULTRA_FINE_DELTA_GRID,
          v,
        );
      }
    }

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
      venueSurfaceFineRow,
      venueSurfaceFineSmoothedRow,
      atmStrike,
      strikes: enriched.strikes,
      basisPct: stats.basisPct,
    });
  }

  return entries;
}
