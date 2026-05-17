import type {
  CreatePaperTradeNoteRequest,
  CreatePaperTradeRequest,
  PaperFillDto,
  PaperOverviewDto,
  PaperRiskDto,
  PaperTradeDetailDto,
  PaperTradeLegDto,
  PaperTradeOrderLinkDto,
  PaperTradeSummaryDto,
  PlaceOrderRequest,
} from '@oggregator/protocol';
import { VENUE_IDS, type VenueId } from '@oggregator/core';
import type {
  PaperTradePositionRow,
  PaperTradeRow,
} from '@oggregator/db';
import type { EnrichedChainResponse, VenueQuote } from '@oggregator/protocol';
import type { Fill, Order, Position } from '@oggregator/trading';
import {
  DEFAULT_ACCOUNT_ID,
  applyFill,
  applyFillToPosition,
  buildSettlementFill,
  fillCashDelta,
  newClientOrderId,
  type OrderLeg,
  type OrderSide,
} from '@oggregator/trading';
import type { PaperPositionRow } from '@oggregator/db';
import { chainEngines } from '../../chain-engines.js';
import {
  ensureDefaultAccount,
  orderPlacementService,
  orderRepository,
  paperTradingStore,
  pnlService,
  positionRepository,
} from '../../trading-services.js';
import { activityToDto, fillToDto, orderToDto, tradeNoteToDto } from './mappers.js';
import { paperEvents } from './events.js';
import type { AuthenticatedUser } from '../../user-service.js';

type TradeIntent = 'open' | 'add' | 'reduce' | 'close' | 'roll';

const DEFAULT_LIMIT = 100;

function getAccountId(user?: AuthenticatedUser): string {
  return user?.accountId ?? DEFAULT_ACCOUNT_ID;
}

interface CreateTradeResult {
  trade: PaperTradeDetailDto;
  order: Order;
  fills: Fill[];
}

interface ExecuteTradeActionResult {
  trade: PaperTradeDetailDto;
  order: Order;
  fills: Fill[];
}

interface LegMarketData {
  markPriceUsd: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  markIv: number | null;
  underlyingPriceUsd: number | null;
  marketSourceVenue: string | null;
  marketSourceLabel: string;
}

export async function createTrade(input: CreatePaperTradeRequest, accountId?: string): Promise<CreateTradeResult> {
  const account = accountId ?? DEFAULT_ACCOUNT_ID;
  await ensureDefaultAccount();
  const result = await placePaperOrder(input.order, account);
  const now = result.order.filledAt ?? result.order.submittedAt;
  const underlying = input.order.legs[0]?.underlying ?? 'UNKNOWN';
  const strategyName = input.strategyName?.trim() || `Custom (${input.order.legs.length} legs)`;
  const label = input.label?.trim() || strategyName;
  const tradeId = newEntityId('trd');
  const tradeRow: PaperTradeRow = {
    id: tradeId,
    accountId: account,
    underlying,
    label,
    strategyName,
    status: 'open',
    entrySpotUsd: avg(result.fills.map((fill) => fill.underlyingSpotUsd)),
    openedAt: now,
    closedAt: null,
    createdAt: now,
  };

  await paperTradingStore.insertTrade(tradeRow);
  await paperTradingStore.insertTradeOrder({
    tradeId,
    orderId: result.order.id,
    intent: 'open',
    createdAt: now,
  });
  await applyFillsToTrade(tradeId, result.fills);

  await recordActivity({
    accountId: account,
    tradeId,
    kind: 'trade_opened',
    summary: `Opened ${label}`,
    payload: { strategyName, orderId: result.order.id },
    ts: now,
  });
  await recordActivity({
    accountId: account,
    tradeId,
    kind: 'order_filled',
    summary: formatOrderSummary(result.order.legs),
    payload: { orderId: result.order.id, intent: 'open' },
    ts: now,
  });

  if (input.thesis?.trim()) {
    await appendTradeNote(account, tradeId, {
      kind: 'thesis',
      content: input.thesis.trim(),
      tags: [],
    }, now);
  }
  if (input.invalidation?.trim()) {
    await appendTradeNote(account, tradeId, {
      kind: 'invalidation',
      content: input.invalidation.trim(),
      tags: [],
    }, now);
  }

  return {
    trade: await getTradeDetailOrThrow(tradeId, account),
    order: result.order,
    fills: result.fills,
  };
}

