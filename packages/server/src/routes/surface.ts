import type { FastifyInstance } from 'fastify';
import {
  getAllAdapters,
  getAdapter,
  buildComparisonChain,
  buildEnrichedChain,
  computeIvSurface,
  computeTermStructure,
  computeDte,
  type VenueId,
  type ChainRequest,
  type IvSurfaceRow,
  type TermStructure,
  VENUE_IDS,
} from '@oggregator/core';

interface VenueAtmPoint {
  expiry: string;
  dte:    number;
  atm:    number | null;
}

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
    const venueAtm: Record<string, VenueAtmPoint[]> = {};

    for (const expiry of sortedExpiries) {
      const request: ChainRequest = { underlying, expiry, venues: requestedVenues };
      const dte = computeDte(expiry);

      const venueChains = await Promise.allSettled(
        requestedVenues.map(async (venueId) => {
          const adapter = getAdapter(venueId);
          return adapter.fetchOptionChain(request);
        }),
      );

      const chains = venueChains
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<ReturnType<typeof getAdapter>['fetchOptionChain']>>>).value);

      if (chains.length === 0) continue;

      const comparison = buildComparisonChain(underlying, expiry, chains);
      const enriched = buildEnrichedChain(underlying, expiry, comparison.rows, chains);
      const row = computeIvSurface(expiry, dte, enriched.strikes);
      surface.push(row);

      // Extract per-venue ATM IV — find ATM strike independently per venue
      // so venues with different strike grids still produce data
      for (const venueId of requestedVenues) {
        let bestStrike: typeof enriched.strikes[number] | null = null;
        let bestDist = Infinity;

        for (const s of enriched.strikes) {
          const quote = s.call.venues[venueId];
          if (!quote?.delta) continue;
          const dist = Math.abs(quote.delta - 0.5);
          if (dist < bestDist) {
            bestDist = dist;
            bestStrike = s;
          }
        }

        if (!venueAtm[venueId]) venueAtm[venueId] = [];
        const iv = bestStrike?.call.venues[venueId]?.markIv ?? null;
        venueAtm[venueId].push({ expiry, dte, atm: iv });
      }
    }

    const termStructure: TermStructure = computeTermStructure(surface);

    return {
      underlying,
      surface,
      venueAtm,
      termStructure,
    };
  });
}
