import type { FastifyInstance } from 'fastify';
import { isRegimeReady, regimeService } from '../services.js';

const SUPPORTED = new Set(['BTC', 'ETH']);

export async function regimeRoute(app: FastifyInstance) {
  app.get<{ Params: { underlying: string } }>(
    '/regime/:underlying',
    async (req, reply) => {
      if (!isRegimeReady()) {
        return reply.status(503).send({ error: 'Regime service not available' });
      }
      const underlying = req.params.underlying.toUpperCase();
      if (!SUPPORTED.has(underlying)) {
        return reply
          .status(404)
          .send({ error: `Regime detection is BTC/ETH only (got ${underlying})` });
      }
      return regimeService.query(underlying);
    },
  );
}
