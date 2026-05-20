import type { FastifyInstance } from 'fastify';
import type { SpotCandleCurrency, SpotCandleResolutionSec } from '@oggregator/core';
import { isSpotCandlesReady, spotCandleService } from '../services.js';

const SUPPORTED_CURRENCIES: readonly SpotCandleCurrency[] = ['BTC', 'ETH'];
const SUPPORTED_RESOLUTIONS: readonly SpotCandleResolutionSec[] = [
  60, 300, 1800, 3600, 14400, 86400,
];
const MAX_BUCKETS = 3000;

export async function spotCandlesRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { currency?: string; resolution?: string; buckets?: string };
  }>('/spot-candles', async (req, reply) => {
    if (!isSpotCandlesReady()) {
      return reply.status(503).send({ error: 'Spot candle service not available' });
    }

    const currency = (req.query.currency ?? 'BTC').toUpperCase() as SpotCandleCurrency;
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      return reply
        .status(400)
        .send({ error: `Spot candles cover BTC and ETH only (got ${currency})` });
    }

    const resolution = Number(req.query.resolution ?? 3600) as SpotCandleResolutionSec;
    if (!SUPPORTED_RESOLUTIONS.includes(resolution)) {
      return reply.status(400).send({ error: `Resolution must be one of ${SUPPORTED_RESOLUTIONS.join(', ')}s` });
    }

    const buckets = Math.min(MAX_BUCKETS, Math.max(1, Number(req.query.buckets ?? 24)));

    try {
      const candles = await spotCandleService.getCandles(currency, resolution, buckets);
      return { currency, resolution, count: candles.length, candles };
    } catch (err: unknown) {
      req.log.warn({ err: String(err), currency, resolution }, 'spot-candles fetch failed');
      return reply.status(502).send({ error: 'Upstream candle fetch failed' });
    }
  });
}
