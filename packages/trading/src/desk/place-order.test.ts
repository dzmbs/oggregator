import { describe, expect, it } from 'vitest';
import type { VenueId } from '@oggregator/core';
import type { Fill } from '../book/fill.js';
import type { Order, OrderId, OrderLeg } from '../book/order.js';
import type { Position } from '../book/position.js';
import { applyFillToPosition } from '../book/position.js';
import { InsufficientMarginError } from '../book/errors.js';
import { FixedClock } from '../gateways/clock.js';
import type { FillEngine } from '../gateways/fill-engine.js';
import type { OrderRepository } from '../gateways/order-repository.js';
import type {
  CashLedgerEntry,
  PositionRepository,
} from '../gateways/position-repository.js';
import type { QuoteBook, QuoteKey, QuoteProvider } from '../gateways/quote-provider.js';
import { ApproximationMarginEngine } from '../risk/approximation-margin-engine.js';
import { OrderPlacementService } from './place-order.js';

class InMemoryOrders implements OrderRepository {
  orders = new Map<OrderId, Order>();
  fills: Fill[] = [];
  async saveOrder(o: Order) {
    this.orders.set(o.id, o);
  }
  async updateOrderStatus(o: Order) {
    this.orders.set(o.id, o);
  }
  async saveFills(f: Fill[]) {
    this.fills.push(...f);
  }
  async getOrder(id: OrderId) {
    return this.orders.get(id) ?? null;
  }
  async listOrders() {
    return [...this.orders.values()];
  }
  async listFills() {
    return [...this.fills];
  }
}

class InMemoryPositions implements PositionRepository {
  cashByAccount = new Map<string, number>();
  positions: Position[] = [];
  ledger: CashLedgerEntry[] = [];
  async listPositions(accountId: string): Promise<Position[]> {
    return this.positions.filter((p) => p.key.accountId === accountId);
  }
  async upsertPosition(pos: Position) {
    const idx = this.positions.findIndex(
      (p) =>
        p.key.accountId === pos.key.accountId &&
        p.key.underlying === pos.key.underlying &&
        p.key.expiry === pos.key.expiry &&
        p.key.strike === pos.key.strike &&
        p.key.optionRight === pos.key.optionRight,
    );
    if (idx >= 0) this.positions[idx] = pos;
    else this.positions.push(pos);
  }
  async appendCashLedger(entry: CashLedgerEntry) {
    this.ledger.push(entry);
    this.cashByAccount.set(
      entry.accountId,
      (this.cashByAccount.get(entry.accountId) ?? 0) + entry.deltaUsd,
    );
  }
  async getCashBalance(accountId: string): Promise<number> {
    return this.cashByAccount.get(accountId) ?? 0;
  }
  async ensureAccount(accountId: string, _label: string, initial: number) {
    if (!this.cashByAccount.has(accountId)) this.cashByAccount.set(accountId, initial);
  }
}

class StubQuotes implements QuoteProvider {
  constructor(private readonly spot: number) {}
  async getBooks(_key: QuoteKey): Promise<QuoteBook[]> {
    return [
      {
        venue: 'deribit' as VenueId,
        bidUsd: 100,
        askUsd: 110,
        markUsd: 105,
        markIv: null,
        underlyingPriceUsd: this.spot,
        feesTakerUsd: 0,
        bidSize: null,
        askSize: null,
      },
    ];
  }
  async getMark(): Promise<number | null> {
    return 105;
  }
}

class FixedFillEngine implements FillEngine {
  async executeOrder(order: Order): Promise<Fill[]> {
    return order.legs.map(
      (leg): Fill => ({
        id: `fil_${leg.index}`,
        orderId: order.id,
        legIndex: leg.index,
        venue: 'deribit' as VenueId,
        side: leg.side,
        optionRight: leg.optionRight,
        underlying: leg.underlying,
        expiry: leg.expiry,
        strike: leg.strike,
        quantity: leg.quantity,
        requestedQuantity: leg.quantity,
        priceUsd: 100,
        feesUsd: 0,
        slippageUsd: 0,
        partialFill: false,
        benchmarkBidUsd: 100,
        benchmarkAskUsd: 110,
        benchmarkMidUsd: 105,
        underlyingSpotUsd: 80_000,
        source: 'paper',
        filledAt: new Date('2026-04-23T00:00:00Z'),
      }),
    );
  }
}

