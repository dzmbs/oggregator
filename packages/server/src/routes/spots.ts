import type { FastifyInstance } from 'fastify';
import { isSpotReady, spotService } from '../services.js';

export async function spotsRoute(app: FastifyInstance) {
  app.get('/spots', async () => {
    if (!isSpotReady()) {
      return { items: [] };
    }

    const snapshots = spotService.getAllSnapshots();
    const items = snapshots.map((s) => ({
      symbol: s.symbol,
      lastPrice: s.lastPrice,
      change24hPct: s.change24hPct,
      updatedAt: s.updatedAt,
    }));

    return { items };
  });
}
