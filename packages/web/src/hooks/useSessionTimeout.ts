import { useEffect, useRef } from 'react';

import { useAppStore } from '@stores/app-store';

const IDLE_LOGOUT_MS = 10 * 60 * 1000;
const IDLE_WARNING_MS = 9 * 60 * 1000;

/**
 * Tracks how long the tab has been hidden or unfocused, then escalates:
 *   9 minutes  → idle-warning notice (with 60s countdown)
 *   10 minutes → clears paper-trading auth + idle-logout notice
 *
 * Applies to every user (paper-trading and anonymous) to curb idle public
 * sessions. Timers start on `visibilitychange → hidden` and are cancelled when
 * the tab becomes visible again before the warning threshold — or by the user
 * clicking "Stay active" on the warning, which bumps `sessionExtendToken`.
 */
export function useSessionTimeout() {
  const setSessionNotice = useAppStore((s) => s.setSessionNotice);
  const clearAuth = useAppStore((s) => s.clearAuth);
  const extendToken = useAppStore((s) => s.sessionExtendToken);

  // Refs avoid re-running the effect on every store change.
  const setSessionNoticeRef = useRef(setSessionNotice);
  const clearAuthRef = useRef(clearAuth);
  setSessionNoticeRef.current = setSessionNotice;
  clearAuthRef.current = clearAuth;

  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    const clearTimers = () => {
      if (warningTimerRef.current !== null) {
        clearTimeout(warningTimerRef.current);
        warningTimerRef.current = null;
      }
      if (logoutTimerRef.current !== null) {
        clearTimeout(logoutTimerRef.current);
        logoutTimerRef.current = null;
      }
    };

    const fireWarning = () => {
      warningTimerRef.current = null;
      const autoLogoutAtMs = (hiddenAtRef.current ?? Date.now()) + IDLE_LOGOUT_MS;
      setSessionNoticeRef.current({ kind: 'idle-warning', autoLogoutAtMs });
    };

    const fireLogout = () => {
      logoutTimerRef.current = null;
      clearAuthRef.current();
      setSessionNoticeRef.current({ kind: 'idle-logout' });
    };

    const onHidden = () => {
      if (hiddenAtRef.current !== null) return;
      hiddenAtRef.current = Date.now();
      clearTimers();
      warningTimerRef.current = setTimeout(fireWarning, IDLE_WARNING_MS);
      logoutTimerRef.current = setTimeout(fireLogout, IDLE_LOGOUT_MS);
    };

    const onVisible = () => {
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt === null) return;
      const elapsed = Date.now() - hiddenAt;
      // Returned before the warning threshold — silent reset. Past it, leave
      // timers running so the already-fired warning or pending logout is
      // visible to the user when they re-engage.
      if (elapsed < IDLE_WARNING_MS) {
        clearTimers();
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) onHidden();
      else onVisible();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onHidden);
    window.addEventListener('focus', onVisible);

    if (document.hidden) onHidden();

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onHidden);
      window.removeEventListener('focus', onVisible);
      clearTimers();
    };
  }, []);

  useEffect(() => {
    if (extendToken === 0) return;
    if (warningTimerRef.current !== null) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    if (logoutTimerRef.current !== null) {
      clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
    hiddenAtRef.current = null;
    setSessionNoticeRef.current(null);
  }, [extendToken]);
}
