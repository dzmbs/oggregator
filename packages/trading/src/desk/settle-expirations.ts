import type { VenueId } from '@oggregator/core';
import { newFillId, type Fill } from '../book/fill.js';
import { newOrderId } from '../book/order.js';
import type { Position } from '../book/position.js';
import { deliveryFeeUsd } from './delivery-fees.js';

export interface SettlementInput {
  position: Position;
  venue: VenueId;
  settlementSpotUsd: number;
  asOf: Date;
}

// Synthesize the closing fill that auto-settles an expired option position
// against its intrinsic value at the chosen settlement spot. Long positions
// generate a sell-side closing fill; shorts generate a buy-side fill. The
// resulting Fill flows through the same applyFill / applyFillsToTrade pipeline
// that user-initiated orders use.
export function buildSettlementFill(input: SettlementInput): Fill | null {
  const { position, venue, settlementSpotUsd, asOf } = input;
  const qty = Math.abs(position.netQuantity);
  if (qty === 0) return null;

  const { underlying, expiry, strike, optionRight } = position.key;
  const intrinsic =
    optionRight === 'call'
      ? Math.max(settlementSpotUsd - strike, 0)
      : Math.max(strike - settlementSpotUsd, 0);
  const side = position.netQuantity > 0 ? 'sell' : 'buy';
  const fees = deliveryFeeUsd(venue, settlementSpotUsd, intrinsic, qty);

  return {
    id: newFillId(),
    orderId: newOrderId(),
    legIndex: 0,
    venue,
    side,
    optionRight,
    underlying,
    expiry,
    strike,
    quantity: qty,
    requestedQuantity: qty,
    priceUsd: intrinsic,
    iv: null,
    feesUsd: fees,
    slippageUsd: 0,
    partialFill: false,
    benchmarkBidUsd: null,
    benchmarkAskUsd: null,
    benchmarkMidUsd: intrinsic,
    underlyingSpotUsd: settlementSpotUsd,
    source: 'settlement',
    filledAt: asOf,
  };
}
