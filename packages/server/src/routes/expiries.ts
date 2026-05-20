import type { FastifyInstance } from 'fastify';
import { getAllAdapters, type OptionVenueAdapter } from '@oggregator/core';

export async function expiriesRoute(app: FastifyInstance) {
  app.get<{ Querystring: { underlying: string } }>('/expiries', async (req, reply) => {
    const { underlying } = req.query;
    if (!underlying) {
      return reply.status(400).send({ error: 'underlying query param required' });
    }

    const adapters = getAllAdapters();
    const results = await Promise.all(
      adapters.map(async (a: OptionVenueAdapter) => ({
        venue: a.venue,
        expiries: await a.listExpiries(underlying),
        timestamps: (await a.listExpiryTimestamps?.(underlying)) ?? [],
      })),
    );

    const all = new Set<string>();
    const minTsByExpiry = new Map<string, number>();
    for (const r of results) {
      for (const e of r.expiries) all.add(e);
      for (const { expiry, expiryTs } of r.timestamps) {
        if (expiryTs == null) continue;
        const prev = minTsByExpiry.get(expiry);
        if (prev === undefined || expiryTs < prev) minTsByExpiry.set(expiry, expiryTs);
      }
    }

    const expiries = Array.from(all).sort();
    const timestamps = expiries.map((expiry) => ({
      expiry,
      expiryTs: minTsByExpiry.get(expiry) ?? null,
    }));

    return {
      underlying,
      expiries,
      timestamps,
      byVenue: results,
    };
  });
}
