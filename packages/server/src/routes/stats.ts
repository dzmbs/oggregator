import type { FastifyInstance } from 'fastify';
import { dvolService, spotService, isDvolReady, isSpotReady } from '../services.js';

export async function statsRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { underlying?: string };
  }>('/stats', async (req, reply) => {
    if (!isDvolReady() && !isSpotReady()) {
      return reply.status(503).send({ error: 'stats services initializing' });
    }
    const underlying = req.query.underlying ?? 'BTC';

    const dvol = dvolService.getSnapshot(underlying);
    const spot = spotService.getSnapshot(underlying);

    return {
      underlying,
      spot: spot
        ? {
            price: spot.lastPrice,
            change24hPct: spot.change24hPct,
            high24h: spot.high24h,
            low24h: spot.low24h,
          }
        : null,
      dvol: dvol
        ? {
            current: dvol.current,
            ivr: dvol.ivr,
            ivChange1d: dvol.ivChange1d,
            high52w: dvol.high52w,
            low52w: dvol.low52w,
          }
        : null,
    };
  });
}
