import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import { PortfolioSourceSchema } from '@oggregator/protocol';

import {
  bootstrapPortfolioForAccount,
  getOrCreatePortfolioRuntime,
} from '../../portfolio-services.js';
import { getRequestAccountId } from '../../user-service.js';

const MetricsQuerySchema = z.object({
  forwardDays: z.coerce.number().int().min(0).max(365).optional(),
  source: z.string().optional(),
  underlying: z.string().min(1).optional(),
});

function getAccountId(req: FastifyRequest): string {
  return getRequestAccountId(req, DEFAULT_ACCOUNT_ID);
}

export async function portfolioMetricsRoute(app: FastifyInstance) {
  app.get('/portfolio/metrics', async (req, reply) => {
    const parsed = MetricsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    }
    const accountId = getAccountId(req);
    const sourceParsed = PortfolioSourceSchema.safeParse(parsed.data.source);
    const source = sourceParsed.success ? sourceParsed.data : 'manual';
    const underlying = parsed.data.underlying;
    await bootstrapPortfolioForAccount(accountId, source, underlying);
    const runtime = getOrCreatePortfolioRuntime(accountId, source, underlying);
    const forwardDays = parsed.data.forwardDays ?? 0;
    runtime.setForwardDays(forwardDays);
    const snapshot = runtime.getSnapshot();
    if (snapshot == null) {
      return { accountId, source, metrics: null, positions: [] };
    }
    return {
      accountId,
      source,
      metrics: snapshot.metrics,
      positions: snapshot.positions,
    };
  });
}
