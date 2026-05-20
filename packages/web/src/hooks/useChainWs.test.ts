/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { chainKeys } from '@features/chain/queries';
import type { ServerWsMessage } from '@oggregator/protocol';

// ── Mock WebSocket — must be set up before hook import ────────

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;

  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }

  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }

  pushMessage(msg: ServerWsMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}

// Stub before importing the hook so it captures our mock
vi.stubGlobal('WebSocket', MockWebSocket);

// Dynamic import after stub
const { useChainWs } = await import('./useChainWs');

// ── Test setup ────────────────────────────────────────────────

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.reset();

  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Helpers ───────────────────────────────────────────────────

function snapshot(subId: string, seq: number, underlying = 'BTC'): ServerWsMessage {
  return {
    type: 'snapshot',
    subscriptionId: subId,
    seq,
    request: { underlying, expiry: '2026-03-27', venues: ['deribit'] },
    meta: { generatedAt: Date.now(), maxQuoteTs: Date.now() - 50, staleMs: 50 },
    data: {
      underlying,
      expiry: '2026-03-27',
      expiryTs: null,
      dte: 7,
      stats: {
        forwardPriceUsd: 70_500,
        indexPriceUsd: 70_500,
        basisPct: 0,
        atmStrike: 70_000,
        atmIv: 0.5,
        putCallOiRatio: 1,
        totalOiUsd: 1,
        skew25d: 0,
        bfly25d: 0,
      },
      strikes: [],
      gex: [],
    },
  };
}

function subscribedMsg(
  subId: string,
  failed?: Array<{ venue: 'binance'; reason: string }>,
): ServerWsMessage {
  return {
    type: 'subscribed',
    subscriptionId: subId,
    request: { underlying: 'BTC', expiry: '2026-03-27', venues: ['deribit'] },
    serverTime: Date.now(),
    failedVenues: failed,
  };
}

function deltaMsg(subId: string, seq: number): ServerWsMessage {
  return {
    type: 'delta',
    subscriptionId: subId,
    seq,
    request: { underlying: 'BTC', expiry: '2026-03-27', venues: ['deribit'] },
    meta: { generatedAt: Date.now(), maxQuoteTs: Date.now() - 25, staleMs: 25 },
    deltas: [{ venue: 'deribit', symbol: 'BTC/USD:USDC-260327-70000-C', ts: Date.now() }],
    patch: {
      stats: {
        forwardPriceUsd: 70500,
        indexPriceUsd: 70500,
        basisPct: 0,
        atmStrike: 70000,
        atmIv: 0.51,
        putCallOiRatio: 1,
        totalOiUsd: 1,
        skew25d: 0,
        bfly25d: 0,
      },
      strikes: [
        {
          strike: 70000,
          call: { venues: {}, bestIv: 0.51, bestVenue: 'deribit' },
          put: { venues: {}, bestIv: null, bestVenue: null },
        },
      ],
      gex: [{ strike: 70000, gexUsdMillions: 12 }],
    },
  };
}

function statusMsg(subId: string, state: 'connected' | 'reconnecting' | 'down'): ServerWsMessage {
  return {
    type: 'status',
    subscriptionId: subId,
    venue: 'deribit',
    state,
    ts: Date.now(),
  };
}

function getLastWs(): MockWebSocket {
  const ws = MockWebSocket.instances.at(-1);
  if (!ws) throw new Error('no WebSocket created');
  return ws;
}

/** Render hook and wait for WS to connect + send subscribe */
async function renderAndConnect(
  props = { underlying: 'BTC', expiry: '2026-03-27', venues: ['deribit'] },
) {
  const hookResult = renderHook(() => useChainWs(props), { wrapper });
  // Let useEffect fire and mock WS open via setTimeout
  await act(() => vi.advanceTimersByTimeAsync(50));
  const ws = getLastWs();
  const subId = (JSON.parse(ws.sent[0]!) as Record<string, unknown>)['subscriptionId'] as string;
  return { hookResult, ws, subId };
}

// ── Tests ─────────────────────────────────────────────────────