export async function listTradeSummaries(
  status: 'open' | 'closed' | 'all',
  limit = DEFAULT_LIMIT,
  accountId?: string,
): Promise<PaperTradeSummaryDto[]> {
  const account = accountId ?? DEFAULT_ACCOUNT_ID;
  const trades = await paperTradingStore.listTrades(account, status, limit);
  const cache = new Map<string, EnrichedChainResponse | null>();
  const summaries = await Promise.all(trades.map((trade) => buildTradeSummary(trade, cache)));
  return summaries;
}

export async function getTradeDetailOrThrow(tradeId: string, accountId?: string): Promise<PaperTradeDetailDto> {
  const trade = await paperTradingStore.getTrade(tradeId);
  if (!trade) {
    throw new Error('Trade not found');
  }
  if (accountId && trade.accountId !== accountId) {
    throw new Error('Trade not found');
  }
  return buildTradeDetail(trade, new Map<string, EnrichedChainResponse | null>());
}

export async function listTradeActivities(limit = DEFAULT_LIMIT, tradeId?: string, accountId?: string) {
  const account = accountId ?? DEFAULT_ACCOUNT_ID;
  const rows = await paperTradingStore.listTradeActivities(account, limit, tradeId);
  return rows.map(activityToDto);
}

export async function listTradeFills(limit = DEFAULT_LIMIT, tradeId?: string, accountId?: string): Promise<PaperFillDto[]> {
  const account = accountId ?? DEFAULT_ACCOUNT_ID;
  const fills = await orderRepository.listFills(account, Math.max(limit, 500));
  if (!tradeId) {
    return fills.slice(0, limit).map(fillToDto);
  }
  const linked = await paperTradingStore.listTradeOrders(tradeId);
  const orderIds = new Set(linked.map((row) => row.orderId));
  return fills
    .filter((fill) => orderIds.has(fill.orderId))
    .slice(0, limit)
    .map(fillToDto);
}

export async function addTradeNote(
  tradeId: string,
  request: CreatePaperTradeNoteRequest,
  accountId?: string,
): Promise<PaperTradeDetailDto> {
  const trade = await paperTradingStore.getTrade(tradeId);
  if (!trade) {
    throw new Error('Trade not found');
  }
  if (accountId && trade.accountId !== accountId) {
    throw new Error('Trade not found');
  }
  await appendTradeNote(trade.accountId, tradeId, request, new Date());
  return getTradeDetailOrThrow(tradeId, accountId);
}

export async function closeTrade(tradeId: string, accountId?: string): Promise<ExecuteTradeActionResult> {
  return executeTradeAction(tradeId, 'close', 1, accountId ?? DEFAULT_ACCOUNT_ID);
}

export async function reduceTrade(
  tradeId: string,
  fraction: number,
  accountId?: string,
): Promise<ExecuteTradeActionResult> {
  return executeTradeAction(tradeId, 'reduce', fraction, accountId ?? DEFAULT_ACCOUNT_ID);
}

export async function getPaperOverview(accountId?: string): Promise<PaperOverviewDto> {
  const account = accountId ?? DEFAULT_ACCOUNT_ID;
  const pnl = await pnlService.snapshot(account);
  const [openTrades, closedTrades] = await Promise.all([
    paperTradingStore.listTrades(account, 'open', 500),
    paperTradingStore.listTrades(account, 'closed', 500),
  ]);
  const cache = new Map<string, EnrichedChainResponse | null>();
  const openSummaries = await Promise.all(openTrades.map((trade) => buildTradeSummary(trade, cache)));
  return {
    pnl: {
      cashUsd: pnl.cashUsd,
      realizedUsd: pnl.realizedUsd,
      unrealizedUsd: pnl.unrealizedUsd,
      equityUsd: pnl.equityUsd,
      generatedAt: pnl.generatedAt.toISOString(),
    },
    risk: sumRisk(openSummaries.map((trade) => trade.risk)),
    openTradeCount: openTrades.length,
    closedTradeCount: closedTrades.length,
  };
}

