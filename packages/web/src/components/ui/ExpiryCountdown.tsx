import { useEffect, useMemo, useRef, useState } from 'react';

import { useExpiries, type ExpiryTimestamp } from '@features/chain/queries';
import { dteDays, formatExpiry, timeToExpiry } from '@lib/format';
import { useAppStore } from '@stores/app-store';

import styles from './ExpiryCountdown.module.css';

const DROPDOWN_LIMIT = 8;

const pad = (n: number) => n.toString().padStart(2, '0');

function fmtCompact(ts: ReturnType<typeof timeToExpiry>): string {
  if (ts.expired) return '00:00:00';
  if (ts.days >= 1) return `${ts.days}d ${pad(ts.hours)}:${pad(ts.minutes)}`;
  return `${pad(ts.hours)}:${pad(ts.minutes)}:${pad(ts.seconds)}`;
}

function fmtMenuRow(ts: ReturnType<typeof timeToExpiry>): string {
  if (ts.expired) return 'expired';
  if (ts.days >= 7) return `${ts.days}d`;
  if (ts.days >= 1) return `${ts.days}d ${pad(ts.hours)}h`;
  return `${pad(ts.hours)}:${pad(ts.minutes)}:${pad(ts.seconds)}`;
}

export default function ExpiryCountdown() {
  const underlying = useAppStore((s) => s.underlying);
  const selectedExpiry = useAppStore((s) => s.expiry);
  const setExpiry = useAppStore((s) => s.setExpiry);

  const { data } = useExpiries(underlying);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const upcoming = useMemo<ExpiryTimestamp[]>(() => {
    if (!data?.timestamps) return [];
    return data.timestamps
      .filter((t) => {
        const target = t.expiryTs ?? new Date(t.expiry + 'T08:00:00Z').getTime();
        return target > now - 60_000;
      })
      .slice(0, DROPDOWN_LIMIT);
  }, [data?.timestamps, now]);

  const nearest = upcoming[0];
  if (!nearest) return null;

  // Recompute on `now` tick — useMemo keyed on now forces re-render each second.
  const nearestTte = timeToExpiry(nearest.expiry, nearest.expiryTs);
  const urgent = !nearestTte.expired && nearestTte.totalMs < 6 * 3600 * 1000;

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        data-open={open ? 'true' : undefined}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Next expiry: ${nearest.expiry}`}
      >
        <span className={styles.label}>0DTE</span>
        <span className={styles.digital} data-urgent={urgent ? 'true' : undefined}>
          {fmtCompact(nearestTte)}
        </span>
      </button>

      {open && (
        <div className={styles.menu} role="listbox">
          <div className={styles.menuHeader}>Next expiries · {underlying}</div>
          {upcoming.map((item, idx) => {
            const tte = timeToExpiry(item.expiry, item.expiryTs);
            const dte = dteDays(item.expiry, item.expiryTs);
            const isUrgent = !tte.expired && tte.totalMs < 6 * 3600 * 1000;
            const tag = idx === 0 ? '0DTE' : idx === 1 ? '1DTE' : `${dte}d`;
            return (
              <button
                key={item.expiry}
                type="button"
                className={styles.row}
                role="option"
                aria-selected={item.expiry === selectedExpiry}
                data-active={item.expiry === selectedExpiry ? 'true' : undefined}
                data-urgent={isUrgent ? 'true' : undefined}
                onClick={() => {
                  setExpiry(item.expiry);
                  setOpen(false);
                }}
              >
                <span className={styles.dte}>{tag}</span>
                <span className={styles.date}>{formatExpiry(item.expiry)}</span>
                <span className={styles.countdown}>{fmtMenuRow(tte)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
