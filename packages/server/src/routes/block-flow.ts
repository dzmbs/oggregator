import type { FastifyInstance } from 'fastify';
import {
  buildBlockTradeUid,
  computeBlockTradeAmounts,
  type BlockTradeEvent,
} from '@oggregator/core';
import type { PersistedTradeRecord, TradeHistoryQuery } from '@oggregator/db';
import { blockFlowService, isBlockFlowReady, spotService, tradeStore } from '../services.js';

interface EnrichedBlockTradeEvent extends BlockTradeEvent {
  tradeUid: string;
  premiumUsd: number | null;
  referencePriceUsd: number | null;
}

interface TradeHistoryCursor {
  beforeTs: string;
  beforeUid: string;
}

interface HistorySummary {
  available: boolean;
  count: number;
  premiumUsd: number;
  notionalUsd: number;
  oldestTs: string | null;
  newestTs: string | null;
  venues: Array<{
    venue: BlockTradeEvent['venue'];
    count: number;
    premiumUsd: number;
    notionalUsd: number;
  }>;
}

export async function blockFlowRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { underlying?: string; limit?: string };
  }>('/block-flow', async (req, reply) => {
    if (!isBlockFlowReady()) {
      return reply.status(503).send({ error: 'block flow service not available' });
    }

    const underlying = req.query.underlying;
    const limit = parseBoundedLimit(req.query.limit, 100, 300);
    const trades = blockFlowService.getTrades(underlying);

    return {
      count: trades.length,
      trades: trades.slice(0, limit).map((trade) => enrichLiveBlockTrade(trade)),
    };
  });

  app.get<{
    Querystring: {
      underlying?: string;
      venues?: string;
      start?: string;
      end?: string;
      beforeTs?: string;
      beforeUid?: string;
      limit?: string;
    };
  }>('/block-flow/history', async (req) => {
    const historyQuery = buildHistoryQuery(req.query, 'institutional');

    if (!tradeStore.enabled) {
      return {
        available: false,
        trades: [] as EnrichedBlockTradeEvent[],
        nextCursor: null as TradeHistoryCursor | null,
      };
    }

    const rows = await tradeStore.loadHistory(historyQuery);
    const trades = rows.map((row) => mapStoredBlockTrade(row));

    return {
      available: true,
      trades,
      nextCursor: buildNextCursor(trades),
    };
  });

  app.get<{
    Querystring: { underlying?: string; venues?: string; start?: string; end?: string };
  }>('/block-flow/history/summary', async (req): Promise<HistorySummary> => {
    if (!tradeStore.enabled) {
      return {
        available: false,
        count: 0,
        premiumUsd: 0,
        notionalUsd: 0,
        oldestTs: null,
        newestTs: null,
        venues: [],
      };
    }

    const summary = await tradeStore.summarizeHistory(buildSummaryQuery(req.query, 'institutional'));

    return {
      available: true,
      count: summary.count,
      premiumUsd: summary.premiumUsd,
      notionalUsd: summary.notionalUsd,
      oldestTs: summary.oldestTs?.toISOString() ?? null,
      newestTs: summary.newestTs?.toISOString() ?? null,
      venues: summary.venues.map((venue) => ({
        venue: toVenueId(venue.venue),
        count: venue.count,
        premiumUsd: venue.premiumUsd,
        notionalUsd: venue.notionalUsd,
      })),
    };
  });
}

function enrichLiveBlockTrade(trade: BlockTradeEvent): EnrichedBlockTradeEvent {
  const referencePriceUsd = trade.indexPrice ?? getSpotPriceUsd(trade.underlying);
  const amounts = computeBlockTradeAmounts(trade, referencePriceUsd);

  return {
    ...trade,
    tradeUid: buildBlockTradeUid(trade),
    premiumUsd: amounts.premiumUsd,
    notionalUsd: amounts.notionalUsd ?? 0,
    referencePriceUsd: amounts.referencePriceUsd,
  };
}