async function executeTradeAction(
  tradeId: string,
  intent: 'close' | 'reduce',
  fraction: number,
  accountId: string,
): Promise<ExecuteTradeActionResult> {
  await ensureDefaultAccount();
  const trade = await paperTradingStore.getTrade(tradeId);
  if (!trade) {
    throw new Error('Trade not found');
  }
  if (trade.accountId !== accountId) {
    throw new Error('Trade not found');
  }
  const tradePositions = await paperTradingStore.listTradePositions(tradeId);
  const openPositions = tradePositions.filter((pos) => pos.netQuantity !== 0);
  if (openPositions.length === 0) {
    throw new Error('Trade is already flat');
  }

  const legs = openPositions.map((pos) => ({
    side: oppositeSide(pos.netQuantity),
    optionRight: pos.optionRight,
    underlying: pos.underlying,
    expiry: pos.expiry,
    strike: pos.strike,
    quantity: Math.abs(pos.netQuantity) * fraction,
    preferredVenues: null,
  }));

  const nonZeroLegs = legs.filter((leg) => leg.quantity > 0);
  if (nonZeroLegs.length === 0) {
    throw new Error('Nothing to trade');
  }

  const result = await placePaperOrder({ legs: nonZeroLegs, venueFilter: [] }, accountId);
  const now = result.order.filledAt ?? result.order.submittedAt;
  await paperTradingStore.insertTradeOrder({
    tradeId,
    orderId: result.order.id,
    intent,
    createdAt: now,
  });
  await applyFillsToTrade(tradeId, result.fills);
  const closed = await syncTradeLifecycle(tradeId);
  await recordActivity({
    accountId,
    tradeId,
    kind: intent === 'close' ? 'trade_closed_order' : 'trade_reduced',
    summary:
      intent === 'close'
        ? `Closed ${trade.label}`
        : `Reduced ${trade.label} by ${(fraction * 100).toFixed(0)}%`,
    payload: { orderId: result.order.id, fraction, intent },
    ts: now,
  });
  if (closed) {
    await recordActivity({
      accountId,
      tradeId,
      kind: 'trade_closed',
      summary: `${trade.label} is fully closed`,
      payload: { orderId: result.order.id },
      ts: now,
    });
  }

  return {
    trade: await getTradeDetailOrThrow(tradeId, accountId),
    order: result.order,
    fills: result.fills,
  };
}

async function buildTradeSummary(
  trade: PaperTradeRow,
  cache: Map<string, EnrichedChainResponse | null>,
): Promise<PaperTradeSummaryDto> {
  const detail = await buildTradeDetail(trade, cache, { includeActivity: false, includeNotes: false });
  const { legs, orders, fills, notes, activity, ...summary } = detail;
  void orders;
  void fills;
  void notes;
  void activity;
  return summary;
}

async function buildTradeDetail(
  trade: PaperTradeRow,
  cache: Map<string, EnrichedChainResponse | null>,
  options?: { includeActivity?: boolean; includeNotes?: boolean },
): Promise<PaperTradeDetailDto> {
  const includeActivity = options?.includeActivity ?? true;
  const includeNotes = options?.includeNotes ?? true;
  const [tradePositions, linkedOrders, notes, activity, allFills] = await Promise.all([
    paperTradingStore.listTradePositions(trade.id),
    paperTradingStore.listTradeOrders(trade.id),
    includeNotes ? paperTradingStore.listTradeNotes(trade.id) : Promise.resolve([]),
    includeActivity
      ? paperTradingStore.listTradeActivities(trade.accountId, 50, trade.id)
      : Promise.resolve([]),
    orderRepository.listFills(trade.accountId, 2_000),
  ]);
  const orderIds = linkedOrders.map((row) => row.orderId);
  const orders = await Promise.all(
    linkedOrders.map(async (row): Promise<PaperTradeOrderLinkDto | null> => {
      const order = await orderRepository.getOrder(row.orderId);
      if (!order) return null;
      return { intent: row.intent, order: orderToDto(order) };
    }),
  );
  const tradeFills = allFills.filter((fill) => orderIds.includes(fill.orderId));
  const fills = tradeFills.map(fillToDto);
  const legMarketVenues = latestFillVenueByContract(tradeFills);
  const legs = await enrichTradeLegs(tradePositions, cache, legMarketVenues);
  const realizedPnlUsd = tradePositions.reduce((sum, leg) => sum + leg.realizedPnlUsd, 0);
  const unrealizedPnlUsd = legs.reduce((sum, leg) => sum + (leg.unrealizedPnlUsd ?? 0), 0);
  const totalPnlUsd = realizedPnlUsd + unrealizedPnlUsd;
  const netPremiumUsd = computeNetPremiumUsd(tradeFills);
  const currentSpotUsd = avg(
    legs
      .filter((leg) => leg.netQuantity !== 0)
      .map((leg) => leg.underlyingPriceUsd)
      .filter((value): value is number => value != null),
  );
  const risk = sumRisk([
    legs.reduce<PaperRiskDto>(
      (acc, leg) => ({
        delta: sumNullable(acc.delta, leg.delta, leg.netQuantity),
        gamma: sumNullable(acc.gamma, leg.gamma, leg.netQuantity),
        theta: sumNullable(acc.theta, leg.theta, leg.netQuantity),
        vega: sumNullable(acc.vega, leg.vega, leg.netQuantity),
      }),
      { delta: null, gamma: null, theta: null, vega: null },
    ),
  ]);

  return {
    id: trade.id,
    accountId: trade.accountId,
    underlying: trade.underlying,
    label: trade.label,
    strategyName: trade.strategyName,
    status: trade.status,
    entrySpotUsd: trade.entrySpotUsd,
    currentSpotUsd,
    openedAt: trade.openedAt.toISOString(),
    closedAt: trade.closedAt ? trade.closedAt.toISOString() : null,
    netPremiumUsd,
    realizedPnlUsd,
    unrealizedPnlUsd,
    totalPnlUsd,
    openLegs: legs.filter((leg) => leg.netQuantity !== 0).length,
    risk,
    legs,
    orders: orders.filter((order): order is PaperTradeOrderLinkDto => order != null),
    fills,
    notes: notes.map(tradeNoteToDto),
    activity: activity.map(activityToDto),
  };
}

