import { useEffect, useState } from 'react';

import styles from './Architect.module.css';

interface SnapshotBannerProps {
  dataUpdatedAt: number;
  refreshIntervalMs: number;
  hasData: boolean;
  isFetching: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  isEmpty?: boolean;
  onRetry?: () => void;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function SnapshotBanner({
  dataUpdatedAt,
  refreshIntervalMs,
  hasData,
  isFetching,
  isError = false,
  errorMessage = null,
  isEmpty = false,
  onRetry,
}: SnapshotBannerProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Retry in flight: previous attempt errored and a new fetch is now running.
  // Surface this explicitly so the click registers visually instead of falling
  // through to the generic "Loading…" state, which is indistinguishable from
  // the error banner at a glance.
  if (isError && isFetching) {
    return (
      <div className={styles.snapshotBanner} data-state="loading">
        <span className={styles.snapshotDot} />
        <span className={styles.snapshotPrimary}>Retrying snapshot…</span>
        <span className={styles.snapshotSecondary}>fetching from upstream</span>
      </div>
    );
  }

  // Hard error: latest fetch failed AND there's no cached data on screen.
  // This is the "you have nothing to look at" case.
  if (isError && !hasData) {
    return (
      <div className={styles.snapshotBanner} data-state="error">
        <span className={styles.snapshotDot} />
        <span className={styles.snapshotPrimary}>Snapshot unavailable</span>
        <span className={styles.snapshotSecondary}>
          {errorMessage ?? 'upstream candle fetch failed'}
        </span>
        {onRetry && (
          <button type="button" className={styles.snapshotRetry} onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  // Soft error: latest fetch failed but `keepPreviousData` left a previous
  // successful payload on screen. The chart has usable candles, so don't
  // shout "unavailable" — that's misleading. Surface as a stale-data warning
  // and still offer a retry.
  if (isError && hasData) {
    return (
      <div className={styles.snapshotBanner} data-state="error">
        <span className={styles.snapshotDot} />
        <span className={styles.snapshotPrimary}>Snapshot stale</span>
        <span className={styles.snapshotSecondary}>
          {errorMessage ?? 'last refresh failed — showing cached candles'}
        </span>
        {onRetry && (
          <button type="button" className={styles.snapshotRetry} onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className={styles.snapshotBanner} data-state="loading">
        <span className={styles.snapshotDot} />
        <span>Loading snapshot…</span>
      </div>
    );
  }

  // Server returned 200 with an empty candle array (e.g. Zod parse fallback).
  // This is distinct from "still loading" — the request succeeded with
  // unusable data. Surface it explicitly so the user knows to try later.
  if (isEmpty && !isFetching) {
    return (
      <div className={styles.snapshotBanner} data-state="error">
        <span className={styles.snapshotDot} />
        <span className={styles.snapshotPrimary}>No spot history available</span>
        <span className={styles.snapshotSecondary}>upstream returned empty data</span>
        {onRetry && (
          <button type="button" className={styles.snapshotRetry} onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  // Tenor switch: candle data from previous query is still on screen via
  // keepPreviousData, but a new fetch is in flight. Show a transient
  // "updating" state so the user knows the chart is mid-swap.
  if (isFetching && !dataUpdatedAt) {
    return (
      <div className={styles.snapshotBanner} data-state="loading">
        <span className={styles.snapshotDot} />
        <span className={styles.snapshotPrimary}>Updating snapshot…</span>
        <span className={styles.snapshotSecondary}>tenor changed — refetching</span>
      </div>
    );
  }

  const elapsed = dataUpdatedAt ? Date.now() - dataUpdatedAt : 0;
  const remainingMs = Math.max(0, refreshIntervalMs - elapsed);
  const seconds = Math.floor(remainingMs / 1000);

  return (
    <div className={styles.snapshotBanner} data-state={isFetching ? 'refreshing' : 'fresh'}>
      <span className={styles.snapshotDot} />
      <span className={styles.snapshotPrimary}>
        {isFetching ? 'Refreshing snapshot…' : `Snapshot — refreshes in ${formatCountdown(seconds)}`}
      </span>
      <span className={styles.snapshotSecondary}>
        prices may have moved since last fetch
      </span>
    </div>
  );
}
