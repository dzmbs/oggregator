import { useEffect, useState } from 'react';

import { useAppStore } from '@stores/app-store';

import styles from './SessionNotice.module.css';

function reload() {
  window.location.reload();
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function SessionNotice() {
  const notice = useAppStore((s) => s.sessionNotice);
  const extendSession = useAppStore((s) => s.extendSession);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (notice?.kind !== 'idle-warning') return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [notice?.kind]);

  if (!notice) return null;

  const titleId = 'session-notice-title';

  if (notice.kind === 'server-updated') {
    return (
      <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.panel} data-kind="server-updated">
          <div className={styles.header}>
            <span className={styles.icon} aria-hidden>
              ↻
            </span>
            <span className={styles.title} id={titleId}>
              New version available
            </span>
          </div>
          <p className={styles.body}>
            The server has been updated with improvements and fixes. Refresh the page
            to load the latest version — your current view may be running on stale data.
          </p>
          <div className={styles.actions}>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={reload}>
              Refresh now
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (notice.kind === 'idle-warning') {
    const remaining = (notice.autoLogoutAtMs ?? now) - now;
    return (
      <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.panel} data-kind="idle-warning">
          <div className={styles.header}>
            <span className={styles.icon} aria-hidden>
              ⏱
            </span>
            <span className={styles.title} id={titleId}>
              Session about to expire
            </span>
          </div>
          <p className={styles.body}>
            Your session has been inactive for a while. To keep resources available
            for active users, you will be logged out automatically.
          </p>
          <div className={styles.countdown}>
            <span>Auto-logout in</span>
            <span className={styles.countdownValue}>{formatCountdown(remaining)}</span>
          </div>
          <div className={styles.actions}>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={extendSession}>
              Stay active
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className={styles.panel} data-kind="idle-logout">
        <div className={styles.header}>
          <span className={styles.icon} aria-hidden>
            ⏻
          </span>
          <span className={styles.title} id={titleId}>
            Logged out for inactivity
          </span>
        </div>
        <p className={styles.body}>
          Your session was ended after 10 minutes of inactivity. Idle sessions are
          released to keep live market data responsive for active users. Reload the
          page to start a new session.
        </p>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={reload}>
            Reconnect
          </button>
        </div>
      </div>
    </div>
  );
}
