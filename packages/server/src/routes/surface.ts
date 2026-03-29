import type { FastifyInstance } from 'fastify';
import {
  getAllAdapters,
  getAdapter,
  buildComparisonChain,
  buildEnrichedChain,
  computeIvSurface,
  computeTermStructure,
  computeDte,
  computeChainStats,
  type VenueId,
  type ChainRequest,
  type IvSurfaceRow,
  type TermStructure,
  VENUE_IDS,
} from '@oggregator/core';

export async function surfaceRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { underlying: string; venues?: string };
  }>('/surface', async (req, reply) => {
    const { underlying, venues: venuesParam } = req.query;

    if (!underlying) {
      return reply.status(400).send({ error: 'underlying query param required' });
    }

    const requestedVenues: VenueId[] = venuesParam
      ? (venuesParam.split(',').filter((v) => VENUE_IDS.includes(v as VenueId)) as VenueId[])
      : getAllAdapters().map((a) => a.venue);

    const allExpiries = new Set<string>();
    for (const venueId of requestedVenues) {
      try {
        const adapter = getAdapter(venueId);
        const expiries = await adapter.listExpiries(underlying);
        for (const e of expiries) allExpiries.add(e);
      } catch {
        // Not all venues list every underlying
      }
    }

    const sortedExpiries = [...allExpiries].sort();
    const surface: IvSurfaceRow[] = [];

    for (const expiry of sortedExpiries) {
      const request: ChainRequest = { underlying, expiry, venues: requestedVenues };

      const venueChains = await Promise.allSettled(
        requestedVenues.map(async (venueId) => {
          const adapter = getAdapter(venueId);
          return adapter.fetchOptionChain(request);
        }),
      );

      const chains = venueChains
        .filter((r) => r.status === 'fulfilled')
        .map(
          (r) =>
            (
              r as PromiseFulfilledResult<
                Awaited<ReturnType<ReturnType<typeof getAdapter>['fetchOptionChain']>>
              >
            ).value,
        );

      if (chains.length === 0) continue;

      const comparison = buildComparisonChain(underlying, expiry, chains);
      const enriched = buildEnrichedChain(underlying, expiry, comparison.rows, chains);
      const stats = computeChainStats(enriched.strikes, chains);
      const row = computeIvSurface(
        expiry,
        computeDte(expiry),
        enriched.strikes,
        stats.indexPriceUsd ?? stats.spotIndexUsd,
      );
      surface.push(row);
    }

    const termStructure: TermStructure = computeTermStructure(surface);

    return {
      underlying,
      surface,
      termStructure,
    };
  });
}
