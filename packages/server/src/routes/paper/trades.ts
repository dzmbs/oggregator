import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CreatePaperTradeNoteRequestSchema,
  CreatePaperTradeRequestSchema,
  ReducePaperTradeRequestSchema,
} from '@oggregator/protocol';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import { paperTradingStore } from '../../trading-services.js';
import { paperEvents } from './events.js';
import { fillToDto, orderToDto } from './mappers.js';
import {
  addTradeNote,
  closeTrade,
  createTrade,
  getPaperOverview,
  getTradeDetailOrThrow,
  listTradeSummaries,
  reduceTrade,
} from './workspace.js';

function getAccountId(request: FastifyRequest): string {
  return request.user?.accountId ?? DEFAULT_ACCOUNT_ID;
}

function persistenceUnavailable() {
  return { error: 'persistence_unavailable', message: 'DATABASE_URL not set' };
}

export async function paperTradesRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { status?: 'open' | 'closed' | 'all'; limit?: string };
  }>('/paper/trades', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const status =
      req.query.status === 'open' || req.query.status === 'closed' || req.query.status === 'all'
        ? req.query.status
        : 'all';
    const limit = Math.min(Number(req.query.limit ?? '100') || 100, 500);
    const accountId = getAccountId(req);
    return { trades: await listTradeSummaries(status, limit, accountId) };
  });

  app.get<{
    Params: { tradeId: string };
  }>('/paper/trades/:tradeId', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const accountId = getAccountId(req);
    try {
      return await getTradeDetailOrThrow(req.params.tradeId, accountId);
    } catch (err) {
      if (err instanceof Error && err.message === 'Trade not found') {
        return reply.status(404).send({ error: 'not_found', message: err.message });
      }
      throw err;
    }
  });

  app.get('/paper/overview', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const accountId = getAccountId(req);
    return getPaperOverview(accountId);
  });

  app.post('/paper/trades', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const parsed = CreatePaperTradeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const accountId = getAccountId(req);
    const result = await createTrade(parsed.data, accountId);
    paperEvents.emitOrder(orderToDto(result.order), result.fills.map(fillToDto));
    paperEvents.emitTrade(result.trade);
    if (result.trade.activity[0]) {
      paperEvents.emitActivity(result.trade.activity[0]);
    }
    return {
      trade: result.trade,
      order: orderToDto(result.order),
      fills: result.fills.map(fillToDto),
    };
  });

  app.post<{
    Params: { tradeId: string };
  }>('/paper/trades/:tradeId/notes', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const parsed = CreatePaperTradeNoteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const accountId = getAccountId(req);
    try {
      const trade = await addTradeNote(req.params.tradeId, parsed.data, accountId);
      paperEvents.emitTrade(trade);
      if (trade.activity[0]) {
        paperEvents.emitActivity(trade.activity[0]);
      }
      return trade;
    } catch (err) {
      if (err instanceof Error && err.message === 'Trade not found') {
        return reply.status(404).send({ error: 'not_found', message: err.message });
      }
      throw err;
    }
  });

  app.post<{
    Params: { tradeId: string };
  }>('/paper/trades/:tradeId/actions/close', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const accountId = getAccountId(req);
    try {
      const result = await closeTrade(req.params.tradeId, accountId);
      paperEvents.emitOrder(orderToDto(result.order), result.fills.map(fillToDto));
      paperEvents.emitTrade(result.trade);
      if (result.trade.activity[0]) {
        paperEvents.emitActivity(result.trade.activity[0]);
      }
      return result.trade;
    } catch (err) {
      if (err instanceof Error && (err.message === 'Trade not found' || err.message === 'Trade is already flat')) {
        return reply.status(404).send({ error: 'not_found', message: err.message });
      }
      throw err;
    }
  });

  app.post<{
    Params: { tradeId: string };
  }>('/paper/trades/:tradeId/actions/reduce', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const parsed = ReducePaperTradeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const accountId = getAccountId(req);
    try {
      const result = await reduceTrade(req.params.tradeId, parsed.data.fraction, accountId);
      paperEvents.emitOrder(orderToDto(result.order), result.fills.map(fillToDto));
      paperEvents.emitTrade(result.trade);
      if (result.trade.activity[0]) {
        paperEvents.emitActivity(result.trade.activity[0]);
      }
      return result.trade;
    } catch (err) {
      if (err instanceof Error && (err.message === 'Trade not found' || err.message === 'Trade is already flat')) {
        return reply.status(404).send({ error: 'not_found', message: err.message });
      }
      throw err;
    }
  });
}
