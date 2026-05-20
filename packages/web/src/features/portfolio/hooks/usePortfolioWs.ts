import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { PortfolioWsServerMessageSchema } from '@oggregator/protocol';

import { wsUrl } from '@lib/http';

import type { PortfolioSource } from '../api';
import { PORTFOLIO_QKEY } from './queries';

type ConnectionState = 'closed' | 'connecting' | 'open' | 'retrying';

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt + Math.random() * 500, 15_000);
}

export function usePortfolioWs(
  source: PortfolioSource = 'manual',
  underlying?: string,
): {
  connectionState: ConnectionState;
  lastSeq: number;
  lastError: { code: string; message: string } | null;
} {
  const qc = useQueryClient();
  const [connectionState, setConnectionState] = useState<ConnectionState>('closed');
  const [lastSeq, setLastSeq] = useState(0);
  const [lastError, setLastError] = useState<{ code: string; message: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    const open = () => {
      if (disposed) return;
      setConnectionState('connecting');
      let apiKey = '';
      try {
        apiKey = localStorage.getItem('paperApiKey') ?? '';
      } catch {}
      const params = new URLSearchParams();
      if (apiKey) params.set('apiKey', apiKey);
      params.set('source', source);
      if (underlying) params.set('underlying', underlying);
      const url = `${wsUrl('/ws/portfolio')}?${params.toString()}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        if (disposed) return;
        setConnectionState('open');
        retryRef.current = 0;
      });

      ws.addEventListener('message', (event) => {
        if (disposed) return;
        try {
          const parsed = PortfolioWsServerMessageSchema.safeParse(JSON.parse(event.data as string));
          if (!parsed.success) return;
          const msg = parsed.data;
          if (msg.type === 'snapshot') {
            qc.setQueryData(PORTFOLIO_QKEY.positions(source, underlying), {
              accountId: msg.metrics.accountId,
              source,
              positions: msg.positions,
            });
            qc.setQueryData(
              PORTFOLIO_QKEY.metrics(msg.metrics.forwardDays, source, underlying),
              {
                accountId: msg.metrics.accountId,
                source,
                metrics: msg.metrics,
                positions: msg.positions,
              },
            );
            setLastSeq(msg.seq);
            setLastError(null);
          } else if (msg.type === 'delta') {
            qc.setQueryData(
              PORTFOLIO_QKEY.metrics(msg.metrics.forwardDays, source, underlying),
              (prev: { positions?: unknown } | undefined) => ({
                accountId: msg.metrics.accountId,
                source,
                metrics: msg.metrics,
                positions: prev?.positions ?? [],
              }),
            );
            setLastSeq(msg.seq);
            setLastError(null);
          } else if (msg.type === 'error') {
            setLastError({ code: msg.code, message: msg.message });
            console.warn('[portfolio ws] error from server', msg);
          }
        } catch {}
      });

      ws.addEventListener('close', () => {
        if (disposed) return;
        wsRef.current = null;
        setConnectionState('retrying');
        const delay = backoffMs(retryRef.current);
        retryRef.current = Math.min(retryRef.current + 1, 5);
        setTimeout(open, delay);
      });

      ws.addEventListener('error', () => {
        ws.close();
      });
    };

    open();

    return () => {
      disposed = true;
      wsRef.current?.close();
      wsRef.current = null;
      setConnectionState('closed');
    };
  }, [qc, source, underlying]);

  return { connectionState, lastSeq, lastError };
}