async function enrichTradeLegs(
  rows: PaperTradePositionRow[],
  cache: Map<string, EnrichedChainResponse | null>,
  legMarketVenues: Map<string, VenueId>,
): Promise<PaperTradeLegDto[]> {
  return Promise.all(
    rows.map(async (row) => {
      const market = await getLegMarketData(row, cache, legMarketVenues.get(contractKey(row)) ?? null);
      return {
        underlying: row.underlying,
        expiry: row.expiry,
        strike: row.strike,
        optionRight: row.optionRight,
        netQuantity: row.netQuantity,
        avgEntryPriceUsd: row.avgEntryPriceUsd,
        realizedPnlUsd: row.realizedPnlUsd,
        markPriceUsd: market.markPriceUsd,
        unrealizedPnlUsd:
          market.markPriceUsd != null
            ? row.netQuantity * (market.markPriceUsd - row.avgEntryPriceUsd)
            : null,
        openedAt: row.openedAt.toISOString(),
        lastFillAt: row.lastFillAt.toISOString(),
        delta: market.delta,
        gamma: market.gamma,
        theta: market.theta,
        vega: market.vega,
        markIv: market.markIv,
        underlyingPriceUsd: market.underlyingPriceUsd,
        marketSourceVenue: market.marketSourceVenue,
        marketSourceLabel: market.marketSourceLabel,
      };
    }),
  );
}

async function getLegMarketData(
  row: PaperTradePositionRow,
  cache: Map<string, EnrichedChainResponse | null>,
  marketVenue: VenueId | null,
): Promise<LegMarketData> {
  if (marketVenue) {
    const venueSnapshot = await getSnapshot(row.underlying, row.expiry, cache, [marketVenue]);
    const venueQuote = venueSnapshot ? getVenueQuote(venueSnapshot, row, marketVenue) : null;
    if (venueQuote && hasQuoteData(venueQuote)) {
      return quoteToMarketData(
        venueQuote,
        venueSnapshot?.stats.forwardPriceUsd ?? venueSnapshot?.stats.indexPriceUsd ?? null,
        marketVenue,
        formatMarketSourceLabel(marketVenue),
      );
    }
  }

  const snapshot = await getSnapshot(row.underlying, row.expiry, cache, [...VENUE_IDS]);
  if (!snapshot) {
    return emptyMarketData(marketVenue);
  }
  const strike = snapshot.strikes.find((item) => item.strike === row.strike);
  if (!strike) {
    return {
      ...emptyMarketData(marketVenue),
      underlyingPriceUsd: snapshot.stats.forwardPriceUsd ?? snapshot.stats.indexPriceUsd,
    };
  }

  const side = row.optionRight === 'call' ? strike.call : strike.put;
  const quotes = Object.values(side.venues).filter((quote): quote is VenueQuote => quote != null);
  return {
    markPriceUsd: avg(quotes.map((quote) => quote.mid)),
    delta: avg(quotes.map((quote) => quote.delta)),
    gamma: avg(quotes.map((quote) => quote.gamma)),
    theta: avg(quotes.map((quote) => quote.theta)),
    vega: avg(quotes.map((quote) => quote.vega)),
    markIv: avg(quotes.map((quote) => quote.markIv)),
    underlyingPriceUsd: snapshot.stats.forwardPriceUsd ?? snapshot.stats.indexPriceUsd,
    marketSourceVenue: null,
    marketSourceLabel: 'Composite',
  };
}

