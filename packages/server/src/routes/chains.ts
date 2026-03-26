import type { FastifyInstance } from 'fastify';
import {
  getAllAdapters,
  getAdapter,
  buildComparisonChain,
  buildEnrichedChain,
  type ChainRequest,
  type VenueId,
  type VenueStatus,
  VENUE_IDS,
} from '@oggregator/core';

interface ActiveSubscription {
  unsubscribe: () => Promise<void>;
  lastUsedAt: number;
}

const SUBSCRIPTION_IDLE_TTL_MS = 15 * 60 * 1000;
const activeSubscriptions = new Map<string, ActiveSubscription>();

function subKey(venue: VenueId, underlying: string, expiry: string) {
  return `${venue}:${underlying}:${expiry}`;
}

async function ensureSubscribed(venueId: VenueId, underlying: string, expiry: string, log: FastifyInstance['log']) {
  const key = subKey(venueId, underlying, expiry);
  const existing = activeSubscriptions.get(key);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return;
  }

  const adapter = getAdapter(venueId);
  if (!adapter.subscribe) return;

  try {
    const unsubscribe = await adapter.subscribe(
      { underlying, expiry },
      {
        onDelta: () => {},
        onStatus: (status: VenueStatus) => {
          if (status.state === 'degraded' || status.state === 'down') {
            log.warn({ venue: venueId, state: status.state }, status.message ?? 'venue degraded');
          }
        },
      },
    );
    activeSubscriptions.set(key, { unsubscribe, lastUsedAt: Date.now() });
    log.info({ venue: venueId, underlying }, 'ws subscription active');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ venue: venueId, underlying, err: message }, 'ws subscription failed');
  }
}

async function fetchChains(underlying: string, expiry: string, requestedVenues: VenueId[], log: FastifyInstance['log']) {
  cleanupStaleSubscriptions(log).catch(() => {});

  for (const venueId of requestedVenues) {
    ensureSubscribed(venueId, underlying, expiry, log).catch(() => {});
  }

  const request: ChainRequest = { underlying, expiry, venues: requestedVenues };

  const venueChains = await Promise.allSettled(
    requestedVenues.map(async (venueId) => {
      const adapter = getAdapter(venueId);
      return adapter.fetchOptionChain(request);
    }),
  );

  const successfulChains = venueChains
    .filter((r) => r.status === 'fulfilled')
    .map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<ReturnType<typeof getAdapter>['fetchOptionChain']>>>).value);

  return { request, successfulChains };
}

async function cleanupStaleSubscriptions(log: FastifyInstance['log']): Promise<void> {
  const cutoff = Date.now() - SUBSCRIPTION_IDLE_TTL_MS;

  for (const [key, subscription] of activeSubscriptions) {
    if (subscription.lastUsedAt >= cutoff) continue;

    activeSubscriptions.delete(key);
    try {
      await subscription.unsubscribe();
      log.info({ key }, 'ws subscription released');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ key, err: message }, 'ws unsubscribe failed');
    }
  }
}

function parseVenues(venuesParam: string | undefined): VenueId[] {
  return venuesParam
    ? (venuesParam.split(',').filter((v) => VENUE_IDS.includes(v as VenueId)) as VenueId[])
    : getAllAdapters().map((a) => a.venue);
}

export async function chainsRoute(app: FastifyInstance) {
  app.addHook('onClose', async () => {
    for (const [key, subscription] of activeSubscriptions) {
      activeSubscriptions.delete(key);
      await subscription.unsubscribe();
    }
  });

  app.get<{
    Querystring: { underlying: string; expiry: string; venues?: string };
  }>('/chains', async (req, reply) => {
    const { underlying, expiry, venues: venuesParam } = req.query;

    if (!underlying || !expiry) {
      return reply.status(400).send({ error: 'underlying and expiry query params required' });
    }

    const requestedVenues = parseVenues(venuesParam);
    const { successfulChains } = await fetchChains(underlying, expiry, requestedVenues, req.log);
    const comparison = buildComparisonChain(underlying, expiry, successfulChains);

    return buildEnrichedChain(underlying, expiry, comparison.rows, successfulChains);
  });
}
