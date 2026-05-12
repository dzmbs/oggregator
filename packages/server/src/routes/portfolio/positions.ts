import type { FastifyInstance, FastifyRequest } from 'fastify';

import { generateLegId } from '@oggregator/core';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import {
  PositionLegInputSchema,
  type PositionLeg,
} from '@oggregator/protocol';

import {
  ensureChainForLeg,
  getOrCreatePortfolioRuntime,
  portfolioStore,
} from '../../portfolio-services.js';
import { portfolioEvents } from './events.js';

function getAccountId(req: FastifyRequest): string {
  return req.user?.accountId ?? DEFAULT_ACCOUNT_ID;
}

export async function portfolioPositionsRoute(app: FastifyInstance) {
  app.get('/portfolio/positions', async (req) => {
    const accountId = getAccountId(req);
    return { accountId, positions: portfolioStore.list(accountId) };
  });

  app.post('/portfolio/positions', async (req, reply) => {
    const parsed = PositionLegInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const accountId = getAccountId(req);
    const input = parsed.data;
    const leg: PositionLeg = {
      legId: input.legId ?? generateLegId(),
      underlying: input.underlying,
      expiry: input.expiry,
      strike: input.strike,
      optionRight: input.optionRight,
      size: input.size,
      entryPriceUsd: input.entryPriceUsd,
      entryIv: input.entryIv,
      entryTs: input.entryTs ?? Date.now(),
      venueHint: input.venueHint,
      source: input.source,
    };
    const stored = portfolioStore.upsert(accountId, leg);
    void ensureChainForLeg(stored);
    getOrCreatePortfolioRuntime(accountId);
    return reply.status(201).send({ leg: stored });
  });

  app.delete<{ Params: { legId: string } }>(
    '/portfolio/positions/:legId',
    async (req, reply) => {
      const accountId = getAccountId(req);
      const removed = portfolioStore.remove(accountId, req.params.legId);
      if (!removed) {
        return reply.status(404).send({ error: 'not_found', legId: req.params.legId });
      }
      return { legId: req.params.legId, removed: true };
    },
  );
}

export { portfolioEvents };