async function getSnapshot(
  underlying: string,
  expiry: string,
  cache: Map<string, EnrichedChainResponse | null>,
  venues = [...VENUE_IDS],
): Promise<EnrichedChainResponse | null> {
  const key = `${underlying}:${expiry}:${[...venues].sort().join(',')}`;
  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }
  try {
    const { runtime, release } = await chainEngines.acquire({
      underlying,
      expiry,
      venues,
    });
    try {
      const snapshot = await runtime.fetchSnapshotData();
      cache.set(key, snapshot);
      return snapshot;
    } finally {
      await release();
    }
  } catch {
    cache.set(key, null);
    return null;
  }
}

// Derived from fills (source of truth) rather than the persisted
// `orders.total_debit_usd`, which was poisoned by a pre-50d3733 fee-units bug
// and is not retroactively healed. Sign: positive = debit, negative = credit.
export function computeNetPremiumUsd(fills: Fill[]): number {
  return fills.reduce((sum, fill) => sum - fillCashDelta(fill), 0);
}

function latestFillVenueByContract(fills: Fill[]): Map<string, VenueId> {
  const map = new Map<string, VenueId>();
  for (const fill of fills) {
    const key = contractKey(fill);
    if (!map.has(key)) {
      map.set(key, fill.venue);
    }
  }
  return map;
}

function contractKey(input: {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
}): string {
  return `${input.underlying}|${input.expiry}|${input.strike}|${input.optionRight}`;
}

function getVenueQuote(
  snapshot: EnrichedChainResponse,
  row: PaperTradePositionRow,
  venue: VenueId,
): VenueQuote | null {
  const strike = snapshot.strikes.find((item) => item.strike === row.strike);
  if (!strike) return null;
  const side = row.optionRight === 'call' ? strike.call : strike.put;
  return side.venues[venue] ?? null;
}

function hasQuoteData(quote: VenueQuote): boolean {
  return [quote.mid, quote.delta, quote.gamma, quote.theta, quote.vega, quote.markIv].some(
    (value) => value != null,
  );
}

function quoteToMarketData(
  quote: VenueQuote,
  underlyingPriceUsd: number | null,
  marketSourceVenue: VenueId,
  marketSourceLabel: string,
): LegMarketData {
  return {
    markPriceUsd: quote.mid,
    delta: quote.delta,
    gamma: quote.gamma,
    theta: quote.theta,
    vega: quote.vega,
    markIv: quote.markIv,
    underlyingPriceUsd,
    marketSourceVenue,
    marketSourceLabel,
  };
}

function emptyMarketData(marketVenue: VenueId | null): LegMarketData {
  return {
    markPriceUsd: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    markIv: null,
    underlyingPriceUsd: null,
    marketSourceVenue: marketVenue,
    marketSourceLabel: marketVenue ? formatMarketSourceLabel(marketVenue) : 'Composite',
  };
}

function formatMarketSourceLabel(value: VenueId): string {
  return value.toUpperCase();
}

async function appendTradeNote(
  accountId: string,
  tradeId: string,
  request: CreatePaperTradeNoteRequest,
  createdAt: Date,
): Promise<void> {
  await paperTradingStore.insertTradeNote({
    id: newEntityId('ptn'),
    tradeId,
    kind: request.kind,
    content: request.content.trim(),
    tags: request.tags,
    createdAt,
  });
  await recordActivity({
    accountId,
    tradeId,
    kind: 'note_added',
    summary: `${capitalize(request.kind)} note added`,
    payload: { kind: request.kind, preview: request.content.slice(0, 160) },
    ts: createdAt,
  });
}

async function applyFillsToTrade(tradeId: string, fills: Fill[]): Promise<void> {
  for (const fill of fills) {
    const current = await paperTradingStore.listTradePositions(tradeId);
    const prior = current.find((row) => tradeRowMatchesFill(row, fill));
    const next = applyFillToPosition(prior ? tradeRowToPosition(prior) : null, fill);
    await paperTradingStore.upsertTradePosition({
      tradeId,
      underlying: next.key.underlying,
      expiry: next.key.expiry,
      strike: next.key.strike,
      optionRight: next.key.optionRight,
      netQuantity: next.netQuantity,
      avgEntryPriceUsd: next.avgEntryPriceUsd,
      avgEntryIv: next.avgEntryIv,
      realizedPnlUsd: next.realizedPnlUsd,
      openedAt: next.openedAt,
      lastFillAt: next.lastFillAt,
    });
  }
  await syncTradeLifecycle(tradeId);
}

