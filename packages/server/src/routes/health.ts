import type { FastifyInstance } from 'fastify';
import { getRegisteredVenues } from '@oggregator/core';
import { SERVER_BOOT_TIME, SERVER_VERSION } from '../app.js';
import { currentReadinessStatus, isTrafficReady } from '../readiness.js';
import {
  getIvHistoryStorageStats,
  isBlockFlowReady,
  isDvolReady,
  isFlowReady,
  isIvHistoryReady,
  isNewsReady,
  isSpotReady,
} from '../services.js';

export async function healthRoute(app: FastifyInstance) {
  app.get('/health', async () => {
    const ivHistoryStorage = await getIvHistoryStorageStats();
    return {
      status: currentReadinessStatus(),
      venues: getRegisteredVenues(),
      services: {
        flow: isFlowReady(),
        dvol: isDvolReady(),
        spot: isSpotReady(),
        blockFlow: isBlockFlowReady(),
        ivHistory: isIvHistoryReady(),
        news: isNewsReady(),
        ivHistoryStorage,
      },
      bootTime: SERVER_BOOT_TIME,
      version: SERVER_VERSION,
      ts: Date.now(),
    };
  });

  app.get('/ready', async (_req, reply) => {
    if (!isTrafficReady()) {
      return reply.status(503).send({ status: currentReadinessStatus() });
    }
    return { status: 'ok' };
  });
}
