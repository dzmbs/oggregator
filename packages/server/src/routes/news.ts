import type { FastifyInstance } from 'fastify';
import { newsService } from '../services.js';

export async function newsRoute(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string; since?: string } }>('/news', async (req, reply) => {
    if (!newsService) {
      return { count: 0, items: [] };
    }

    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      return reply.status(400).send({ error: 'limit must be an integer in [1, 200]' });
    }

    const items = (() => {
      if (req.query.since === undefined) return newsService.getItems({ limit });
      const parsed = Date.parse(req.query.since);
      if (Number.isNaN(parsed)) return null;
      return newsService.getItems({ limit, since: parsed });
    })();

    if (items === null) {
      return reply.status(400).send({ error: 'invalid since param' });
    }
    return { count: items.length, items };
  });
}
