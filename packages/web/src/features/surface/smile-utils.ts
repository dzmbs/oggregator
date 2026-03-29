import type { EnrichedChainResponse } from "@shared/enriched";

export type XAxisMode = "strike" | "delta";

export interface SmilePoint {
  strike: number;
  iv:     number;
}

// Delta mode x-axis: put side 0.05→0.50 (OTM put→ATM), call side 0.50→0.95 (ATM→OTM call)
// Put:  x = |put_delta|        (5P=0.05, 25P=0.25, ATM=0.50)
// Call: x = 1 - call_delta     (ATM=0.50, 25C=0.75, 5C=0.95)
export const DELTA_BUCKET_SIZE = 0.05; // 5-delta buckets

export function averageIv(
  venues: Record<string, { markIv?: number | null } | undefined>,
  activeVenues: string[],
): number | null {
  let sum = 0;
  let count = 0;
  for (const [venueId, quote] of Object.entries(venues)) {
    if (!activeVenues.includes(venueId) || quote?.markIv == null) continue;
    sum += quote.markIv;
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

export function deltaTickLabel(x: number): string {
  if (Math.abs(x - 0.5) < 0.01) return "ATM";
  if (x < 0.5) {
    const d = Math.round(x * 100);
    return `${d}Δp`;
  }
  const d = Math.round((1 - x) * 100);
  return `${d}Δc`;
}

export function extractSmile(
  strikes: EnrichedChainResponse["strikes"],
  activeVenues: string[],
  spotPrice: number | null,
  xAxis: XAxisMode,
): SmilePoint[] {
  const points: SmilePoint[] = [];

  for (const s of strikes) {
    if (xAxis === "delta") {
      // Put side: map |put_delta| → x (left half, 0→0.50)
      const putIv = averageIv(s.put.venues, activeVenues);
      const putDelta = averageDelta(s.put.venues, activeVenues);
      if (putIv != null && putDelta != null && putDelta < -0.02) {
        const x = Math.abs(putDelta);
        points.push({ strike: x, iv: putIv * 100 });
      }

      // Call side: map (1 - call_delta) → x (right half, 0.50→1.0)
      const callIv = averageIv(s.call.venues, activeVenues);
      const callDelta = averageDelta(s.call.venues, activeVenues);
      if (callIv != null && callDelta != null && callDelta > 0.02) {
        const x = 1 - callDelta;
        points.push({ strike: x, iv: callIv * 100 });
      }
    } else {
      const callIv = averageIv(s.call.venues, activeVenues);
      const putIv = averageIv(s.put.venues, activeVenues);
      const iv = spotPrice && s.strike < spotPrice ? putIv : callIv;
      if (iv != null) points.push({ strike: s.strike, iv: iv * 100 });
    }
  }

  if (xAxis === "strike") {
    const band = spotPrice ? spotPrice * 0.3 : Infinity;
    return points
      .filter((p) => !spotPrice || Math.abs(p.strike - spotPrice) <= band)
      .sort((a, b) => a.strike - b.strike);
  }

  // Delta mode: bucket to DELTA_BUCKET_SIZE, average within each bucket
  const buckets = new Map<number, { sum: number; count: number }>();
  for (const p of points) {
    if (p.strike < 0.03 || p.strike > 0.97) continue;
    const key = Math.round(p.strike / DELTA_BUCKET_SIZE) * DELTA_BUCKET_SIZE;
    const rounded = Math.round(key * 100) / 100;
    const b = buckets.get(rounded);
    if (b) { b.sum += p.iv; b.count += 1; }
    else buckets.set(rounded, { sum: p.iv, count: 1 });
  }

  return Array.from(buckets, ([k, v]) => ({ strike: k, iv: v.sum / v.count }))
    .sort((a, b) => a.strike - b.strike);
}
