import type { FastifyInstance } from 'fastify';
import { computeLiveTradeAmounts, type TradeEvent } from '@oggregator/core';
import { flowService, isFlowReady, spotService } from '../services.js';

interface EnrichedTradeEvent extends TradeEvent {
  premiumUsd: number | null;
  notionalUsd: number | null;
  referencePriceUsd: number | null;
}

export async function flowRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { underlying?: string; minNotional?: string; limit?: string };
  }>('/flow', async (req, reply) => {
    if (!isFlowReady()) {
      return reply.status(503).send({ error: 'flow service not available' });
    }
    const underlying = req.query.underlying ?? 'BTC';

    // Number(...) || fallback silently passes through negative values because they
    // are truthy. Use explicit finite + bounds checks instead.
    const rawMinNotional = Number(req.query.minNotional);
    const minNotional = Number.isFinite(rawMinNotional) && rawMinNotional >= 0 ? rawMinNotional : 0;

    const rawLimit = Number(req.query.limit);
    const limit = Math.min(
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 100,
      500,
    );

    const trades = flowService.getTrades(underlying, minNotional);

    return {
      underlying,
      count: trades.length,
      trades: trades.slice(-limit).reverse().map((trade) => enrichTrade(trade)),
    };
  });
}

function enrichTrade(trade: TradeEvent): EnrichedTradeEvent {
  const referencePriceUsd = trade.indexPrice ?? getSpotPriceUsd(trade.underlying);
  const amounts = computeLiveTradeAmounts(trade, referencePriceUsd);

  return {
    ...trade,
    premiumUsd: amounts.premiumUsd,
    notionalUsd: amounts.notionalUsd,
    referencePriceUsd: amounts.referencePriceUsd,
  };
}

function getSpotPriceUsd(underlying: string): number | null {
  const snapshot = spotService.getSnapshot(underlying.toUpperCase());
  return snapshot?.lastPrice ?? null;
}
