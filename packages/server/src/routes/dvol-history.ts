import type { FastifyInstance } from 'fastify';
import { dvolService, isDvolReady } from '../services.js';

export async function dvolHistoryRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { currency?: string };
  }>('/dvol-history', async (req, reply) => {
    if (!isDvolReady()) {
      return reply.status(503).send({ error: 'DVOL service not available' });
    }

    const currency = (req.query.currency ?? 'BTC').toUpperCase();
    const candles = dvolService.getHistory(currency);
    const hv = dvolService.getHv(currency);

    if (candles.length === 0) {
      return reply.status(404).send({ error: `No DVOL history for ${currency}` });
    }

    return { currency, count: candles.length, candles, hv };
  });
}
