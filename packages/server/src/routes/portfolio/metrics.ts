import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import { PortfolioSourceSchema } from '@oggregator/protocol';

import {
  bootstrapPortfolioForAccount,
  getOrCreatePortfolioRuntime,
} from '../../portfolio-services.js';

const MetricsQuerySchema = z.object({
  forwardDays: z.coerce.number().int().min(0).max(365).optional(),
  source: z.string().optional(),
});

function getAccountId(req: FastifyRequest): string {
  return req.user?.accountId ?? DEFAULT_ACCOUNT_ID;
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
    await bootstrapPortfolioForAccount(accountId, source);
    const runtime = getOrCreatePortfolioRuntime(accountId, source);
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
