import type {
  ShockGridCell,
  VolShockLegResult,
  VolShockResult,
  VolShockScenario,
} from '@oggregator/protocol';

import { legMarkFromShockedIv } from './aggregator.js';
import type { MarkContext, PositionLeg } from './types.js';

interface LegWithMark {
  leg: PositionLeg;
  mark: MarkContext;
}

function dteYears(expiry: string, nowMs: number): number | null {
  const target = Date.parse(`${expiry}T08:00:00.000Z`);
  if (!Number.isFinite(target)) return null;
  const secs = (target - nowMs) / 1000;
  return secs > 0 ? secs / (365 * 24 * 60 * 60) : null;
}

export function applyVolShock(
  scenario: VolShockScenario,
  currentIv: number,
  strike: number,
  expiry: string,
  nowMs: number,
): number {
  switch (scenario.kind) {
    case 'parallel':
      return currentIv + scenario.bumpVolPts / 100;
    case 'skew_tilt': {
      const logK = Math.log(strike / scenario.atmStrike);
      return currentIv + scenario.slopePerLogK * logK;
    }
    case 'term_twist': {
      const ty = dteYears(expiry, nowMs);
      if (ty == null) return currentIv;
      const pivotY = scenario.pivotDays / 365;
      return currentIv + scenario.slopePerYear * (ty - pivotY);
    }
    case 'atm_bump': {
      const distance = (strike - scenario.atmStrike) / (scenario.atmStrike * scenario.widthPct);
      const weight = Math.exp(-distance * distance);
      return currentIv + (weight * scenario.bumpVolPts) / 100;
    }
    default: {
      const _exhaustive: never = scenario;
      return currentIv + (_exhaustive as never);
    }
  }
}

export function computeShockPnl(
  scenario: VolShockScenario,
  legsWithMarks: LegWithMark[],
  nowMs: number,
): VolShockResult {
  const byLeg: VolShockLegResult[] = [];
  let totalPnlUsd = 0;

  for (const { leg, mark } of legsWithMarks) {
    if (mark.iv == null || mark.markPriceUsd == null) continue;

    const bumpedIv = applyVolShock(scenario, mark.iv, leg.strike, leg.expiry, nowMs);
    const safeIv = bumpedIv > 0 ? bumpedIv : 0.001;
    const bumpedMarkUsd = legMarkFromShockedIv(leg, mark, safeIv);
    if (bumpedMarkUsd == null) continue;

    const legPnl = (bumpedMarkUsd - mark.markPriceUsd) * leg.size;
    totalPnlUsd += legPnl;
    byLeg.push({
      legId: leg.legId,
      pnlUsd: legPnl,
      bumpedIv: safeIv,
      bumpedMarkUsd,
    });
  }

  return { scenario, totalPnlUsd, byLeg };
}

const ATM_SHIFT_VOL_PTS = [-10, -5, -2.5, -1, 0, 1, 2.5, 5, 10];
const SKEW_SHIFT_PER_LOG_K = [-0.5, -0.25, -0.1, -0.05, 0, 0.05, 0.1, 0.25, 0.5];

export function computeShockGrid(
  legsWithMarks: LegWithMark[],
  nowMs: number,
  atmStrike: number,
): ShockGridCell[][] {
  const grid: ShockGridCell[][] = [];

  for (const atmShift of ATM_SHIFT_VOL_PTS) {
    const row: ShockGridCell[] = [];
    for (const skewShift of SKEW_SHIFT_PER_LOG_K) {
      let totalPnlUsd = 0;
      for (const { leg, mark } of legsWithMarks) {
        if (mark.iv == null || mark.markPriceUsd == null) continue;

        const parallelBumped = applyVolShock(
          { kind: 'parallel', bumpVolPts: atmShift },
          mark.iv,
          leg.strike,
          leg.expiry,
          nowMs,
        );
        const skewBumped = applyVolShock(
          { kind: 'skew_tilt', atmStrike, slopePerLogK: skewShift },
          parallelBumped,
          leg.strike,
          leg.expiry,
          nowMs,
        );
        const safeIv = skewBumped > 0 ? skewBumped : 0.001;
        const bumpedMarkUsd = legMarkFromShockedIv(leg, mark, safeIv);
        if (bumpedMarkUsd == null) continue;
        totalPnlUsd += (bumpedMarkUsd - mark.markPriceUsd) * leg.size;
      }
      row.push({ atmShiftVolPts: atmShift, skewShiftPerLogK: skewShift, totalPnlUsd });
    }
    grid.push(row);
  }

  return grid;
}
