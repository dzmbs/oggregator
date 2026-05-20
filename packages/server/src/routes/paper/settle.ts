import type { FastifyInstance } from 'fastify';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import { paperTradingStore } from '../../trading-services.js';
import { resolveSettlementSpot } from '../../settlement-service.js';
import { settleExpiredPositionsForAccount } from './workspace.js';

// Triggers an on-demand settlement scan for the requesting user's account.
// The daily 08:05-UTC cron remains the global mechanism; this endpoint is for
// dashboards/tests that want immediate settlement after manually backdating a
// position's expiry. Shares resolveSettlementSpot with the cron so the
// gateio-first → spot-runtime-fallback order is identical on both paths.
export async function paperSettleRoute(app: FastifyInstance) {
  app.post('/paper/settle-now', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send({ error: 'persistence_unavailable' });
    }
    const accountId = req.user?.accountId ?? DEFAULT_ACCOUNT_ID;
    const asOf = new Date();

    const result = await settleExpiredPositionsForAccount(accountId, asOf, {
      resolveSpot: (underlying, expiry) => resolveSettlementSpot(underlying, expiry, asOf, req.log),
      log: req.log,
    });

    return {
      fillsCount: result.fillsCount,
      settledTradeIds: result.settledTradeIds,
      skipped: result.skipped,
    };
  });
}
