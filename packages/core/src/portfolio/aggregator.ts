import type {
  BreakEvenIvRow,
  ExpiryBucketRow,
  PortfolioTotals,
  VegaByStrikeRow,
} from '@oggregator/protocol';

import { price76, solveIv } from '../feeds/thalex/bs-solver.js';
import { vanna76, volga76 } from './greeks-extra.js';
import type { MarkContext, MarkProvider, PositionLeg } from './types.js';

interface LegWithMark {
  leg: PositionLeg;
  mark: MarkContext;
}

export function attachMarks(legs: PositionLeg[], provider: MarkProvider): LegWithMark[] {
  return legs.map((leg) => ({ leg, mark: provider(leg) }));
}

function dteDays(expiry: string, nowMs: number): number {
  const target = Date.parse(`${expiry}T08:00:00.000Z`);
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, Math.ceil((target - nowMs) / 86_400_000));
}

function strikeKeyOf(strike: number, expiry: string): string {
  return `${expiry}|${strike}`;
}

export function aggregateGreeksByStrike(legsWithMarks: LegWithMark[]): VegaByStrikeRow[] {
  const acc = new Map<string, VegaByStrikeRow>();

  for (const { leg, mark } of legsWithMarks) {
    const key = strikeKeyOf(leg.strike, leg.expiry);
    const row = acc.get(key) ?? {
      strike: leg.strike,
      expiry: leg.expiry,
      vega: 0,
      gamma: 0,
      vanna: 0,
      volga: 0,
      contracts: 0,
    };

    const vanna = vanna76(mark.forwardPriceUsd, leg.strike, mark.iv, mark.yearsToExpiry) ?? 0;
    const volga = volga76(mark.forwardPriceUsd, leg.strike, mark.iv, mark.yearsToExpiry) ?? 0;

    row.vega += (mark.vega ?? 0) * leg.size;
    row.gamma += (mark.gamma ?? 0) * leg.size;
    row.vanna += vanna * leg.size;
    row.volga += volga * leg.size;
    row.contracts += leg.size;

    acc.set(key, row);
  }

  return [...acc.values()].sort((a, b) => {
    if (a.expiry !== b.expiry) return a.expiry < b.expiry ? -1 : 1;
    return a.strike - b.strike;
  });
}

export function aggregateGreeksByExpiry(
  legsWithMarks: LegWithMark[],
  nowMs: number,
): ExpiryBucketRow[] {
  const acc = new Map<string, ExpiryBucketRow>();

  for (const { leg, mark } of legsWithMarks) {
    const row = acc.get(leg.expiry) ?? {
      expiry: leg.expiry,
      dte: dteDays(leg.expiry, nowMs),
      vega: 0,
      gamma: 0,
      theta: 0,
      contracts: 0,
    };

    row.vega += (mark.vega ?? 0) * leg.size;
    row.gamma += (mark.gamma ?? 0) * leg.size;
    row.theta += (mark.theta ?? 0) * leg.size;
    row.contracts += leg.size;

    acc.set(leg.expiry, row);
  }

  return [...acc.values()].sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
}

export function breakEvenIvCurve(legsWithMarks: LegWithMark[]): BreakEvenIvRow[] {
  return legsWithMarks.map(({ leg, mark }) => {
    const breakEvenIv =
      mark.forwardPriceUsd == null || mark.yearsToExpiry == null
        ? null
        : solveIv({
            price: leg.entryPriceUsd,
            forward: mark.forwardPriceUsd,
            strike: leg.strike,
            tYears: mark.yearsToExpiry,
            right: leg.optionRight,
            seed: mark.iv ?? leg.entryIv ?? null,
          });

    const ivCushionPct =
      mark.iv != null && breakEvenIv != null && breakEvenIv > 0
        ? (mark.iv - breakEvenIv) / breakEvenIv
        : null;

    return {
      legId: leg.legId,
      strike: leg.strike,
      expiry: leg.expiry,
      optionRight: leg.optionRight,
      entryIv: leg.entryIv,
      currentMarkUsd: mark.markPriceUsd,
      currentIv: mark.iv,
      breakEvenIv,
      ivCushionPct,
    };
  });
}

export function computeTotals(legsWithMarks: LegWithMark[]): PortfolioTotals {
  const totals: PortfolioTotals = {
    netDeltaUsd: 0,
    netGammaUsd: 0,
    netVegaUsd: 0,
    netThetaUsd: 0,
    netVannaUsd: 0,
    netVolgaUsd: 0,
    unrealizedPnlUsd: 0,
  };

  for (const { leg, mark } of legsWithMarks) {
    totals.netDeltaUsd += (mark.delta ?? 0) * leg.size;
    totals.netGammaUsd += (mark.gamma ?? 0) * leg.size;
    totals.netVegaUsd += (mark.vega ?? 0) * leg.size;
    totals.netThetaUsd += (mark.theta ?? 0) * leg.size;
    totals.netVannaUsd +=
      (vanna76(mark.forwardPriceUsd, leg.strike, mark.iv, mark.yearsToExpiry) ?? 0) * leg.size;
    totals.netVolgaUsd +=
      (volga76(mark.forwardPriceUsd, leg.strike, mark.iv, mark.yearsToExpiry) ?? 0) * leg.size;
    if (mark.markPriceUsd != null) {
      totals.unrealizedPnlUsd += (mark.markPriceUsd - leg.entryPriceUsd) * leg.size;
    }
  }

  return totals;
}

export function legMarkFromShockedIv(
  leg: PositionLeg,
  mark: MarkContext,
  bumpedIv: number,
): number | null {
  if (mark.forwardPriceUsd == null || mark.yearsToExpiry == null) return null;
  if (!(bumpedIv > 0)) return null;
  return price76(mark.forwardPriceUsd, leg.strike, bumpedIv, mark.yearsToExpiry, leg.optionRight);
}
