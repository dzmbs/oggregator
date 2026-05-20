import type { PaperTradingStore, PaperOrderRow, PaperFillRow } from '@oggregator/db';
import type { VenueId } from '@oggregator/core';
import type { AccountId } from '../book/account.js';
import type { Fill } from '../book/fill.js';
import type { Order, OrderLeg } from '../book/order.js';
import type { OrderRepository } from '../gateways/order-repository.js';

export class PostgresOrderRepository implements OrderRepository {
  constructor(private readonly store: PaperTradingStore) {}

  async saveOrder(order: Order): Promise<void> {
    await this.store.insertOrder(toOrderRow(order));
  }

  async updateOrderStatus(order: Order): Promise<void> {
    await this.store.updateOrder(toOrderRow(order));
  }

  async saveFills(fills: Fill[]): Promise<void> {
    await this.store.insertFills(fills.map(toFillRow));
  }

  async getOrder(id: string): Promise<Order | null> {
    const row = await this.store.getOrder(id);
    return row ? fromOrderRow(row) : null;
  }

  async listOrders(accountId: AccountId, limit: number): Promise<Order[]> {
    const rows = await this.store.listOrders(accountId, limit);
    return rows.map(fromOrderRow);
  }

  async listFills(accountId: AccountId, limit: number): Promise<Fill[]> {
    const rows = await this.store.listFills(accountId, limit);
    return rows.map(fromFillRow);
  }
}

function toOrderRow(order: Order): PaperOrderRow {
  return {
    id: order.id,
    clientOrderId: order.clientOrderId,
    accountId: order.accountId,
    mode: order.mode,
    kind: order.kind,
    status: order.status,
    legs: order.legs,
    submittedAt: order.submittedAt,
    filledAt: order.filledAt,
    rejectionReason: order.rejectionReason,
    totalDebitUsd: order.totalDebitUsd,
  };
}

function fromOrderRow(row: PaperOrderRow): Order {
  return {
    id: row.id,
    clientOrderId: row.clientOrderId,
    accountId: row.accountId,
    mode: row.mode,
    kind: row.kind,
    status: row.status,
    legs: (row.legs as OrderLeg[]) ?? [],
    submittedAt: row.submittedAt,
    filledAt: row.filledAt,
    rejectionReason: row.rejectionReason,
    totalDebitUsd: row.totalDebitUsd,
  };
}

function toFillRow(fill: Fill): PaperFillRow {
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
    source: fill.source,
    filledAt: fill.filledAt,
  };
}

function fromFillRow(row: PaperFillRow): Fill {
  return {
    id: row.id,
    orderId: row.orderId,
    legIndex: row.legIndex,
    venue: row.venue as VenueId,
    side: row.side,
    optionRight: row.optionRight,
    underlying: row.underlying,
    expiry: row.expiry,
    strike: row.strike,
    quantity: row.quantity,
    requestedQuantity: row.requestedQuantity,
    priceUsd: row.priceUsd,
    // IV at fill time is not persisted on paper_fills (we keep the rolled-up
    // avgEntryIv on the position instead). On replay, individual fill IVs
    // are unrecoverable — that's by design.
    iv: null,
    feesUsd: row.feesUsd,
    slippageUsd: row.slippageUsd,
    partialFill: row.partialFill,
    benchmarkBidUsd: row.benchmarkBidUsd,
    benchmarkAskUsd: row.benchmarkAskUsd,
    benchmarkMidUsd: row.benchmarkMidUsd,
    underlyingSpotUsd: row.underlyingSpotUsd,
    source: row.source,
    filledAt: row.filledAt,
  };
}
