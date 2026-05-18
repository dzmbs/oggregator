import type {
  BreakEvenIvRow,
  ExpiryBucketRow,
  PortfolioTotals,
  VegaByStrikeRow,
} from '@oggregator/protocol';

import { price76, solveIv } from '../feeds/thalex/bs-solver.js';
import { vannaPct76, volgaPct76 } from './greeks-extra.js';
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

function strikeKeyOf(strike: number, expiry: string, optionRight: 'call' | 'put'): string {
  return `${expiry}|${strike}|${optionRight}`;
}

export function aggregateGreeksByStrike(legsWithMarks: LegWithMark[]): VegaByStrikeRow[] {
  const acc = new Map<string, VegaByStrikeRow>();

  for (const { leg, mark } of legsWithMarks) {
    const key = strikeKeyOf(leg.strike, leg.expiry, leg.optionRight);
    const row: VegaByStrikeRow = acc.get(key) ?? {
      strike: leg.strike,
      expiry: leg.expiry,
      optionRight: leg.optionRight,
      delta: 0,
      vega: 0,
      gamma: 0,
      vanna: 0,
      volga: 0,
      contracts: 0,
    };

    const vanna = vannaPct76(mark.forwardPriceUsd, leg.strike, mark.iv, mark.yearsToExpiry) ?? 0;
    const volga = volgaPct76(mark.forwardPriceUsd, leg.strike, mark.iv, mark.yearsToExpiry) ?? 0;

    row.delta += (mark.delta ?? 0) * leg.size;
    row.vega += (mark.vega ?? 0) * leg.size;
    row.gamma += (mark.gamma ?? 0) * leg.size;
    row.vanna += vanna * leg.size;
    row.volga += volga * leg.size;
    // Gross open contracts at the strike — same convention as byExpiry so a
    // long/short pair at one strike doesn't read as zero exposure.
    row.contracts += Math.abs(leg.size);

    acc.set(key, row);
  }

  return [...acc.values()].sort((a, b) => {
    if (a.expiry !== b.expiry) return a.expiry < b.expiry ? -1 : 1;
    if (a.strike !== b.strike) return a.strike - b.strike;
    return a.optionRight < b.optionRight ? -1 : 1;
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
    // Gross open contracts in the expiry — net signed sum would be 0 for any
    // balanced spread, which hides real position size in the UI.
    row.contracts += Math.abs(leg.size);

    acc.set(leg.expiry, row);
  }

  return [...acc.values()].sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
}

const BE_IV_CAP = 3.0;

export function breakEvenIvCurve(legsWithMarks: LegWithMark[]): BreakEvenIvRow[] {
  return legsWithMarks.map(({ leg, mark }) => {
    let breakEvenIv: number | null = null;
    let beNote: 'capped' | 'below_intrinsic' | 'above_upper' | undefined;

    if (
      mark.forwardPriceUsd != null &&
      mark.yearsToExpiry != null &&
      mark.forwardPriceUsd > 0 &&
      mark.yearsToExpiry > 0
    ) {
      const intrinsic =
        leg.optionRight === 'call'
          ? Math.max(0, mark.forwardPriceUsd - leg.strike)
          : Math.max(0, leg.strike - mark.forwardPriceUsd);
      const upper = leg.optionRight === 'call' ? mark.forwardPriceUsd : leg.strike;

      if (leg.entryPriceUsd <= intrinsic) {
        beNote = 'below_intrinsic';
      } else if (leg.entryPriceUsd >= upper) {
        beNote = 'above_upper';
      } else {
        const solved = solveIv({
          price: leg.entryPriceUsd,
          forward: mark.forwardPriceUsd,
          strike: leg.strike,
          tYears: mark.yearsToExpiry,
          right: leg.optionRight,
          seed: mark.iv ?? leg.entryIv ?? null,
        });
        if (solved != null && solved > BE_IV_CAP) {
          breakEvenIv = BE_IV_CAP;
          beNote = 'capped';
        } else {
          breakEvenIv = solved;
        }
      }
    }

    const ivCushionPct =
      mark.iv != null && breakEvenIv != null && breakEvenIv > 0 && beNote == null
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
      ...(mark.ivFromSvi === true ? { currentIvIsModel: true } : {}),
      ...(beNote != null ? { beNote } : {}),
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
      (vannaPct76(mark.forwardPriceUsd, leg.strike, mark.iv, mark.yearsToExpiry) ?? 0) * leg.size;
    totals.netVolgaUsd +=
      (volgaPct76(mark.forwardPriceUsd, leg.strike, mark.iv, mark.yearsToExpiry) ?? 0) * leg.size;
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
