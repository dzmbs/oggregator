import { useEffect, useRef } from 'react';

import { useAppStore } from '@stores/app-store';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';
const POLL_INTERVAL_MS = 30_000;

interface HealthResponse {
  bootTime?: number;
  version?: string;
}

function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

/**
 * Polls /api/health and raises a 'server-updated' session notice when the
 * server's bootTime changes after the first successful observation. A bootTime
 * change means the server restarted and may be running new code — the client
 * bundle could be stale.
 */
export function useServerVersion() {
  const setSessionNotice = useAppStore((s) => s.setSessionNotice);
  const currentNoticeKind = useAppStore((s) => s.sessionNotice?.kind);
  const initialBootRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const { signal, cleanup } = createTimeoutSignal(5000);
      try {
        const res = await fetch(`${API_BASE}/health`, {
          signal,
        });
        if (!res.ok) throw new Error(`health ${res.status}`);
        const body = (await res.json()) as HealthResponse;
        if (cancelled) return;

        if (typeof body.bootTime === 'number') {
          if (initialBootRef.current === null) {
            initialBootRef.current = body.bootTime;
          } else if (
            body.bootTime !== initialBootRef.current &&
            currentNoticeKind !== 'server-updated'
          ) {
            setSessionNotice({ kind: 'server-updated' });
          }
        }
      } catch {
        // Silent — transient network errors during server restart are expected.
      } finally {
        cleanup();
        if (!cancelled) {
          timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [setSessionNotice, currentNoticeKind]);
}
