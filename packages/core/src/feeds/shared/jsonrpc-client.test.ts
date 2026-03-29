import { describe, expect, it, vi } from 'vitest';
import { JsonRpcWsClient } from './jsonrpc-client.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

type JsonRpcWsClientInternals = {
  call: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  subscribedChannels: Set<string>;
  reconnectAttempts: number;
  scheduleReconnect: () => void;
  connect: () => Promise<void>;
  startHeartbeat: () => void;
  cleanup: () => void;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
};

describe('JsonRpcWsClient', () => {
  it('keeps intended subscriptions for replay when the connection drops mid-subscribe', async () => {
    const client = new JsonRpcWsClient('ws://localhost:1234', 'test');
    const internals = client as unknown as JsonRpcWsClientInternals;

    internals.call = vi.fn(async () => {
      throw new Error('[test] connection closed');
    });

    await expect(client.subscribe(['ticker.BTC-1.raw'])).rejects.toThrow('connection closed');
    expect([...internals.subscribedChannels]).toEqual(['ticker.BTC-1.raw']);
  });

  it('rolls back optimistic subscriptions on definite RPC failures', async () => {
    const client = new JsonRpcWsClient('ws://localhost:1234', 'test');
    const internals = client as unknown as JsonRpcWsClientInternals;

    internals.call = vi.fn(async () => {
      throw new Error('[test] RPC error 10000: invalid channel');
    });

    await expect(client.subscribe(['ticker.BTC-1.raw'])).rejects.toThrow('invalid channel');
    expect([...internals.subscribedChannels]).toEqual([]);
  });

  it('keeps retrying after the max reconnect attempt budget is exceeded', () => {
    vi.useFakeTimers();

    const client = new JsonRpcWsClient('ws://localhost:1234', 'test', {
      maxReconnectAttempts: 1,
    });
    const internals = client as unknown as JsonRpcWsClientInternals;
    const connect = vi.fn(async () => {});

    internals.connect = connect;
    internals.reconnectAttempts = 1;
    internals.scheduleReconnect();

    vi.advanceTimersByTime(60_000);

    expect(connect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not install a fallback ping timer after cleanup cancels heartbeat setup', async () => {
    vi.useFakeTimers();

    const heartbeatCall = deferred<unknown>();
    const client = new JsonRpcWsClient('ws://localhost:1234', 'test');
    const internals = client as unknown as JsonRpcWsClientInternals;

    internals.call = vi.fn(() => heartbeatCall.promise);
    internals.startHeartbeat();
    internals.cleanup();
    heartbeatCall.reject(new Error('connection closed'));
    await Promise.resolve();
    await Promise.resolve();

    expect(internals.heartbeatTimer).toBeNull();
    vi.useRealTimers();
  });
});
