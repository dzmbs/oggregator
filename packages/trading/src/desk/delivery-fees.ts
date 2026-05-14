import type { VenueId } from '@oggregator/core';

interface DeliveryFeeSpec {
  rate: number;
  cap: number;
}

// Per-venue cash-settlement (delivery) fees, applied at expiry.
// `rate` is a fraction of underlying notional; `cap` is a fraction of intrinsic value.
// Final fee = min(rate * spot * |qty|, cap * intrinsic * |qty|), mirroring the
// shape of estimateFees() in @oggregator/core/feeds/shared/sdk-base.ts so units
// stay consistent with mid-life paper fees.
//
// Deribit's 0.015% delivery fee is documented; the other four are placeholders
// pending a doc-driven pass against references/options-docs/{venue}/.
const DELIVERY_FEES: Record<VenueId, DeliveryFeeSpec> = {
  deribit: { rate: 0.00015, cap: 0.125 },
  okx: { rate: 0.0002, cap: 0.125 },
  binance: { rate: 0.00015, cap: 0.125 },
  bybit: { rate: 0.0002, cap: 0.125 },
  derive: { rate: 0.0001, cap: 0.125 },
  coincall: { rate: 0.0002, cap: 0.125 },
  thalex: { rate: 0.00015, cap: 0.125 },
  gateio: { rate: 0.0002, cap: 0.125 },
};

export function deliveryFeeUsd(
  venue: VenueId,
  underlyingSpotUsd: number,
  intrinsicUsd: number,
  quantity: number,
): number {
  const spec = DELIVERY_FEES[venue];
  if (!spec) return 0;
  const qty = Math.abs(quantity);
  const notionalLeg = spec.rate * underlyingSpotUsd * qty;
  const capLeg = spec.cap * intrinsicUsd * qty;
  if (intrinsicUsd <= 0) return 0;
  return Math.min(notionalLeg, capLeg);
}
