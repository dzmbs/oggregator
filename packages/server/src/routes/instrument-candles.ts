import type { FastifyInstance } from 'fastify';
import {
  InstrumentCandlesQuerySchema,
  type VenueId,
  type InstrumentCandleInterval,
  type InstrumentCandleRange,
} from '@oggregator/protocol';
import { InstrumentCandlesError } from '@oggregator/core';
import { instrumentCandleService, isInstrumentCandlesReady } from '../services.js';

export async function instrumentCandlesRoute(app: FastifyInstance) {
  app.get<{ Querystring: Record<string, string> }>('/instrument-candles', async (req, reply) => {
    if (!isInstrumentCandlesReady()) {
      return reply.status(503).send({ error: 'Instrument candles service not ready' });
    }
    const parse = InstrumentCandlesQuerySchema.safeParse(req.query);
    if (!parse.success) {
      return reply.status(400).send({ error: 'Invalid query', issues: parse.error.issues });
    }
    const venue = parse.data.venue as VenueId;
    const symbol = parse.data.symbol as string;
    const interval = parse.data.interval as InstrumentCandleInterval;
    const range = parse.data.range as InstrumentCandleRange;
    try {
      const response = await instrumentCandleService.getCandles(venue, symbol, interval, range);
      return response;
    } catch (err) {
      if (err instanceof InstrumentCandlesError) {
        const status =
          err.code === 'not_found' ? 404 :
          err.code === 'unsupported_venue' ? 501 :
          502;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
      req.log.warn({ err: String(err), venue, symbol }, 'instrument-candles failed');
      return reply.status(502).send({ error: 'Upstream candle fetch failed' });
    }
  });
}
