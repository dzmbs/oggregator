import type { FastifyInstance } from 'fastify';
import {
  buildLiveTradeUid,
  computeLiveTradeAmounts,
  type TradeEvent,
} from '@oggregator/core';
import type { PersistedTradeRecord, TradeHistoryQuery } from '@oggregator/db';
import { flowService, isFlowReady, spotService, tradeStore } from '../services.js';

interface EnrichedTradeEvent extends TradeEvent {
  tradeUid: string;
  premiumUsd: number | null;
  notionalUsd: number | null;
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
    venue: TradeEvent['venue'];
    count: number;
    premiumUsd: number;
    notionalUsd: number;
  }>;
}

export async function flowRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { underlying?: string; minNotional?: string; limit?: string };
  }>('/flow', async (req, reply) => {
    if (!isFlowReady()) {
      return reply.status(503).send({ error: 'flow service not available' });
    }

    const underlying = req.query.underlying ?? 'BTC';
    const rawMinNotional = Number(req.query.minNotional);
    const minNotional = Number.isFinite(rawMinNotional) && rawMinNotional >= 0 ? rawMinNotional : 0;
    const limit = parseBoundedLimit(req.query.limit, 100, 500);

    const trades = flowService.getTrades(underlying, minNotional);

    return {
      underlying,
      count: trades.length,
      trades: trades.slice(-limit).reverse().map((trade) => enrichLiveTrade(trade)),
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
  }>('/flow/history', async (req) => {
    const historyQuery = buildHistoryQuery(req.query, 'live');

    if (!tradeStore.enabled) {
      return {
        available: false,
        trades: [] as EnrichedTradeEvent[],
        nextCursor: null as TradeHistoryCursor | null,
      };
    }

    const rows = await tradeStore.loadHistory(historyQuery);
    const trades = rows.map((row) => mapStoredLiveTrade(row));

    return {
      available: true,
      trades,
      nextCursor: buildNextCursor(trades),
    };
  });

  app.get<{
    Querystring: { underlying?: string; venues?: string; start?: string; end?: string };
  }>('/flow/history/summary', async (req): Promise<HistorySummary> => {
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

    const summary = await tradeStore.summarizeHistory(buildSummaryQuery(req.query, 'live'));

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

function enrichLiveTrade(trade: TradeEvent): EnrichedTradeEvent {
  const referencePriceUsd = trade.indexPrice ?? getSpotPriceUsd(trade.underlying);
  const amounts = computeLiveTradeAmounts(trade, referencePriceUsd);

  return {
    ...trade,
    tradeUid: buildLiveTradeUid(trade),
    premiumUsd: amounts.premiumUsd,
    notionalUsd: amounts.notionalUsd,
    referencePriceUsd: amounts.referencePriceUsd,
  };
}

function mapStoredLiveTrade(row: PersistedTradeRecord): EnrichedTradeEvent {
  return {
    venue: toVenueId(row.venue),
    tradeUid: row.tradeUid,
    tradeId: getOptionalString(row.raw, 'tradeId') ?? extractTradeIdFromUid(row.tradeUid, row.venue),
    instrument: row.instrumentName,
    underlying: row.underlying,
    side: row.direction,
    price: row.price ?? 0,
    size: getOptionalNumber(row.raw, 'size') ?? row.contracts,
    iv: row.iv,
    markPrice: row.markPrice,
    indexPrice: getOptionalNumber(row.raw, 'indexPrice'),
    premiumUsd: row.premiumUsd,
    notionalUsd: row.notionalUsd,
    referencePriceUsd: row.referencePriceUsd,
    isBlock: getOptionalBoolean(row.raw, 'isBlock') ?? false,
    timestamp: row.tradeTs.getTime(),
  };
}

function buildNextCursor(trades: EnrichedTradeEvent[]): TradeHistoryCursor | null {
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

function getOptionalBoolean(raw: Record<string, unknown>, key: string): boolean | null {
  const value = raw[key];
  return typeof value === 'boolean' ? value : null;
}

function toVenueId(value: string): TradeEvent['venue'] {
  if (value === 'deribit' || value === 'okx' || value === 'bybit' || value === 'binance' || value === 'derive') {
    return value;
  }
  throw new Error(`Unsupported venue in persisted live trade: ${value}`);
}

function extractTradeIdFromUid(tradeUid: string, venue: string): string | null {
  const prefix = `${venue}:`;
  return tradeUid.startsWith(prefix) ? tradeUid.slice(prefix.length) : null;
}
