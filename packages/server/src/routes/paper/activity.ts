import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import { paperTradingStore } from '../../trading-services.js';
import { listTradeActivities } from './workspace.js';

function getAccountId(req: FastifyRequest): string {
  return req.user?.accountId ?? DEFAULT_ACCOUNT_ID;
}

export async function paperActivityRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { limit?: string; tradeId?: string };
  }>('/paper/activity', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply
        .status(503)
        .send({ error: 'persistence_unavailable', message: 'DATABASE_URL not set' });
    }
    const accountId = getAccountId(req);
    const limit = Math.min(Number(req.query.limit ?? '100') || 100, 500);
    return { activity: await listTradeActivities(limit, req.query.tradeId, accountId) };
  });
}
