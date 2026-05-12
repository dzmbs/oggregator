import type { FastifyInstance } from 'fastify';

import { portfolioMetricsRoute } from './metrics.js';
import { portfolioPositionsRoute } from './positions.js';
import { portfolioScenariosRoute } from './scenarios.js';
import { portfolioVenueCredentialsRoute } from './venue-credentials.js';
import { portfolioWsRoute } from './ws.js';

export async function portfolioRoutes(app: FastifyInstance) {
  await portfolioPositionsRoute(app);
  await portfolioMetricsRoute(app);
  await portfolioScenariosRoute(app);
  await portfolioVenueCredentialsRoute(app);
}

export { portfolioWsRoute };
