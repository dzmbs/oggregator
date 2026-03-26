import type { FastifyInstance } from 'fastify';
import { computeBlockTradeAmounts, type BlockTradeEvent } from '@oggregator/core';
import { blockFlowService, isBlockFlowReady, spotService } from '../services.js';

interface EnrichedBlockTradeEvent extends BlockTradeEvent {
  premiumUsd: number | null;
  referencePriceUsd: number | null;
}

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
    const enriched = trades.slice(0, limit).map((trade) => enrichTrade(trade));

    return {
      count: trades.length,
      trades: enriched,
    };
  });
}

function enrichTrade(trade: BlockTradeEvent): EnrichedBlockTradeEvent {
  const referencePriceUsd = trade.indexPrice ?? getSpotPriceUsd(trade.underlying);
  const amounts = computeBlockTradeAmounts(trade, referencePriceUsd);

  return {
    ...trade,
    premiumUsd: amounts.premiumUsd,
    notionalUsd: amounts.notionalUsd ?? 0,
    referencePriceUsd: amounts.referencePriceUsd,
  };
}

function getSpotPriceUsd(underlying: string): number | null {
  const snapshot = spotService.getSnapshot(underlying.toUpperCase());
  return snapshot?.lastPrice ?? null;
}
