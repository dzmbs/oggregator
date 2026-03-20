import type { VenueExecution, ExecutionCost, OrderSide } from "./types";

export function computeExecutionCost(
  venue: VenueExecution,
  orderSide: OrderSide,
  quantity: number,
): ExecutionCost | null {
  if (!venue.available) return null;

  const price = orderSide === "buy" ? venue.askPrice : venue.bidPrice;
  const oppositePrice = orderSide === "buy" ? venue.bidPrice : venue.askPrice;
  const sizeAtPrice = orderSide === "buy" ? venue.askSize : venue.bidSize;

  if (price == null) return null;

  // Prices are already in USD — core normalization handles inverse conversion
  const priceUsd = price;

  const premiumUsd = priceUsd * quantity * venue.contractSize;

  let spreadCostUsd = 0;
  if (price != null && oppositePrice != null) {
    const spreadUsd = Math.abs(price - oppositePrice);
    spreadCostUsd = (spreadUsd / 2) * quantity * venue.contractSize;
  }

  const feeUsd = premiumUsd * venue.takerFee;

  const totalCostUsd = premiumUsd + feeUsd;

  const fillable = sizeAtPrice != null ? quantity <= sizeAtPrice : true;
  const slippageWarning = sizeAtPrice != null && quantity > sizeAtPrice * 0.8;

  return {
    venue: venue.venue,
    entryPrice: priceUsd,
    premiumUsd,
    spreadCostUsd,
    feeUsd,
    totalCostUsd,
    sizeAvailable: sizeAtPrice,
    fillable,
    slippageWarning,
  };
}

export function rankExecutions(executions: (ExecutionCost | null)[]): ExecutionCost[] {
  return executions
    .filter((e): e is ExecutionCost => e != null)
    .sort((a, b) => a.totalCostUsd - b.totalCostUsd);
}
