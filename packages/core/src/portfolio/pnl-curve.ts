import type { PortfolioPnlCurve, PortfolioPnlPoint, PositionLeg } from '@oggregator/protocol';

import { price76 } from '../feeds/thalex/bs-solver.js';

import type { MarkContext } from './types.js';

interface LegWithMark {
  leg: PositionLeg;
  mark: MarkContext;
}

const CURVE_POINTS = 61;
const DAY_MS = 86_400_000;

function yearsUntil(expiry: string, nowMs: number): number {
  const target = Date.parse(`${expiry}T08:00:00.000Z`);
  if (!Number.isFinite(target)) return 0;
  const seconds = (target - nowMs) / 1000;
  return seconds > 0 ? seconds / (365 * 24 * 60 * 60) : 0;
}

function intrinsicValue(underlyingPriceUsd: number, strike: number, right: PositionLeg['optionRight']): number {
  return right === 'call'
    ? Math.max(0, underlyingPriceUsd - strike)
    : Math.max(0, strike - underlyingPriceUsd);
}

function average(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function interpolateZero(
  leftX: number,
  leftY: number,
  rightX: number,
  rightY: number,
): number | null {
  const spanY = rightY - leftY;
  if (!Number.isFinite(spanY) || Math.abs(spanY) < 1e-9) return null;
  const weight = -leftY / spanY;
  if (!(weight >= 0 && weight <= 1)) return null;
  return leftX + (rightX - leftX) * weight;
}

function dedupeSorted(values: number[], epsilon = 1e-6): number[] {
  const sorted = [...values].sort((left, right) => left - right);
  const deduped: number[] = [];
  for (const value of sorted) {
    const last = deduped[deduped.length - 1];
    if (last == null || Math.abs(last - value) > epsilon) deduped.push(value);
  }
  return deduped;
}

function breakEvenPrices(points: PortfolioPnlPoint[]): number[] {
  const prices: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point == null) continue;
    if (Math.abs(point.expiryPnlUsd) < 1e-9) prices.push(point.underlyingPriceUsd);
    const next = points[index + 1];
    if (next == null) continue;
    if ((point.expiryPnlUsd < 0 && next.expiryPnlUsd > 0) || (point.expiryPnlUsd > 0 && next.expiryPnlUsd < 0)) {
      const crossing = interpolateZero(
        point.underlyingPriceUsd,
        point.expiryPnlUsd,
        next.underlyingPriceUsd,
        next.expiryPnlUsd,
      );
      if (crossing != null) prices.push(crossing);
    }
  }
  return dedupeSorted(prices);
}

function hasPlateau(values: number[], target: number, tolerance: number): boolean {
  for (let index = 0; index < values.length - 1; index += 1) {
    const left = values[index];
    const right = values[index + 1];
    if (left == null || right == null) continue;
    if (Math.abs(left - target) <= tolerance && Math.abs(right - target) <= tolerance) {
      return true;
    }
  }
  return false;
}

function buildPriceRange(legsWithMarks: LegWithMark[], currentSpotUsd: number | null): [number, number] {
  const strikes = legsWithMarks.map(({ leg }) => leg.strike);
  const minAnchor = Math.min(...strikes, currentSpotUsd ?? Number.POSITIVE_INFINITY);
  const maxAnchor = Math.max(...strikes, currentSpotUsd ?? 0);
  const anchor = currentSpotUsd ?? average(strikes) ?? Math.max(1, maxAnchor);
  const padding = Math.max((maxAnchor - minAnchor) * 0.35, anchor * 0.2, 250);
  const minPrice = Math.max(1, minAnchor - padding);
  const maxPrice = Math.max(minPrice + 1, maxAnchor + padding);
  return [minPrice, maxPrice];
}

function markAtHorizon(
  leg: PositionLeg,
  mark: MarkContext,
  underlyingPriceUsd: number,
  tYears: number,
): number | null {
  if (!(underlyingPriceUsd > 0)) return null;
  if (!(tYears > 0)) return intrinsicValue(underlyingPriceUsd, leg.strike, leg.optionRight);
  const sigma = mark.iv ?? leg.entryIv ?? null;
  if (!(sigma != null && sigma > 0)) return null;
  return price76(underlyingPriceUsd, leg.strike, sigma, tYears, leg.optionRight);
}

