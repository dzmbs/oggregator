import type { FastifyInstance } from 'fastify';
import { getRegisteredVenues } from '@oggregator/core';
import { isReady } from '../app.js';
import { isDvolReady, isFlowReady, isSpotReady } from '../services.js';

export async function healthRoute(app: FastifyInstance) {
  app.get('/health', async () => ({
    // 'ok' means adapters are ready to serve chain/surface/GEX data.
    // Services (flow, dvol, spot) boot in the background and have their own
    // 503 guards — their state is reported here for observability only.
    status: isReady() ? 'ok' : 'initializing',
    venues: getRegisteredVenues(),
    services: {
      flow: isFlowReady(),
      dvol: isDvolReady(),
      spot: isSpotReady(),
    },
    ts: Date.now(),
  }));
}
