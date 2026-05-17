import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  findExistingForInput,
  foldManualLeg,
  generateLegId,
  type FoldContext,
} from '@oggregator/core';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import {
  PortfolioSourceSchema,
  PositionLegInputSchema,
  PositionLegSchema,
  type PortfolioSource,
} from '@oggregator/protocol';

import {
  ensureChainForLeg,
  getOrCreatePortfolioRuntime,
  listPositions,
  portfolioMarkProvider,
  portfolioStore,
} from '../../portfolio-services.js';
import { getRequestAccountId } from '../../user-service.js';
import { portfolioEvents } from './events.js';

function getAccountId(req: FastifyRequest): string {
  return getRequestAccountId(req, DEFAULT_ACCOUNT_ID);
}

function parseSource(raw: unknown): PortfolioSource {
  const parsed = PortfolioSourceSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'manual';
}

export async function portfolioPositionsRoute(app: FastifyInstance) {
  app.get<{ Querystring: { source?: string; underlying?: string } }>(
    '/portfolio/positions',
    async (req) => {
      const accountId = getAccountId(req);
      const source = parseSource(req.query.source);
      const underlying = req.query.underlying?.trim() || undefined;
      const all = listPositions(accountId, source);
      const positions =
        underlying == null ? all : all.filter((leg) => leg.underlying === underlying);
      return { accountId, source, positions };
    },
  );

  app.post('/portfolio/positions', async (req, reply) => {
    const parsed = PositionLegInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const accountId = getAccountId(req);
    const input = parsed.data;

    // Manual upserts dedup by natural key so "add another fill at the same
    // strike/right/expiry" averages into one leg instead of leaving N rows.
    // Other sources (paper, derive, thalex) come from their own stores; only
    // 'manual' is mutated through this route.
    const existing =
      input.source === 'manual'
        ? findExistingForInput(listPositions(accountId, 'manual'), input)
        : null;

    // Best-effort: ensure the chain is loaded so the mark provider has a
    // forward + T to back-solve a missing entryIv. This is a no-op when the
    // chain is already cached.
    if (existing == null || input.entryIv == null) {
      await ensureChainForLeg({
        legId: existing?.legId ?? 'pending',
        underlying: input.underlying,
        expiry: input.expiry,
        strike: input.strike,
        optionRight: input.optionRight,
        size: input.size,
        entryPriceUsd: input.entryPriceUsd,
        entryIv: input.entryIv,
        realizedPnlUsd: 0,
        entryTs: input.entryTs ?? Date.now(),
        venueHint: input.venueHint,
        source: input.source,
      });
    }

    const markProbeLeg = {
      legId: existing?.legId ?? 'probe',
      underlying: input.underlying,
      expiry: input.expiry,
      strike: input.strike,
      optionRight: input.optionRight,
      size: input.size,
      entryPriceUsd: input.entryPriceUsd,
      entryIv: input.entryIv,
      realizedPnlUsd: 0,
      entryTs: input.entryTs ?? Date.now(),
      venueHint: input.venueHint,
      source: input.source,
    };
    const mark = portfolioMarkProvider(markProbeLeg);

    const ctx: FoldContext = {
      mark,
      nowMs: Date.now(),
      generateLegId,
    };
    const folded = foldManualLeg(existing, input, ctx);
    if (folded == null) {
      // Fully closed by this upsert — remove the existing row.
      if (existing != null) portfolioStore.remove(accountId, existing.legId);
      return reply.status(200).send({ leg: null, closed: true });
    }
    const stored = portfolioStore.upsert(accountId, folded);
    void ensureChainForLeg(stored);
    getOrCreatePortfolioRuntime(accountId, 'manual');
    return reply.status(201).send({ leg: stored });
  });

  app.delete<{ Params: { legId: string } }>(
    '/portfolio/positions/:legId',
    async (req, reply) => {
      const accountId = getAccountId(req);
      const parsed = PositionLegSchema.shape.legId.safeParse(req.params.legId);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'invalid_legId', issues: parsed.error.issues });
      }
      const removed = portfolioStore.remove(accountId, parsed.data);
      if (!removed) {
        return reply.status(404).send({ error: 'not_found', legId: parsed.data });
      }
      return { legId: parsed.data, removed: true };
    },
  );
}

export { portfolioEvents };
