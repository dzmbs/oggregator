import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpotRuntime } from './spot-runtime.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function okResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

describe('SpotRuntime', () => {
  it('polls snapshots and stores them by symbol and base', async () => {
    const runtime = new SpotRuntime({
      fetchImpl: vi.fn(async () =>
        okResponse({
          retCode: 0,
          result: {
            list: [
              {
                lastPrice: '70000',
                prevPrice24h: '69000',
                price24hPcnt: '0.01449',
                highPrice24h: '71000',
                lowPrice24h: '68000',
              },
            ],
          },
        }),
      ),
    });

    await runtime.start(['BTCUSDT']);

    expect(runtime.getSnapshot('BTCUSDT')?.lastPrice).toBe(70000);
    expect(runtime.getSnapshot('BTC')?.lastPrice).toBe(70000);
    expect(runtime.getHealth().connected).toBe(true);

    runtime.dispose();
  });

  it('emits snapshot events to listeners', async () => {
    const listener = vi.fn();
    const runtime = new SpotRuntime({
      fetchImpl: vi.fn(async () =>
        okResponse({
          retCode: 0,
          result: {
            list: [
              {
                lastPrice: '2000',
                prevPrice24h: '1950',
                price24hPcnt: '0.02564',
                highPrice24h: '2050',
                lowPrice24h: '1900',
              },
            ],
          },
        }),
      ),
    });

    runtime.subscribe({ onEvent: listener });
    await runtime.start(['ETHUSDT']);

    expect(listener).toHaveBeenCalledWith({
      type: 'snapshot',
      snapshot: expect.objectContaining({ symbol: 'ETHUSDT', lastPrice: 2000 }),
    });

    runtime.dispose();
  });

  it('keeps polling on an interval until disposed', async () => {
    vi.useFakeTimers();

    const fetchImpl = vi.fn(async () =>
      okResponse({
        retCode: 0,
        result: {
          list: [
            {
              lastPrice: '100',
              prevPrice24h: '90',
              price24hPcnt: '0.1111',
              highPrice24h: '110',
              lowPrice24h: '80',
            },
          ],
        },
      }),
    );

    const runtime = new SpotRuntime({ fetchImpl, pollIntervalMs: 1_000 });
    await runtime.start(['SOLUSDT']);

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    runtime.dispose();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
