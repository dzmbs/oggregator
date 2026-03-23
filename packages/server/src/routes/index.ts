import type { FastifyInstance } from 'fastify';
import { isReady } from '../app.js';
import { healthRoute } from './health.js';
import { venuesRoute } from './venues.js';
import { underlyingsRoute } from './underlyings.js';
import { expiriesRoute } from './expiries.js';
import { chainsRoute } from './chains.js';
import { surfaceRoute } from './surface.js';
import { statsRoute } from './stats.js';
import { flowRoute } from './flow.js';
import { blockFlowRoute } from './block-flow.js';
import { dvolHistoryRoute } from './dvol-history.js';
import { wsChainRoute } from './ws-chain.js';

export function registerRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (_req, reply) => {
    if (!isReady() && _req.url !== '/api/health' && !_req.url.startsWith('/ws/')) {
      return reply.status(503).send({ error: 'initializing', message: 'Server is loading market data' });
    }
  });

  app.register(healthRoute, { prefix: '/api' });
  app.register(venuesRoute, { prefix: '/api' });
  app.register(underlyingsRoute, { prefix: '/api' });
  app.register(expiriesRoute, { prefix: '/api' });
  app.register(chainsRoute, { prefix: '/api' });
  app.register(surfaceRoute, { prefix: '/api' });
  app.register(statsRoute, { prefix: '/api' });
  app.register(flowRoute, { prefix: '/api' });
  app.register(blockFlowRoute, { prefix: '/api' });
  app.register(dvolHistoryRoute, { prefix: '/api' });
  app.register(wsChainRoute);
}
