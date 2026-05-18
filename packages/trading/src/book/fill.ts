import type { VenueId } from '@oggregator/core';
import type { UsdAmount } from './money.js';
import type { OptionRight, OrderId, OrderSide } from './order.js';

export type FillId = string;
export type FillSource = 'paper' | 'live' | 'settlement';

export interface Fill {
  id: FillId;
  orderId: OrderId;
  legIndex: number;
  venue: VenueId;
  side: OrderSide;
  optionRight: OptionRight;
  underlying: string;
  expiry: string;
  strike: number;
  // Quantity actually filled. May be < requestedQuantity for partial fills.
  quantity: number;
  // Quantity originally requested by the order leg. Equal to `quantity` for
  // full fills; persisted so partial-fill diagnostics survive a restart.
  requestedQuantity: number;
  priceUsd: UsdAmount;
  // Implied vol at fill time, when the venue published a mark IV. Folded
  // into avgEntryIv on Position so paper books keep an entry-IV history
  // through multiple averaging fills.
  iv: number | null;
  feesUsd: UsdAmount;
  // Per-contract slippage vs L1 reference (ask for buy, bid for sell). 0 under
  // OptimisticFillModel; positive when RealisticFillModel walked depth or paid
  // a spread penalty.
  slippageUsd: UsdAmount;
  // True when quantity < requestedQuantity.
  partialFill: boolean;
  benchmarkBidUsd: UsdAmount | null;
  benchmarkAskUsd: UsdAmount | null;
  benchmarkMidUsd: UsdAmount | null;
  underlyingSpotUsd: UsdAmount | null;
  source: FillSource;
  filledAt: Date;
}

export function newFillId(): FillId {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `fil_${hex}`;
}

export function fillCashDelta(fill: Fill): UsdAmount {
  const sign = fill.side === 'buy' ? -1 : 1;
  const premium = sign * fill.priceUsd * fill.quantity;
  return premium - fill.feesUsd;
}
