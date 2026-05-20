import type { FastifyInstance } from 'fastify';
import { paperAccountRoute } from './account.js';
import { paperActivityRoute } from './activity.js';
import { paperFillsRoute } from './fills.js';
import { paperOrdersRoute } from './orders.js';
import { paperPositionsRoute } from './positions.js';
import { paperPnlRoute } from './pnl.js';
import { paperSettleRoute } from './settle.js';
import { paperTradesRoute } from './trades.js';
import { paperWsRoute } from './ws.js';
import { requireUser } from '../../user-service.js';

export async function paperRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireUser());
  await paperAccountRoute(app);
  await paperOrdersRoute(app);
  await paperPositionsRoute(app);
  await paperPnlRoute(app);
  await paperTradesRoute(app);
  await paperActivityRoute(app);
  await paperFillsRoute(app);
  await paperSettleRoute(app);
}

export { paperWsRoute };