async function syncTradeLifecycle(tradeId: string): Promise<boolean> {
  const trade = await paperTradingStore.getTrade(tradeId);
  if (!trade) return false;
  const positions = await paperTradingStore.listTradePositions(tradeId);
  const allFlat = positions.length > 0 && positions.every((row) => row.netQuantity === 0);
  const latestTs = positions.reduce<Date | null>(
    (latest, row) => (!latest || row.lastFillAt > latest ? row.lastFillAt : latest),
    trade.closedAt,
  );
  const nextStatus = allFlat ? 'closed' : 'open';
  const nextClosedAt = allFlat ? latestTs : null;
  if (trade.status === nextStatus && sameDate(trade.closedAt, nextClosedAt)) {
    return allFlat;
  }
  await paperTradingStore.updateTrade({ ...trade, status: nextStatus, closedAt: nextClosedAt });
  return allFlat;
}

async function recordActivity(input: {
  accountId: string;
  tradeId: string | null;
  kind: string;
  summary: string;
  payload: unknown;
  ts: Date;
}) {
  return paperTradingStore.insertTradeActivity(input);
}

async function placePaperOrder(request: PlaceOrderRequest, accountId: string): Promise<Awaited<ReturnType<typeof orderPlacementService.place>>> {
  const legs: Array<Omit<OrderLeg, 'index'>> = request.legs.map((leg) => ({
    side: leg.side,
    optionRight: leg.optionRight,
    underlying: leg.underlying,
    expiry: leg.expiry,
    strike: leg.strike,
    quantity: leg.quantity,
    preferredVenues: leg.preferredVenues ?? null,
  }));
  return orderPlacementService.place({
    accountId,
    legs,
    venueFilter: request.venueFilter,
    ...(request.clientOrderId ? { clientOrderId: request.clientOrderId } : {}),
  });
}

function tradeRowToPosition(row: PaperTradePositionRow): Position {
  return {
    key: {
      accountId: row.tradeId,
      underlying: row.underlying,
      expiry: row.expiry,
      strike: row.strike,
      optionRight: row.optionRight,
    },
    netQuantity: row.netQuantity,
    avgEntryPriceUsd: row.avgEntryPriceUsd,
    avgEntryIv: row.avgEntryIv,
    realizedPnlUsd: row.realizedPnlUsd,
    openedAt: row.openedAt,
    lastFillAt: row.lastFillAt,
  };
}

function tradeRowMatchesFill(row: PaperTradePositionRow, fill: Fill): boolean {
  return (
    row.underlying === fill.underlying &&
    row.expiry === fill.expiry &&
    row.strike === fill.strike &&
    row.optionRight === fill.optionRight
  );
}

function formatOrderSummary(legs: OrderLeg[]): string {
  return legs
    .map(
      (leg) =>
        `${leg.side === 'buy' ? '+' : '-'}${leg.quantity} ${leg.strike}${leg.optionRight === 'call' ? 'C' : 'P'}`,
    )
    .join(' / ');
}

function oppositeSide(netQuantity: number): OrderSide {
  return netQuantity > 0 ? 'sell' : 'buy';
}

function newEntityId(prefix: string): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((value): value is number => value != null);
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function sumRisk(risks: PaperRiskDto[]): PaperRiskDto {
  return risks.reduce(
    (acc, risk) => ({
      delta: addMaybe(acc.delta, risk.delta),
      gamma: addMaybe(acc.gamma, risk.gamma),
      theta: addMaybe(acc.theta, risk.theta),
      vega: addMaybe(acc.vega, risk.vega),
    }),
    { delta: null, gamma: null, theta: null, vega: null },
  );
}

function addMaybe(left: number | null, right: number | null): number | null {
  if (left == null && right == null) return null;
  return (left ?? 0) + (right ?? 0);
}

function sumNullable(current: number | null, value: number | null, multiplier: number): number | null {
  if (value == null && current == null) return null;
  return (current ?? 0) + (value ?? 0) * multiplier;
}

function sameDate(left: Date | null, right: Date | null): boolean {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return left.getTime() === right.getTime();
}

