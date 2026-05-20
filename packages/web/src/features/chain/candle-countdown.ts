import { useEffect, useState } from 'react';
import type { InstrumentCandleInterval } from '@oggregator/protocol';

const INTERVAL_MS: Record<InstrumentCandleInterval, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

export function nextBucketCloseMs(intervalMs: number, now: number): number {
  return (Math.floor(now / intervalMs) + 1) * intervalMs;
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function useCandleCountdown(interval: InstrumentCandleInterval): string {
  const intervalMs = INTERVAL_MS[interval];
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return formatCountdown(nextBucketCloseMs(intervalMs, now) - now);
}
