import type { VenueId } from '@oggregator/core';
import type { AccountId } from '../book/account.js';
import {
  InsufficientMarginError,
  InvalidOrderError,
  NoLiquidityError,
  TradingError,
} from '../book/errors.js';
import { fillCashDelta, type Fill } from '../book/fill.js';
import {
  newClientOrderId,
  newOrderId,
  type Order,
  type OrderLeg,
} from '../book/order.js';
import type { Clock } from '../gateways/clock.js';
import type { FillEngine } from '../gateways/fill-engine.js';
import type { OrderRepository } from '../gateways/order-repository.js';
import type { PositionRepository } from '../gateways/position-repository.js';
import { applyFill } from './apply-fill.js';
import type { MarginEngine, MarginEstimateLeg } from '../risk/margin-engine.js';
import { NoopMarginEngine } from '../risk/noop-margin-engine.js';
import type { PnlService } from './compute-pnl.js';

export interface PlaceOrderInput {
  accountId: AccountId;
  clientOrderId?: string;
  legs: Array<Omit<OrderLeg, 'index'>>;
  venueFilter: VenueId[];
}

export interface PlaceOrderResult {
  order: Order;
  fills: Fill[];
}

export interface OrderPlacementServiceOptions {
  marginEngine?: MarginEngine;
  pnlService?: PnlService;
}

export class OrderPlacementService {
  private readonly marginEngine: MarginEngine;
  private readonly pnlService: PnlService | null;

  constructor(
    private readonly orders: OrderRepository,
    private readonly positions: PositionRepository,
    private readonly fillEngine: FillEngine,
    private readonly clock: Clock,
    options: OrderPlacementServiceOptions = {},
  ) {
    this.marginEngine = options.marginEngine ?? new NoopMarginEngine();
    this.pnlService = options.pnlService ?? null;
  }

  async place(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    if (input.legs.length === 0) {
      throw new InvalidOrderError('Order must have at least one leg');
    }
    input.legs.forEach((leg, idx) => {
      if (leg.quantity <= 0) {
        throw new InvalidOrderError(`Leg quantity must be positive (leg ${idx})`);
      }
    });

    const now = this.clock.now();
    const legs: OrderLeg[] = input.legs.map((leg, index) => ({ ...leg, index }));
    const order: Order = {
      id: newOrderId(),
      clientOrderId: input.clientOrderId ?? newClientOrderId(),
      accountId: input.accountId,
      mode: 'paper',
      kind: 'market',
      status: 'accepted',
      legs,
      submittedAt: now,
      filledAt: null,
      rejectionReason: null,
      totalDebitUsd: null,
    };

    await this.orders.saveOrder(order);

    await this.checkMargin(order, input.venueFilter);

    let fills: Fill[];
    try {
      fills = await this.fillEngine.executeOrder(order, input.venueFilter);
    } catch (err) {
      const reason = err instanceof TradingError ? err.message : 'Fill failed';
      const rejected: Order = {
        ...order,
        status: 'rejected',
        rejectionReason: reason,
      };
      await this.orders.updateOrderStatus(rejected);
      if (err instanceof NoLiquidityError) throw err;
      throw new TradingError(reason, 'FILL_FAILED');
    }

    await this.orders.saveFills(fills);
    for (const fill of fills) {
      await applyFill(this.positions, input.accountId, fill);
    }

    const totalCash = fills.reduce((sum, f) => sum + fillCashDelta(f), 0);
    const filled: Order = {
      ...order,
      status: 'filled',
      filledAt: this.clock.now(),
      totalDebitUsd: -totalCash,
    };
    await this.orders.updateOrderStatus(filled);

    return { order: filled, fills };
  }

  private async checkMargin(order: Order, venueFilter: VenueId[]): Promise<void> {
    if (this.marginEngine instanceof NoopMarginEngine) return;
    const equityUsd = await this.equityFor(order.accountId);
    const existingPositions = await this.positions.listPositions(order.accountId);

    const prospectiveLegs: MarginEstimateLeg[] = order.legs.map((l) => ({
      index: l.index,
      side: l.side,
      optionRight: l.optionRight,
      underlying: l.underlying,
      expiry: l.expiry,
      strike: l.strike,
      quantity: l.quantity,
      preferredVenues: l.preferredVenues,
    }));

    const result = await this.marginEngine.estimate({
      prospectiveLegs,
      existingPositions,
      equityUsd,
      venueFilter,
    });

    if (result.ok) return;

    const reason = result.reason ?? 'Margin requirement exceeded';
    const rejected: Order = {
      ...order,
      status: 'rejected',
      rejectionReason: reason,
    };
    await this.orders.updateOrderStatus(rejected);
    throw new InsufficientMarginError(
      reason,
      result.requiredUsd,
      result.availableUsd,
      result.bufferUsd,
    );
  }

  private async equityFor(accountId: AccountId): Promise<number> {
    if (this.pnlService) {
      const snap = await this.pnlService.snapshot(accountId);
      return snap.equityUsd;
    }
    // Fallback when no PnL service is wired (mostly tests): treat cash as
    // equity. Slightly understates available margin when unrealized PnL is
    // positive, which is the safe direction.
    return this.positions.getCashBalance(accountId);
  }
}