function capitalize(input: string): string {
  return input[0]?.toUpperCase() ? `${input[0]!.toUpperCase()}${input.slice(1)}` : input;
}

export interface SettlementRunResult {
  fillsCount: number;
  settledTradeIds: string[];
  skipped: Array<{ underlying: string; expiry: string; reason: string }>;
}

export interface SettlementResolvers {
  resolveSpot: (underlying: string, expiry: string, asOf: Date) => Promise<number | null>;
  log: { warn: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void };
}

// Auto-settle every position whose expiry has passed for the given account.
// One settlement fill is generated per (trade, leg) pair so multi-trade leg
// ownership stays consistent with how user-initiated closes are recorded.
// Idempotency: re-running this is safe because expired positions land at
// netQuantity=0 after the first run, so they no longer match the listExpired
// filter — and the settlement-price table never overwrites once captured.
export async function settleExpiredPositionsForAccount(
  accountId: string,
  asOf: Date,
  resolvers: SettlementResolvers,
): Promise<SettlementRunResult> {
  const expired = await paperTradingStore.listExpiredOpenPositions(accountId, asOf);
  if (expired.length === 0) {
    return { fillsCount: 0, settledTradeIds: [], skipped: [] };
  }

  const skipped: SettlementRunResult['skipped'] = [];
  const settledTradeIds = new Set<string>();
  let fillsCount = 0;

  for (const pos of expired) {
    const spot = await resolvers.resolveSpot(pos.underlying, pos.expiry, asOf);
    if (spot == null) {
      skipped.push({ underlying: pos.underlying, expiry: pos.expiry, reason: 'no_spot' });
      continue;
    }
    const expiryAt = expiryInstantUtc(pos.expiry);
    const venue = await pickAttributionVenue(accountId, pos);

    const tradeRows = await listTradeRowsForLeg(accountId, pos);

    if (tradeRows.length === 0) {
      const fill = buildSettlementFill({
        position: positionRowToBookPosition(pos),
        venue,
        settlementSpotUsd: spot,
        asOf: expiryAt,
      });
      if (!fill) continue;
      await persistSettlementFill(accountId, null, fill, expiryAt, resolvers.log);
      fillsCount += 1;
      continue;
    }

    for (const tradeRow of tradeRows) {
      const tradePosition: Position = {
        key: {
          accountId,
          underlying: pos.underlying,
          expiry: pos.expiry,
          strike: pos.strike,
          optionRight: pos.optionRight,
        },
        netQuantity: tradeRow.netQuantity,
        avgEntryPriceUsd: tradeRow.avgEntryPriceUsd,
        avgEntryIv: null,
        realizedPnlUsd: tradeRow.realizedPnlUsd,
        openedAt: tradeRow.openedAt,
        lastFillAt: tradeRow.lastFillAt,
      };
      const fill = buildSettlementFill({
        position: tradePosition,
        venue,
        settlementSpotUsd: spot,
        asOf: expiryAt,
      });
      if (!fill) continue;
      await persistSettlementFill(accountId, tradeRow.tradeId, fill, expiryAt, resolvers.log);
      fillsCount += 1;
      settledTradeIds.add(tradeRow.tradeId);
    }
  }

  return { fillsCount, settledTradeIds: [...settledTradeIds], skipped };
}

