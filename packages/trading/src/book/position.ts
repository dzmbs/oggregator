import type { UsdAmount } from './money.js';
import type { Fill } from './fill.js';
import type { OptionRight } from './order.js';

export interface PositionKey {
  accountId: string;
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: OptionRight;
}

export interface Position {
  key: PositionKey;
  netQuantity: number;
  avgEntryPriceUsd: UsdAmount;
  // Qty-weighted average of fill IVs for the currently-open slice. Null
  // when no fill in the open slice provided an IV.
  avgEntryIv: number | null;
  realizedPnlUsd: UsdAmount;
  openedAt: Date;
  lastFillAt: Date;
}

export function positionKeyId(key: PositionKey): string {
  return `${key.accountId}|${key.underlying}|${key.expiry}|${key.strike}|${key.optionRight}`;
}

export function keyFromFill(accountId: string, fill: Fill): PositionKey {
  return {
    accountId,
    underlying: fill.underlying,
    expiry: fill.expiry,
    strike: fill.strike,
    optionRight: fill.optionRight,
  };
}

/**
 * Fold a fill into a prior position, returning the new state.
 * Realized PnL accrues only on quantity closed (opposite side of the prior net).
 */
function blendIv(
  priorIv: number | null,
  priorQty: number,
  freshIv: number | null,
  freshQty: number,
): number | null {
  if (priorIv == null && freshIv == null) return null;
  if (priorIv == null) return freshIv;
  if (freshIv == null) return priorIv;
  const denom = priorQty + freshQty;
  if (denom <= 0) return null;
  return (priorIv * priorQty + freshIv * freshQty) / denom;
}

export function applyFillToPosition(prior: Position | null, fill: Fill): Position {
  const key = keyFromFill(prior?.key.accountId ?? '', fill);
  const signedQty = fill.side === 'buy' ? fill.quantity : -fill.quantity;

  if (!prior || prior.netQuantity === 0) {
    return {
      key,
      netQuantity: signedQty,
      avgEntryPriceUsd: fill.priceUsd,
      avgEntryIv: fill.iv,
      realizedPnlUsd: 0,
      openedAt: fill.filledAt,
      lastFillAt: fill.filledAt,
    };
  }

  const sameDirection = Math.sign(prior.netQuantity) === Math.sign(signedQty);
  if (sameDirection) {
    const newNet = prior.netQuantity + signedQty;
    const weightedAvg =
      (prior.avgEntryPriceUsd * Math.abs(prior.netQuantity) +
        fill.priceUsd * Math.abs(signedQty)) /
      Math.abs(newNet);
    const weightedIv = blendIv(
      prior.avgEntryIv,
      Math.abs(prior.netQuantity),
      fill.iv,
      Math.abs(signedQty),
    );
    return {
      key: prior.key,
      netQuantity: newNet,
      avgEntryPriceUsd: weightedAvg,
      avgEntryIv: weightedIv,
      realizedPnlUsd: prior.realizedPnlUsd,
      openedAt: prior.openedAt,
      lastFillAt: fill.filledAt,
    };
  }

  const closingQty = Math.min(Math.abs(prior.netQuantity), Math.abs(signedQty));
  const priorSign = Math.sign(prior.netQuantity);
  const realizedDelta =
    priorSign * closingQty * (fill.priceUsd - prior.avgEntryPriceUsd);
  const newNet = prior.netQuantity + signedQty;

  if (newNet === 0) {
    return {
      key: prior.key,
      netQuantity: 0,
      avgEntryPriceUsd: 0,
      avgEntryIv: null,
      realizedPnlUsd: prior.realizedPnlUsd + realizedDelta,
      openedAt: prior.openedAt,
      lastFillAt: fill.filledAt,
    };
  }

  // Partial close that doesn't flip sign — keep prior avg entry + IV.
  const flipped = Math.sign(newNet) !== priorSign;
  if (!flipped) {
    return {
      key: prior.key,
      netQuantity: newNet,
      avgEntryPriceUsd: prior.avgEntryPriceUsd,
      avgEntryIv: prior.avgEntryIv,
      realizedPnlUsd: prior.realizedPnlUsd + realizedDelta,
      openedAt: prior.openedAt,
      lastFillAt: fill.filledAt,
    };
  }

  return {
    key: prior.key,
    netQuantity: newNet,
    avgEntryPriceUsd: fill.priceUsd,
    avgEntryIv: fill.iv,
    realizedPnlUsd: prior.realizedPnlUsd + realizedDelta,
    openedAt: fill.filledAt,
    lastFillAt: fill.filledAt,
  };
}
