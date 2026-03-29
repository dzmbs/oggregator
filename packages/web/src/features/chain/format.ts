import type { NormalizedOptionContract } from '@shared/common';

export function fmtUsd(v: number | null | undefined): string {
  if (v == null) return '–';
  if (v >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (v >= 100) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}

export function fmtIv(v: number | null | undefined): string {
  if (v == null) return '–';
  return `${(v * 100).toFixed(1)}%`;
}

export function getSortedByAsk(
  side: Record<string, NormalizedOptionContract>,
): Array<{ venue: string; contract: NormalizedOptionContract }> {
  return Object.entries(side)
    .filter(([, c]) => c.quote.ask.usd != null)
    .sort(([, a], [, b]) => (a.quote.ask.usd ?? Infinity) - (b.quote.ask.usd ?? Infinity))
    .map(([venue, contract]) => ({ venue, contract }));
}

export function getLiquidityLevel(askSize: number | null): 'high' | 'mid' | 'low' {
  if (askSize == null) return 'low';
  if (askSize >= 50) return 'high';
  if (askSize >= 15) return 'mid';
  return 'low';
}

export function findAtmStrike(strikes: number[], spotPrice: number): number | null {
  if (strikes.length === 0) return null;
  let closest = strikes[0]!;
  let minDist = Math.abs(closest - spotPrice);
  for (const s of strikes) {
    const dist = Math.abs(s - spotPrice);
    if (dist < minDist) {
      closest = s;
      minDist = dist;
    }
  }
  return closest;
}
