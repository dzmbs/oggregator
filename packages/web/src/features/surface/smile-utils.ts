import type { EnrichedChainResponse } from '@shared/enriched';

export type XAxisMode = 'strike' | 'delta';

export interface SmilePoint {
  strike: number;
  iv: number;
}

export const DELTA_BUCKET_SIZE = 0.05;

// Some venues stamp markIv: 0 (or NaN) for strikes with no quote rather than
// null. Treat anything ≤ 0 or non-finite as missing so it doesn't drag the
// cross-venue average toward zero.
function isValidIv(iv: number | null | undefined): iv is number {
  return iv != null && Number.isFinite(iv) && iv > 0;
}

export function averageIv(
  venues: Record<string, { markIv?: number | null } | undefined>,
  activeVenues: string[],
): number | null {
  let sum = 0;
  let count = 0;
  for (const [venueId, quote] of Object.entries(venues)) {
    if (!activeVenues.includes(venueId)) continue;
    if (!isValidIv(quote?.markIv)) continue;
    sum += quote!.markIv as number;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

export function averageDelta(
  venues: Record<string, { delta?: number | null } | undefined>,
  activeVenues: string[],
): number | null {
  let sum = 0;
  let count = 0;
  for (const [venueId, quote] of Object.entries(venues)) {
    if (!activeVenues.includes(venueId) || quote?.delta == null) continue;
    sum += quote.delta;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

// Put side: x = |put_delta| (5Δp=0.05, 25Δp=0.25, ATM=0.50)
// Call side: x = 1 - call_delta (ATM=0.50, 25Δc=0.75, 5Δc=0.95)
export function deltaTickLabel(x: number): string {
  if (Math.abs(x - 0.5) < 0.01) return 'ATM';
  if (x < 0.5) {
    const d = Math.round(x * 100);
    return `${d}\u0394p`;
  }
  const d = Math.round((1 - x) * 100);
  return `${d}\u0394c`;
}

export function extractSmile(
  strikes: EnrichedChainResponse['strikes'],
  activeVenues: string[],
  spotPrice: number | null,
  xAxis: XAxisMode,
): SmilePoint[] {
  const points: SmilePoint[] = [];

  for (const s of strikes) {
    if (xAxis === 'delta') {
      // OTM-only convention: puts on the left wing (|δ| ≤ 0.5), calls on the
      // right wing (δ ≤ 0.5). ITM legs are dropped — they map to the opposite
      // wing where their wide spreads/stale marks would distort the smile.
      const putIv = averageIv(s.put.venues, activeVenues);
      const putDelta = averageDelta(s.put.venues, activeVenues);
      if (putIv != null && putDelta != null && putDelta < -0.02 && putDelta >= -0.5) {
        points.push({ strike: Math.abs(putDelta), iv: putIv * 100 });
      }

      const callIv = averageIv(s.call.venues, activeVenues);
      const callDelta = averageDelta(s.call.venues, activeVenues);
      if (callIv != null && callDelta != null && callDelta > 0.02 && callDelta <= 0.5) {
        points.push({ strike: 1 - callDelta, iv: callIv * 100 });
      }
    } else {
      // OTM convention: put IV below spot, call IV above
      const callIv = averageIv(s.call.venues, activeVenues);
      const putIv = averageIv(s.put.venues, activeVenues);
      const iv = spotPrice != null && s.strike < spotPrice ? putIv : callIv;
      if (iv != null) points.push({ strike: s.strike, iv: iv * 100 });
    }
  }

  if (xAxis === 'strike') {
    const band = spotPrice ? spotPrice * 0.3 : Infinity;
    return points
      .filter((p) => spotPrice == null || Math.abs(p.strike - spotPrice) <= band)
      .sort((a, b) => a.strike - b.strike);
  }

  // Delta mode: bucket into DELTA_BUCKET_SIZE increments, average within each
  const buckets = new Map<number, { sum: number; count: number }>();
  for (const p of points) {
    if (p.strike < 0.03 || p.strike > 0.97) continue;
    const key = Math.round(Math.round(p.strike / DELTA_BUCKET_SIZE) * DELTA_BUCKET_SIZE * 100) / 100;
    const b = buckets.get(key);
    if (b) { b.sum += p.iv; b.count += 1; }
    else buckets.set(key, { sum: p.iv, count: 1 });
  }

  return Array.from(buckets, ([k, v]) => ({ strike: k, iv: v.sum / v.count }))
    .sort((a, b) => a.strike - b.strike);
}
