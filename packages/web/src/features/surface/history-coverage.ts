import type { IvHistoryPoint } from '@shared/enriched';
import type { IvHistoryWindow } from './queries';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

type HistoryKey = 'atmIv' | 'rr25d' | 'bfly25d';

export interface HistoryCoverage {
  label: string;
  short: boolean;
  coverageMs: number;
}

export function getHistoryCoverage(
  series: IvHistoryPoint[],
  window: IvHistoryWindow,
  keys: HistoryKey[],
): HistoryCoverage {
  const timestamps = series
    .filter((point) => keys.some((key) => point[key] != null && Number.isFinite(point[key])))
    .map((point) => point.ts)
    .filter((ts) => Number.isFinite(ts))
    .sort((a, b) => a - b);

  const targetDays = window === '90d' ? 90 : 30;
  const targetMs = targetDays * MS_PER_DAY;
  if (timestamps.length === 0) {
    return { label: `history: none / ${window}`, short: true, coverageMs: 0 };
  }

  const first = timestamps[0]!;
  const last = timestamps[timestamps.length - 1]!;
  const coverageMs = Math.max(0, last - first);
  return {
    label: `history: ${formatCoverage(coverageMs)} / ${window}`,
    short: coverageMs < targetMs * 0.75,
    coverageMs,
  };
}

function formatCoverage(ms: number): string {
  if (ms < MS_PER_HOUR) {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    return `${minutes}m`;
  }
  if (ms < MS_PER_DAY) {
    const hours = Math.max(1, Math.round(ms / MS_PER_HOUR));
    return `${hours}h`;
  }
  return `${Math.round(ms / MS_PER_DAY)}d`;
}
