import type { IvHistoryPoint } from '@shared/enriched';

export type SkewDisplayMode = 'raw' | 'normalized' | 'zscore';
export type SkewMetricKey = 'rr25d' | 'bfly25d';

export interface SkewLinePoint {
  time: number;
  value: number;
}

interface MetricPoint {
  time: number;
  value: number;
}

function metricPoints(series: IvHistoryPoint[], key: SkewMetricKey): MetricPoint[] {
  const rows: MetricPoint[] = [];
  let prev = -Infinity;
  for (const point of series) {
    const value = point[key];
    if (value == null || !Number.isFinite(value)) continue;
    const time = Math.floor(point.ts / 1000);
    if (time <= prev) continue;
    rows.push({ time, value });
    prev = time;
  }
  return rows;
}

export function buildSkewLineData(
  series: IvHistoryPoint[],
  key: SkewMetricKey,
  mode: SkewDisplayMode,
): SkewLinePoint[] {
  if (mode === 'zscore') {
    const points = metricPoints(series, key);
    if (points.length < 2) return [];
    const mean = points.reduce((sum, point) => sum + point.value, 0) / points.length;
    const variance =
      points.reduce((sum, point) => sum + (point.value - mean) ** 2, 0) / points.length;
    const stddev = Math.sqrt(variance);
    if (!(stddev > 0)) return [];
    return points.map((point) => ({
      time: point.time,
      value: (point.value - mean) / stddev,
    }));
  }

  const rows: SkewLinePoint[] = [];
  let prev = -Infinity;
  for (const point of series) {
    const value = point[key];
    if (value == null || !Number.isFinite(value)) continue;
    const time = Math.floor(point.ts / 1000);
    if (time <= prev) continue;
    if (mode === 'normalized') {
      const atm = point.atmIv;
      if (atm == null || !Number.isFinite(atm) || atm <= 0) continue;
      rows.push({ time, value: (value / atm) * 100 });
    } else {
      rows.push({ time, value: value * 100 });
    }
    prev = time;
  }
  return rows;
}

export function latestSkewDisplayValue(
  series: IvHistoryPoint[],
  key: SkewMetricKey,
  mode: SkewDisplayMode,
): number | null {
  const rows = buildSkewLineData(series, key, mode);
  return rows.length > 0 ? rows[rows.length - 1]!.value : null;
}

export function formatSkewDisplayValue(
  value: number | null,
  mode: SkewDisplayMode,
): string {
  if (value == null || !Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  if (mode === 'zscore') return `${sign}${value.toFixed(2)}σ`;
  if (mode === 'normalized') return `${sign}${value.toFixed(1)}% ATM`;
  return `${sign}${value.toFixed(1)}%`;
}

export type SkewZone = 'normal' | 'stretched' | 'extreme';

export interface SkewReferenceLine {
  price: number;
  label: string;
  emphasis: 'strong' | 'soft';
}

export function referenceLines(mode: SkewDisplayMode): SkewReferenceLine[] {
  if (mode === 'zscore') {
    return [
      { price: 2, label: '+2σ', emphasis: 'strong' },
      { price: 1, label: '+1σ', emphasis: 'soft' },
      { price: 0, label: 'μ', emphasis: 'soft' },
      { price: -1, label: '-1σ', emphasis: 'soft' },
      { price: -2, label: '-2σ', emphasis: 'strong' },
    ];
  }
  if (mode === 'normalized') {
    return [{ price: 0, label: '0%', emphasis: 'soft' }];
  }
  return [];
}

export function zoneFor(value: number | null, mode: SkewDisplayMode): SkewZone | null {
  if (mode !== 'zscore' || value == null || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 2) return 'extreme';
  if (abs >= 1) return 'stretched';
  return 'normal';
}