// Persists a synthesized settlement fill through the same write path that
// user-initiated orders use: synthetic order row, fill row, account-level
// position + cash, optional trade-row update + lifecycle close, activity row,
// and WS broadcast. Mirrors the orchestration in executeTradeAction so the
// dashboard sees identical event shapes.
async function persistSettlementFill(
  accountId: string,
  tradeId: string | null,
  fill: Fill,
  ts: Date,
  log: SettlementResolvers['log'],
): Promise<void> {
  const order: Order = {
    id: fill.orderId,
    clientOrderId: newClientOrderId(),
    accountId,
    mode: 'paper',
    kind: 'market',
    status: 'accepted',
    legs: [
      {
        index: 0,
        side: fill.side,
        optionRight: fill.optionRight,
        underlying: fill.underlying,
        expiry: fill.expiry,
        strike: fill.strike,
        quantity: fill.quantity,
        preferredVenues: [fill.venue],
      },
    ],
    submittedAt: ts,
    filledAt: ts,
    rejectionReason: null,
    totalDebitUsd: -fillCashDelta(fill),
  };

  await orderRepository.saveOrder(order);
  await orderRepository.saveFills([fill]);
  await orderRepository.updateOrderStatus({ ...order, status: 'filled' });

  await applyFill(positionRepository, accountId, fill);

  let tradeClosed = false;
  if (tradeId) {
    await paperTradingStore.insertTradeOrder({
      tradeId,
      orderId: order.id,
      intent: 'settlement',
      createdAt: ts,
    });
    await applyFillsToTrade(tradeId, [fill]);
    const trade = await paperTradingStore.getTrade(tradeId);
    tradeClosed = trade?.status === 'closed';
  }

  const settledLabel = `${fill.side === 'sell' ? '+' : '-'}${fill.quantity} ${fill.strike}${fill.optionRight === 'call' ? 'C' : 'P'} @ ${fill.priceUsd.toFixed(2)}`;
  const activity = await paperTradingStore.insertTradeActivity({
    accountId,
    tradeId,
    kind: 'trade_settled',
    summary: `Auto-settled ${settledLabel}`,
    payload: {
      orderId: order.id,
      fillId: fill.id,
      underlying: fill.underlying,
      expiry: fill.expiry,
      strike: fill.strike,
      optionRight: fill.optionRight,
      intrinsicUsd: fill.priceUsd,
      feesUsd: fill.feesUsd,
      settlementSpotUsd: fill.underlyingSpotUsd,
      tradeClosed,
    },
    ts,
  });

  paperEvents.emitOrder(orderToDto({ ...order, status: 'filled' }), [fillToDto(fill)]);
  paperEvents.emitActivity(activityToDto(activity));
  if (tradeId) {
    try {
      const detail = await getTradeDetailOrThrow(tradeId, accountId);
      paperEvents.emitTrade(detail);
    } catch (err: unknown) {
      log.warn({ err: String(err), tradeId }, 'failed to emit settled trade detail');
    }
  }
}

async function listTradeRowsForLeg(
  accountId: string,
  pos: PaperPositionRow,
): Promise<Array<{
  tradeId: string;
  netQuantity: number;
  avgEntryPriceUsd: number;
  realizedPnlUsd: number;
  openedAt: Date;
  lastFillAt: Date;
}>> {
  const trades = await paperTradingStore.listTrades(accountId, 'open', 500);
  const matches: Array<{
    tradeId: string;
    netQuantity: number;
    avgEntryPriceUsd: number;
    realizedPnlUsd: number;
    openedAt: Date;
    lastFillAt: Date;
  }> = [];
  for (const trade of trades) {
    const positions = await paperTradingStore.listTradePositions(trade.id);
    for (const row of positions) {
      if (row.netQuantity === 0) continue;
      if (
        row.underlying === pos.underlying &&
        row.expiry === pos.expiry &&
        row.strike === pos.strike &&
        row.optionRight === pos.optionRight
      ) {
        matches.push({
          tradeId: trade.id,
          netQuantity: row.netQuantity,
          avgEntryPriceUsd: row.avgEntryPriceUsd,
          realizedPnlUsd: row.realizedPnlUsd,
          openedAt: row.openedAt,
          lastFillAt: row.lastFillAt,
        });
      }
    }
  }
  return matches;
}

async function pickAttributionVenue(
  accountId: string,
  pos: PaperPositionRow,
): Promise<VenueId> {
  const fills = await orderRepository.listFills(accountId, 1_000);
  const match = fills.find(
    (f) =>
      f.underlying === pos.underlying &&
      f.expiry === pos.expiry &&
      f.strike === pos.strike &&
      f.optionRight === pos.optionRight,
  );
  return match?.venue ?? 'deribit';
}

function positionRowToBookPosition(row: PaperPositionRow): Position {
  return {
    key: {
      accountId: row.accountId,
      underlying: row.underlying,
      expiry: row.expiry,
      strike: row.strike,
      optionRight: row.optionRight,
    },
    netQuantity: row.netQuantity,
    avgEntryPriceUsd: row.avgEntryPriceUsd,
    avgEntryIv: row.avgEntryIv,
    realizedPnlUsd: row.realizedPnlUsd,
    openedAt: row.openedAt,
    lastFillAt: row.lastFillAt,
  };
}

function expiryInstantUtc(expiryYmd: string): Date {
  // Deribit settles at 08:00 UTC on the expiry date; we adopt this convention
  // uniformly across venues for the synthetic settlement fill timestamp.
  return new Date(`${expiryYmd}T08:00:00.000Z`);
}