describe('useChainWs', () => {
  it('opens WebSocket and sends subscribe on connect', async () => {
    const { result } = renderHook(
      () => useChainWs({ underlying: 'BTC', expiry: '2026-03-27', venues: ['deribit'] }),
      { wrapper },
    );

    await act(() => vi.advanceTimersByTimeAsync(50));

    expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    const ws = getLastWs();
    expect(ws.sent).toHaveLength(1);

    const msg = JSON.parse(ws.sent[0]!) as Record<string, unknown>;
    expect(msg['type']).toBe('subscribe');
    expect(msg['subscriptionId']).toBeTruthy();
    expect(result.current.connectionState).not.toBe('closed');
  });

  it('sets connectionState to live on subscribed message', async () => {
    const { hookResult, ws, subId } = await renderAndConnect();
    await act(() => {
      ws.pushMessage(subscribedMsg(subId));
    });
    expect(hookResult.result.current.connectionState).toBe('live');
  });

  it('writes snapshot data into TanStack Query cache', async () => {
    const { hookResult, ws, subId } = await renderAndConnect();
    await act(() => {
      ws.pushMessage(snapshot(subId, 1));
    });

    const key = chainKeys.chain('BTC', '2026-03-27', ['deribit']);
    const cached = queryClient.getQueryData(key);
    expect(cached).toBeDefined();
    expect((cached as Record<string, unknown>)['underlying']).toBe('BTC');
    expect(hookResult.result.current.lastSeq).toBe(1);
  });

  it('ignores snapshot with stale subscriptionId', async () => {
    const { hookResult, ws } = await renderAndConnect();
    await act(() => {
      ws.pushMessage(snapshot('wrong-sub-id', 99));
    });

    expect(hookResult.result.current.lastSeq).toBe(0);
    const key = chainKeys.chain('BTC', '2026-03-27', ['deribit']);
    expect(queryClient.getQueryData(key)).toBeUndefined();
  });

  it('maps venue status to connectionState', async () => {
    const { hookResult, ws, subId } = await renderAndConnect();

    await act(() => {
      ws.pushMessage(statusMsg(subId, 'reconnecting'));
    });
    expect(hookResult.result.current.connectionState).toBe('reconnecting');

    await act(() => {
      ws.pushMessage(statusMsg(subId, 'down'));
    });
    expect(hookResult.result.current.connectionState).toBe('error');

    await act(() => {
      ws.pushMessage(snapshot(subId, 1));
    });
    expect(hookResult.result.current.connectionState).toBe('live');
  });

  it('merges delta patches into the cached chain', async () => {
    const { hookResult, ws, subId } = await renderAndConnect();

    await act(() => {
      ws.pushMessage(snapshot(subId, 1));
    });
    await act(() => {
      ws.pushMessage(deltaMsg(subId, 2));
    });
    // Deltas are coalesced per animation frame — advance past the rAF fallback timer.
    await act(() => vi.advanceTimersByTimeAsync(30));

    const key = chainKeys.chain('BTC', '2026-03-27', ['deribit']);
    const cached = queryClient.getQueryData(key) as Record<string, unknown> | undefined;
    expect(cached).toBeDefined();
    expect((cached?.['gex'] as Array<Record<string, unknown>>)[0]?.['gexUsdMillions']).toBe(12);
    expect(hookResult.result.current.lastSeq).toBe(2);
  });

  it('captures failedVenues from subscribed message', async () => {
    const { hookResult, ws, subId } = await renderAndConnect();
    await act(() => {
      ws.pushMessage(subscribedMsg(subId, [{ venue: 'binance', reason: 'geo-blocked' }]));
    });

    expect(hookResult.result.current.failedVenues).toHaveLength(1);
    expect(hookResult.result.current.failedVenues[0]!.venue).toBe('binance');
  });

  it('ignores invalid snapshot payloads that fail protocol validation', async () => {
    const { hookResult, ws, subId } = await renderAndConnect();
    await act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'snapshot',
          subscriptionId: subId,
          seq: 1,
          request: { underlying: 'BTC', expiry: '2026-03-27', venues: ['deribit'] },
          meta: { generatedAt: Date.now(), maxQuoteTs: Date.now(), staleMs: 0 },
          data: {
            underlying: 'BTC',
            expiry: '2026-03-27',
            dte: 7,
            stats: {},
            strikes: [],
            gex: [],
          },
        }),
      });
    });

    expect(hookResult.result.current.lastSeq).toBe(0);
  });

  it('does not connect when disabled', async () => {
    renderHook(
      () =>
        useChainWs({
          underlying: 'BTC',
          expiry: '2026-03-27',
          venues: ['deribit'],
          enabled: false,
        }),
      { wrapper },
    );
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('does not connect with empty expiry', async () => {
    renderHook(() => useChainWs({ underlying: 'BTC', expiry: '', venues: ['deribit'] }), {
      wrapper,
    });
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(MockWebSocket.instances).toHaveLength(0);
  });
});
