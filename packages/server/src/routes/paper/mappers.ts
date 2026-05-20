import type {
  PaperActivityDto,
  PaperFillDto,
  PaperOrderDto,
  PaperPnlDto,
  PaperPositionDto,
  PaperTradeNoteDto,
} from '@oggregator/protocol';
import type { PaperTradeActivityRow, PaperTradeNoteRow } from '@oggregator/db';
import type { Fill, Order, PnlSnapshot, Position } from '@oggregator/trading';

export function orderToDto(order: Order): PaperOrderDto {
  return {
    id: order.id,
    clientOrderId: order.clientOrderId,
    accountId: order.accountId,
    status: order.status,
    legs: order.legs.map((l) => ({ ...l })),
    submittedAt: order.submittedAt.toISOString(),
    filledAt: order.filledAt ? order.filledAt.toISOString() : null,
    rejectionReason: order.rejectionReason,
    totalDebitUsd: order.totalDebitUsd,
  };
}

export function fillToDto(fill: Fill): PaperFillDto {
  return {
    id: fill.id,
    orderId: fill.orderId,
    legIndex: fill.legIndex,
    venue: fill.venue,
    side: fill.side,
    optionRight: fill.optionRight,
    underlying: fill.underlying,
    expiry: fill.expiry,
    strike: fill.strike,
    quantity: fill.quantity,
    requestedQuantity: fill.requestedQuantity,
    priceUsd: fill.priceUsd,
    feesUsd: fill.feesUsd,
    slippageUsd: fill.slippageUsd,
    partialFill: fill.partialFill,
    benchmarkBidUsd: fill.benchmarkBidUsd,
    benchmarkAskUsd: fill.benchmarkAskUsd,
    benchmarkMidUsd: fill.benchmarkMidUsd,
    underlyingSpotUsd: fill.underlyingSpotUsd,
    filledAt: fill.filledAt.toISOString(),
  };
}

export function positionToDto(
  pos: Position,
  markPriceUsd: number | null,
): PaperPositionDto {
  const unrealized =
    markPriceUsd != null
      ? pos.netQuantity * (markPriceUsd - pos.avgEntryPriceUsd)
      : null;
  return {
    underlying: pos.key.underlying,
    expiry: pos.key.expiry,
    strike: pos.key.strike,
    optionRight: pos.key.optionRight,
    netQuantity: pos.netQuantity,
    avgEntryPriceUsd: pos.avgEntryPriceUsd,
    realizedPnlUsd: pos.realizedPnlUsd,
    markPriceUsd,
    unrealizedPnlUsd: unrealized,
    openedAt: pos.openedAt.toISOString(),
    lastFillAt: pos.lastFillAt.toISOString(),
  };
}

export function pnlToDto(snap: PnlSnapshot): PaperPnlDto {
  return {
    cashUsd: snap.cashUsd,
    realizedUsd: snap.realizedUsd,
    unrealizedUsd: snap.unrealizedUsd,
    equityUsd: snap.equityUsd,
    generatedAt: snap.generatedAt.toISOString(),
  };
}

export function tradeNoteToDto(note: PaperTradeNoteRow): PaperTradeNoteDto {
  return {
    id: note.id,
    tradeId: note.tradeId,
    kind: note.kind,
    content: note.content,
    tags: note.tags,
    createdAt: note.createdAt.toISOString(),
  };
}

export function activityToDto(activity: PaperTradeActivityRow): PaperActivityDto {
  return {
    id: activity.id,
    tradeId: activity.tradeId,
    kind: activity.kind,
    summary: activity.summary,
    payload: activity.payload,
    ts: activity.ts.toISOString(),
  };
}
