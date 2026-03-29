import type { FastifyInstance } from 'fastify';
import { getAllAdapters, VENUE_IDS, type VenueId } from '@oggregator/core';
import { chainEngines } from '../chain-engines.js';

function parseVenues(venuesParam: string | undefined): VenueId[] {
  return venuesParam
    ? (venuesParam.split(',').filter((venue) => VENUE_IDS.includes(venue as VenueId)) as VenueId[])
    : getAllAdapters().map((adapter) => adapter.venue);
}

export async function chainsRoute(app: FastifyInstance) {
  chainEngines.start();

  app.addHook('onClose', async () => {
    await chainEngines.dispose();
  });

  app.get<{
    Querystring: { underlying: string; expiry: string; venues?: string };
  }>('/chains', async (req, reply) => {
    const { underlying, expiry, venues: venuesParam } = req.query;

    if (!underlying || !expiry) {
      return reply.status(400).send({ error: 'underlying and expiry query params required' });
    }

    const requestedVenues = parseVenues(venuesParam);
    const { runtime, release } = await chainEngines.acquire({
      underlying,
      expiry,
      venues: requestedVenues,
    });

    try {
      return await runtime.fetchSnapshotData();
    } finally {
      await release();
    }
  });
}
