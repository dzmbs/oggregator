import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pickCandleSpec } from './PayoffChartV2';
import type { Leg } from './payoff';

function leg(expiry: string): Leg {
  return {
    id: expiry,
    type: 'call',
    direction: 'buy',
    strike: 100,
    expiry,
    quantity: 1,
    entryPrice: 1,
    venue: 'deribit',
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    iv: null,
  };
}

function expiryInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

describe('pickCandleSpec', () => {
  // Pin clock past 08:00 UTC so dteDays — which anchors expiry dates to
  // 08:00Z and uses Math.ceil — returns the day-offset exactly.
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T12:00:00Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('defaults to 1h × 24 buckets when no legs', () => {
    expect(pickCandleSpec([])).toEqual({ resolutionSec: 3600, buckets: 24 });
  });

  it('intraday picks 5m × 48 buckets', () => {
    expect(pickCandleSpec([leg(expiryInDays(0))])).toEqual({ resolutionSec: 300, buckets: 48 });
  });

  it('1–3d picks 30m and collapses same-tier DTEs onto the same key', () => {
    const spec1d = pickCandleSpec([leg(expiryInDays(1))]);
    const spec2d = pickCandleSpec([leg(expiryInDays(2))]);
    expect(spec1d.resolutionSec).toBe(1800);
    expect(spec2d.resolutionSec).toBe(1800);
    // Same tier ⇒ same bucket count ⇒ same query key ⇒ server cache stays warm.
    expect(spec1d.buckets).toBe(spec2d.buckets);
  });

  it('3–14d picks 1h with two sub-tiers around the 7d boundary', () => {
    const spec3d = pickCandleSpec([leg(expiryInDays(3))]);
    const spec5d = pickCandleSpec([leg(expiryInDays(5))]);
    const spec10d = pickCandleSpec([leg(expiryInDays(10))]);
    expect(spec3d.resolutionSec).toBe(3600);
    expect(spec10d.resolutionSec).toBe(3600);
    // < 7d collapses to one tier, ≥ 7d to another.
    expect(spec3d.buckets).toBe(spec5d.buckets);
    expect(spec3d.buckets).toBeLessThan(spec10d.buckets);
  });

  it('14–60d picks 4h with two sub-tiers around the 30d boundary', () => {
    const spec14d = pickCandleSpec([leg(expiryInDays(14))]);
    const spec25d = pickCandleSpec([leg(expiryInDays(25))]);
    const spec45d = pickCandleSpec([leg(expiryInDays(45))]);
    expect(spec14d.resolutionSec).toBe(14400);
    expect(spec45d.resolutionSec).toBe(14400);
    expect(spec14d.buckets).toBe(spec25d.buckets);
    expect(spec14d.buckets).toBeLessThan(spec45d.buckets);
  });

  it('60d+ picks daily resolution', () => {
    const spec90d = pickCandleSpec([leg(expiryInDays(90))]);
    expect(spec90d.resolutionSec).toBe(86400);
  });

  it('uses the nearest leg DTE when legs have mixed expiries', () => {
    const legs = [leg(expiryInDays(45)), leg(expiryInDays(2))];
    const spec = pickCandleSpec(legs);
    expect(spec.resolutionSec).toBe(1800);
  });
});
