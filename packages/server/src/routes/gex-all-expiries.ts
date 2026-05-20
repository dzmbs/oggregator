import type { FastifyInstance } from 'fastify';
import {
  combineGex,
  getAllAdapters,
  VENUE_IDS,
  type GexStrike,
  type VenueId,
} from '@oggregator/core';
import { chainEngines } from '../chain-engines.js';

function parseVenues(venuesParam: string | undefined): VenueId[] {
  return venuesParam
    ? (venuesParam.split(',').filter((venue) => VENUE_IDS.includes(venue as VenueId)) as VenueId[])
    : getAllAdapters().map((adapter) => adapter.venue);
}

async function collectUnderlyingExpiries(underlying: string): Promise<string[]> {
  const adapters = getAllAdapters();
  const lists = await Promise.all(adapters.map((a) => a.listExpiries(underlying)));
  const all = new Set<string>();
  for (const list of lists) {
    for (const expiry of list) all.add(expiry);
  }
  return Array.from(all).sort();
}

export interface AllExpiriesGexResponse {
  underlying: string;
  expiries: string[];
  spotPrice: number | null;
  gex: GexStrike[];
}

export async function gexAllExpiriesRoute(app: FastifyInstance) {
  chainEngines.start();

  app.get<{ Querystring: { underlying: string; venues?: string } }>(
    '/gex-all-expiries',
    async (req, reply): Promise<AllExpiriesGexResponse | { error: string }> => {
      const { underlying, venues: venuesParam } = req.query;
      if (!underlying) {
        return reply.status(400).send({ error: 'underlying query param required' });
      }

      const requestedVenues = parseVenues(venuesParam);
      const expiries = await collectUnderlyingExpiries(underlying);
      if (expiries.length === 0) {
        return { underlying, expiries: [], spotPrice: null, gex: [] };
      }

      // Acquire one runtime per expiry, fetch its snapshot, then release.
      // The chain runtime registry dedupes per (underlying, expiry, venues)
      // so warm tabs are reused; cold expiries spin up subscriptions which
      // the idle TTL eventually disposes.
      const handles = await Promise.all(
        expiries.map((expiry) =>
          chainEngines.acquire({ underlying, expiry, venues: requestedVenues }),
        ),
      );

      try {
        const snapshots = await Promise.all(
          handles.map((handle) => handle.runtime.fetchSnapshotData()),
        );

        const perExpiryGex = snapshots.map((snap) => snap.gex);
        const aggregated = combineGex(perExpiryGex);

        // Spot reference: take the first snapshot's indexPrice (falls back to
        // forwardPrice). All expiries on the same underlying share the same
        // spot at any instant; per-expiry forwards may differ by basis.
        const first = snapshots[0];
        const spotPrice =
          first != null ? (first.stats.indexPriceUsd ?? first.stats.forwardPriceUsd) : null;

        return { underlying, expiries, spotPrice, gex: aggregated };
      } finally {
        await Promise.allSettled(handles.map((handle) => handle.release()));
      }
    },
  );
}