function mapStoredBlockTrade(row: PersistedTradeRecord): EnrichedBlockTradeEvent {
  const totalSize = getOptionalNumber(row.raw, 'totalSize') ?? row.contracts;

  return {
    venue: toVenueId(row.venue),
    tradeUid: row.tradeUid,
    tradeId: getOptionalString(row.raw, 'tradeId') ?? extractTradeIdFromUid(row.tradeUid, row.venue) ?? row.tradeUid,
    timestamp: row.tradeTs.getTime(),
    underlying: row.underlying,
    direction: row.direction,
    strategy: row.strategyLabel,
    legs: row.legs ?? [],
    totalSize,
    premiumUsd: row.premiumUsd,
    notionalUsd: row.notionalUsd ?? 0,
    referencePriceUsd: row.referencePriceUsd,
    indexPrice: getOptionalNumber(row.raw, 'indexPrice'),
  };
}

function buildNextCursor(trades: EnrichedBlockTradeEvent[]): TradeHistoryCursor | null {
  const last = trades[trades.length - 1];
  if (!last) return null;

  return {
    beforeTs: new Date(last.timestamp).toISOString(),
    beforeUid: last.tradeUid,
  };
}

function buildHistoryQuery(
  query: { underlying?: string; venues?: string; start?: string; end?: string; beforeTs?: string; beforeUid?: string; limit?: string },
  mode: 'live' | 'institutional',
): TradeHistoryQuery {
  const historyQuery: TradeHistoryQuery = {
    mode,
    limit: parseBoundedLimit(query.limit, 100, 200),
  };

  if (query.underlying) historyQuery.underlying = query.underlying;
  const venues = parseVenues(query.venues);
  if (venues.length > 0) historyQuery.venues = venues;
  const startTs = parseDate(query.start);
  if (startTs) historyQuery.startTs = startTs;
  const endTs = parseDate(query.end);
  if (endTs) historyQuery.endTs = endTs;
  const cursor = parseCursor(query.beforeTs, query.beforeUid);
  if (cursor) {
    historyQuery.beforeTs = cursor.beforeTs;
    historyQuery.beforeUid = cursor.beforeUid;
  }

  return historyQuery;
}

function buildSummaryQuery(
  query: { underlying?: string; venues?: string; start?: string; end?: string },
  mode: 'live' | 'institutional',
) {
  const summaryQuery: TradeHistoryQuery = { mode, limit: 1 };
  if (query.underlying) summaryQuery.underlying = query.underlying;
  const venues = parseVenues(query.venues);
  if (venues.length > 0) summaryQuery.venues = venues;
  const startTs = parseDate(query.start);
  if (startTs) summaryQuery.startTs = startTs;
  const endTs = parseDate(query.end);
  if (endTs) summaryQuery.endTs = endTs;
  return summaryQuery;
}

function parseCursor(beforeTs?: string, beforeUid?: string): { beforeTs: Date; beforeUid: string } | null {
  if (!beforeTs || !beforeUid) return null;
  const parsed = parseDate(beforeTs);
  if (!parsed) return null;
  return { beforeTs: parsed, beforeUid };
}

function parseBoundedLimit(rawLimit: string | undefined, fallback: number, max: number): number {
  const parsed = Number(rawLimit);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback, max);
}

function parseVenues(rawVenues?: string): string[] {
  if (!rawVenues) return [];
  return rawVenues
    .split(',')
    .map((venue) => venue.trim())
    .filter(Boolean);
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getSpotPriceUsd(underlying: string): number | null {
  const snapshot = spotService.getSnapshot(underlying.toUpperCase());
  return snapshot?.lastPrice ?? null;
}

function getOptionalString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  return typeof value === 'string' ? value : null;
}

function getOptionalNumber(raw: Record<string, unknown>, key: string): number | null {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toVenueId(value: string): BlockTradeEvent['venue'] {
  if (value === 'deribit' || value === 'okx' || value === 'bybit' || value === 'binance' || value === 'derive') {
    return value;
  }
  throw new Error(`Unsupported venue in persisted block trade: ${value}`);
}

function extractTradeIdFromUid(tradeUid: string, venue: string): string | null {
  const prefix = `${venue}:`;
  return tradeUid.startsWith(prefix) ? tradeUid.slice(prefix.length) : null;
}