export function buildPortfolioPnlCurve(
  legsWithMarks: LegWithMark[],
  nowMs: number,
  forwardDays: number,
): PortfolioPnlCurve {
  if (legsWithMarks.length === 0) {
    return {
      status: 'empty',
      underlying: null,
      currentSpotUsd: null,
      breakEvenPricesUsd: [],
      maxProfitUsd: null,
      maxLossUsd: null,
      upsideBounded: false,
      downsideBounded: false,
      points: [],
    };
  }

  const underlying = legsWithMarks[0]?.leg.underlying ?? null;
  if (underlying == null || legsWithMarks.some(({ leg }) => leg.underlying !== underlying)) {
    return {
      status: 'mixed_underlyings',
      underlying: null,
      currentSpotUsd: null,
      breakEvenPricesUsd: [],
      maxProfitUsd: null,
      maxLossUsd: null,
      upsideBounded: false,
      downsideBounded: false,
      points: [],
    };
  }

  const currentSpotUsd = average(
    legsWithMarks.map(({ mark }) => mark.underlyingPriceUsd ?? mark.forwardPriceUsd),
  );
  const [minPrice, maxPrice] = buildPriceRange(legsWithMarks, currentSpotUsd);
  const priceStep = (maxPrice - minPrice) / (CURVE_POINTS - 1);
  const forwardNowMs = nowMs + Math.max(0, forwardDays) * DAY_MS;
  const points: PortfolioPnlPoint[] = [];

  for (let index = 0; index < CURVE_POINTS; index += 1) {
    const underlyingPriceUsd = minPrice + priceStep * index;
    let nowPnlUsd = 0;
    let forwardPnlUsd = 0;
    let expiryPnlUsd = 0;

    for (const { leg, mark } of legsWithMarks) {
      const nowValue = markAtHorizon(leg, mark, underlyingPriceUsd, yearsUntil(leg.expiry, nowMs));
      if (nowValue == null) {
        return {
          status: 'missing_marks',
          underlying,
          currentSpotUsd,
          breakEvenPricesUsd: [],
          maxProfitUsd: null,
          maxLossUsd: null,
          upsideBounded: false,
          downsideBounded: false,
          points: [],
        };
      }

      const forwardValue =
        forwardDays > 0
          ? markAtHorizon(leg, mark, underlyingPriceUsd, yearsUntil(leg.expiry, forwardNowMs))
          : nowValue;
      if (forwardValue == null) {
        return {
          status: 'missing_marks',
          underlying,
          currentSpotUsd,
          breakEvenPricesUsd: [],
          maxProfitUsd: null,
          maxLossUsd: null,
          upsideBounded: false,
          downsideBounded: false,
          points: [],
        };
      }

      const expiryValue = intrinsicValue(underlyingPriceUsd, leg.strike, leg.optionRight);
      nowPnlUsd += (nowValue - leg.entryPriceUsd) * leg.size;
      forwardPnlUsd += (forwardValue - leg.entryPriceUsd) * leg.size;
      expiryPnlUsd += (expiryValue - leg.entryPriceUsd) * leg.size;
    }

    points.push({
      underlyingPriceUsd,
      nowPnlUsd,
      forwardPnlUsd: forwardDays > 0 ? forwardPnlUsd : null,
      expiryPnlUsd,
    });
  }

  const expiryValues = points.map((point) => point.expiryPnlUsd);
  const maxProfitUsd = Math.max(...expiryValues);
  const maxLossUsd = Math.min(...expiryValues);
  const maxAbs = Math.max(...expiryValues.map((value) => Math.abs(value)), 1);
  const plateauTolerance = Math.max(1, maxAbs * 0.01);
  const first = expiryValues[0] ?? 0;
  const second = expiryValues[1] ?? first;
  const last = expiryValues[expiryValues.length - 1] ?? 0;
  const prev = expiryValues[expiryValues.length - 2] ?? last;

  return {
    status: 'ok',
    underlying,
    currentSpotUsd,
    breakEvenPricesUsd: breakEvenPrices(points),
    maxProfitUsd: hasPlateau(expiryValues, maxProfitUsd, plateauTolerance) ? maxProfitUsd : null,
    maxLossUsd: hasPlateau(expiryValues, maxLossUsd, plateauTolerance) ? maxLossUsd : null,
    upsideBounded: Math.abs(last - prev) <= plateauTolerance,
    downsideBounded: Math.abs(second - first) <= plateauTolerance,
    points,
  };
}
