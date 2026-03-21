import type { FastifyInstance } from 'fastify';
import { flowService, isFlowReady } from '../services.js';

export async function flowRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { underlying?: string; minNotional?: string; limit?: string };
  }>('/flow', async (req, reply) => {
    if (!isFlowReady()) {
      return reply.status(503).send({ error: 'flow service not available' });
    }
    const underlying = req.query.underlying ?? 'BTC';

    // Number(...) || fallback silently passes through negative values because they
    // are truthy. Use explicit finite + bounds checks instead.
    const rawMinNotional = Number(req.query.minNotional);
    const minNotional = Number.isFinite(rawMinNotional) && rawMinNotional >= 0 ? rawMinNotional : 0;

    const rawLimit = Number(req.query.limit);
    const limit = Math.min(
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 100,
      500,
    );

    const trades = flowService.getTrades(underlying, minNotional);

    return {
      underlying,
      count: trades.length,
      trades: trades.slice(-limit).reverse(),
    };
  });
}
