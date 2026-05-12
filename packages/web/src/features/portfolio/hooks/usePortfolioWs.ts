import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { PortfolioWsServerMessageSchema } from '@oggregator/protocol';

import { PORTFOLIO_QKEY } from './queries';

type ConnectionState = 'closed' | 'connecting' | 'open' | 'retrying';

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt + Math.random() * 500, 15_000);
}

export function usePortfolioWs(_forwardDays: number): { connectionState: ConnectionState; lastSeq: number } {
  const qc = useQueryClient();
  const [connectionState, setConnectionState] = useState<ConnectionState>('closed');
  const [lastSeq, setLastSeq] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    const open = () => {
      if (disposed) return;
      setConnectionState('connecting');
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let apiKey = '';
      try {
        apiKey = localStorage.getItem('paperApiKey') ?? '';
      } catch (err) {
        console.error('localStorage access failed', err);
      }
      const url = `${proto}//${window.location.host}/ws/portfolio${apiKey ? `?apiKey=${encodeURIComponent(apiKey)}` : ''}`;
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
            qc.setQueryData(PORTFOLIO_QKEY.positions, {
              accountId: msg.metrics.accountId,
              positions: msg.positions,
            });
            qc.setQueryData(PORTFOLIO_QKEY.metrics(msg.metrics.forwardDays), {
              accountId: msg.metrics.accountId,
              metrics: msg.metrics,
              positions: msg.positions,
            });
            setLastSeq(msg.seq);
          } else if (msg.type === 'delta') {
            qc.setQueryData(PORTFOLIO_QKEY.metrics(msg.metrics.forwardDays), (prev: { positions?: unknown } | undefined) => ({
              accountId: msg.metrics.accountId,
              metrics: msg.metrics,
              positions: prev?.positions ?? [],
            }));
            setLastSeq(msg.seq);
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
  }, [qc]);

  return { connectionState, lastSeq };
}