const clock = new FixedClock(new Date('2026-04-23T00:00:00Z'));

function shortCallLeg(qty: number): Omit<OrderLeg, 'index'> {
  return {
    side: 'sell',
    optionRight: 'call',
    underlying: 'BTC',
    expiry: '2026-05-29',
    strike: 80_000,
    quantity: qty,
    preferredVenues: null,
  };
}

describe('OrderPlacementService — margin gate', () => {
  it('rejects short-call order when equity is below required margin', async () => {
    const orders = new InMemoryOrders();
    const positions = new InMemoryPositions();
    await positions.ensureAccount('acc', 'Acc', 1_000); // equity = 1000
    const svc = new OrderPlacementService(
      orders,
      positions,
      new FixedFillEngine(),
      clock,
      { marginEngine: new ApproximationMarginEngine(new StubQuotes(80_000)) },
    );

    await expect(
      svc.place({
        accountId: 'acc',
        legs: [shortCallLeg(1)],
        venueFilter: [],
      }),
    ).rejects.toBeInstanceOf(InsufficientMarginError);

    const recorded = [...orders.orders.values()];
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.status).toBe('rejected');
    expect(recorded[0]!.rejectionReason).toContain('exceeds available');
    expect(orders.fills).toHaveLength(0);
    expect(positions.positions).toHaveLength(0);
  });

  it('accepts the same order when equity covers margin', async () => {
    const orders = new InMemoryOrders();
    const positions = new InMemoryPositions();
    await positions.ensureAccount('acc', 'Acc', 100_000); // way above 12k requirement
    const svc = new OrderPlacementService(
      orders,
      positions,
      new FixedFillEngine(),
      clock,
      { marginEngine: new ApproximationMarginEngine(new StubQuotes(80_000)) },
    );

    const result = await svc.place({
      accountId: 'acc',
      legs: [shortCallLeg(1)],
      venueFilter: [],
    });
    expect(result.order.status).toBe('filled');
    expect(result.fills).toHaveLength(1);
  });

  it('with default NoopMarginEngine, no equity check is performed', async () => {
    const orders = new InMemoryOrders();
    const positions = new InMemoryPositions();
    await positions.ensureAccount('acc', 'Acc', 0); // no cash
    const svc = new OrderPlacementService(
      orders,
      positions,
      new FixedFillEngine(),
      clock,
    );
    const result = await svc.place({
      accountId: 'acc',
      legs: [shortCallLeg(1)],
      venueFilter: [],
    });
    expect(result.order.status).toBe('filled');
  });

  it('counts existing short positions toward required margin', async () => {
    const orders = new InMemoryOrders();
    const positions = new InMemoryPositions();
    await positions.ensureAccount('acc', 'Acc', 100_000);
    // Pre-existing short 1 ATM call (~12k margin)
    const seedFill: Fill = {
      id: 'fil_seed',
      orderId: 'ord_seed',
      legIndex: 0,
      venue: 'deribit' as VenueId,
      side: 'sell',
      optionRight: 'call',
      underlying: 'BTC',
      expiry: '2026-05-29',
      strike: 80_000,
      quantity: 8, // 8 short calls × 12k = 96k
      requestedQuantity: 8,
      priceUsd: 100,
      feesUsd: 0,
      slippageUsd: 0,
      partialFill: false,
      benchmarkBidUsd: 100,
      benchmarkAskUsd: 110,
      benchmarkMidUsd: 105,
      underlyingSpotUsd: 80_000,
      source: 'paper',
      filledAt: new Date('2026-04-22T00:00:00Z'),
    };
    const seeded = applyFillToPosition(null, seedFill);
    await positions.upsertPosition({ ...seeded, key: { ...seeded.key, accountId: 'acc' } });

    const svc = new OrderPlacementService(
      orders,
      positions,
      new FixedFillEngine(),
      clock,
      { marginEngine: new ApproximationMarginEngine(new StubQuotes(80_000)) },
    );

    // Adding 1 more short call would push total to 9 × 12k = 108k > 95k available
    await expect(
      svc.place({
        accountId: 'acc',
        legs: [shortCallLeg(1)],
        venueFilter: [],
      }),
    ).rejects.toBeInstanceOf(InsufficientMarginError);
  });
});
