import type { FastifyInstance } from 'fastify';
import type { BlockTradeEvent } from '@oggregator/core';
import { blockFlowService, isBlockFlowReady, spotService } from '../services.js';

export async function blockFlowRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { underlying?: string; limit?: string };
  }>('/block-flow', async (req, reply) => {
    if (!isBlockFlowReady()) {
      return reply.status(503).send({ error: 'block flow service not available' });
    }

    const underlying = req.query.underlying;
    const rawLimit = Number(req.query.limit);
    const limit = Math.min(
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 100,
      300,
    );

    const trades = blockFlowService.getTrades(underlying);

    // OKX and Deribit use BTC-denominated prices (fractions like 0.0577).
    // Multiply by spot to get USD values for consistent display.
    const enriched = trades.slice(0, limit).map((t) => enrichWithSpot(t));

    return {
      count: trades.length,
      trades: enriched,
    };
  });
}

function enrichWithSpot(t: BlockTradeEvent): BlockTradeEvent {
  if (t.notionalUsd > 0 && t.indexPrice != null) return t;

  const spot = spotService.getSnapshot(t.underlying);
  if (!spot) return t;
  const spotPrice = spot.lastPrice;

  const avgLegPrice = t.legs.length > 0
    ? t.legs.reduce((sum, l) => sum + l.price, 0) / t.legs.length
    : 0;

  // Prices < 1 indicate BTC-denominated fractions (Deribit, OKX)
  const isFraction = avgLegPrice > 0 && avgLegPrice < 1;
  if (!isFraction && t.notionalUsd > 0) return t;

  const convertedLegs = isFraction
    ? t.legs.map((l) => ({ ...l, price: Math.round(l.price * spotPrice) }))
    : t.legs;

  // Sum premium per leg: price × size × ratio, converted to USD
  const notionalUsd = isFraction
    ? t.legs.reduce((sum, l) => sum + l.price * l.size * l.ratio * spotPrice, 0)
    : t.notionalUsd;

  return {
    ...t,
    legs: convertedLegs,
    notionalUsd,
    indexPrice: t.indexPrice ?? spotPrice,
  };
}
