import type { FastifyInstance, FastifyRequest } from 'fastify';

import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';

import {
  bootstrapPortfolioForAccount,
  getOrCreatePortfolioRuntime,
} from '../../portfolio-services.js';

interface MetricsQuery {
  forwardDays?: string;
}

function getAccountId(req: FastifyRequest): string {
  return req.user?.accountId ?? DEFAULT_ACCOUNT_ID;
}

function parseForwardDays(raw: string | undefined): number {
  if (raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 365) return 0;
  return Math.floor(n);
}

export async function portfolioMetricsRoute(app: FastifyInstance) {
  app.get<{ Querystring: MetricsQuery }>(
    '/portfolio/metrics',
    async (req) => {
      const accountId = getAccountId(req);
      await bootstrapPortfolioForAccount(accountId);
      const runtime = getOrCreatePortfolioRuntime(accountId);
      const forwardDays = parseForwardDays(req.query.forwardDays);
      runtime.setForwardDays(forwardDays);
      const snapshot = runtime.getSnapshot();
      if (snapshot == null) {
        return { accountId, metrics: null, positions: [] };
      }
      return { accountId, metrics: snapshot.metrics, positions: snapshot.positions };
    },
  );
}
