import type { UsdAmount } from './money.js';
import type { Position } from './position.js';

export interface PositionMark {
  key: Position['key'];
  markPriceUsd: number | null;
}

export interface PositionPnl {
  key: Position['key'];
  netQuantity: number;
  avgEntryPriceUsd: UsdAmount;
  markPriceUsd: number | null;
  unrealizedUsd: UsdAmount | null;
  realizedUsd: UsdAmount;
}

export interface PnlSnapshot {
  positions: PositionPnl[];
  cashUsd: UsdAmount;
  realizedUsd: UsdAmount;
  unrealizedUsd: UsdAmount;
  equityUsd: UsdAmount;
  generatedAt: Date;
}

export function computePositionPnl(pos: Position, mark: number | null): PositionPnl {
  const unrealized =
    mark != null ? pos.netQuantity * (mark - pos.avgEntryPriceUsd) : null;
  return {
    key: pos.key,
    netQuantity: pos.netQuantity,
    avgEntryPriceUsd: pos.avgEntryPriceUsd,
    markPriceUsd: mark,
    unrealizedUsd: unrealized,
    realizedUsd: pos.realizedPnlUsd,
  };
}

export function computeSnapshot(
  positions: Position[],
  marks: Map<string, number | null>,
  cashUsd: UsdAmount,
  now: Date,
): PnlSnapshot {
  const rows = positions.map((p) => {
    const markKey = `${p.key.underlying}|${p.key.expiry}|${p.key.strike}|${p.key.optionRight}`;
    const mark = marks.get(markKey) ?? null;
    return computePositionPnl(p, mark);
  });
  const unrealized = rows.reduce((sum, r) => sum + (r.unrealizedUsd ?? 0), 0);
  const realized = rows.reduce((sum, r) => sum + r.realizedUsd, 0);
  return {
    positions: rows,
    cashUsd,
    realizedUsd: realized,
    unrealizedUsd: unrealized,
    equityUsd: cashUsd + unrealized,
    generatedAt: now,
  };
}
