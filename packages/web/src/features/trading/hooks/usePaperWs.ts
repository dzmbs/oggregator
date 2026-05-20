import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PaperWsServerMessage } from '@oggregator/protocol';

import { wsUrl } from '@lib/http';

import { QKEY } from './queries';

type PaperConnectionState = 'connecting' | 'live' | 'closed' | 'error';

const BASE_DELAY = 1_500;
const MAX_RETRIES = 5;

export function usePaperWs(enabled = true): PaperConnectionState {
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTradeRefreshRef = useRef(0);
  const retryCountRef = useRef(0);
  const [state, setState] = useState<PaperConnectionState>('closed');

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const apiKey = localStorage.getItem('paperApiKey');
      const apiKeyParam = apiKey ? `?apiKey=${encodeURIComponent(apiKey)}` : '';
      const envWsBase = import.meta.env.VITE_WS_URL;
      const paperWsUrl = envWsBase
        ? `${envWsBase.replace(/\/$/, '')}/ws/paper${apiKeyParam}`
        : `${wsUrl('/ws/paper')}${apiKeyParam}`;
      const ws = new WebSocket(paperWsUrl);
      wsRef.current = ws;
      setState('connecting');

      ws.onopen = () => {
        retryCountRef.current = 0;
        setState('live');
      };

      ws.onmessage = (event) => {
        let message: PaperWsServerMessage | null = null;
        try {
          message = JSON.parse(event.data as string) as PaperWsServerMessage;
        } catch {
          return;
        }
        if (!message) return;

        switch (message.type) {
          case 'positions':
            qc.setQueryData(QKEY.positions, { positions: message.positions });
            break;
          case 'pnl':
            qc.setQueryData(QKEY.pnl, message.pnl);
            qc.invalidateQueries({ queryKey: QKEY.overview });
            if (Date.now() - lastTradeRefreshRef.current >= 5_000) {
              lastTradeRefreshRef.current = Date.now();
              qc.invalidateQueries({ queryKey: QKEY.trades });
              qc.invalidateQueries({ queryKey: QKEY.trade });
            }
            break;
          case 'order':
            qc.invalidateQueries({ queryKey: QKEY.orders });
            qc.invalidateQueries({ queryKey: QKEY.fills });
            qc.invalidateQueries({ queryKey: QKEY.trades });
            qc.invalidateQueries({ queryKey: QKEY.activity });
            qc.invalidateQueries({ queryKey: QKEY.overview });
            break;
          case 'trade':
            qc.setQueryData([...QKEY.trade, message.trade.id], message.trade);
            qc.invalidateQueries({ queryKey: QKEY.trades });
            qc.invalidateQueries({ queryKey: QKEY.activity });
            qc.invalidateQueries({ queryKey: QKEY.overview });
            break;
          case 'activity':
            qc.invalidateQueries({ queryKey: QKEY.activity });
            break;
          case 'hello':
            break;
          case 'error':
            setState('error');
            break;
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (disposed) {
          setState('closed');
          return;
        }
        retryCountRef.current++;
        if (retryCountRef.current > MAX_RETRIES) {
          setState('error');
          return;
        }
        const delay = Math.min(BASE_DELAY * Math.pow(2, retryCountRef.current - 1), 30_000);
        setState('connecting');
        reconnectRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        setState('error');
      };
    };

    connect();

    return () => {
      disposed = true;
      retryCountRef.current = 0;
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close(1000, 'unmount');
        wsRef.current = null;
      }
      setState('closed');
    };
  }, [enabled, qc]);

  return state;
}
