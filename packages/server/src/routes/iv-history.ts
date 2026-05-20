import type { FastifyInstance } from 'fastify';
import { isIvHistoryReady, ivHistoryService } from '../services.js';

export async function ivHistoryRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { underlying?: string; window?: string };
  }>('/iv-history', async (req, reply) => {
    if (!isIvHistoryReady()) {
      return reply.status(503).send({ error: 'IV history service not available' });
    }

    const underlying = (req.query.underlying ?? 'BTC').toUpperCase();
    const windowDays = req.query.window === '90d' ? 90 : 30;

    return ivHistoryService.query(underlying, windowDays);
  });
}
