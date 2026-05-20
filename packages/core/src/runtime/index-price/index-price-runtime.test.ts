import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexPriceRuntime } from './index-price-runtime.js';

describe('IndexPriceRuntime — Gate.io REST refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('populates prices for every underlying returned by /options/underlyings', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          { name: 'BTC_USDT', index_price: '77055.71' },
          { name: 'ETH_USDT', index_price: '2133.53' },
          { name: 'HYPE_USDT', index_price: '47.724' },
        ]),
        { status: 200 },
      ),
    );

    const runtime = new IndexPriceRuntime();
    await runtime.start({ gateio: true });
    // start() schedules the interval and fires once immediately via void —
    // flush microtasks so the response actually resolves.
    await vi.waitFor(() => {
      expect(runtime.get('gateio', 'BTC')).toBe(77055.71);
    });
    expect(runtime.get('gateio', 'ETH')).toBe(2133.53);
    expect(runtime.get('gateio', 'HYPE')).toBe(47.724);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    runtime.dispose();
  });

  it('aliases CL_USDT to XTI so trade events using the public name resolve', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([{ name: 'CL_USDT', index_price: '102.834' }]),
        { status: 200 },
      ),
    );

    const runtime = new IndexPriceRuntime();
    await runtime.start({ gateio: true });
    await vi.waitFor(() => {
      expect(runtime.get('gateio', 'XTI')).toBe(102.834);
    });
    // The raw venue base shouldn't leak — only the public name.
    expect(runtime.get('gateio', 'CL')).toBeNull();

    runtime.dispose();
  });

  it('skips entries with invalid index_price without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          { name: 'BTC_USDT', index_price: 'not-a-number' },
          { name: 'ETH_USDT' },
          { name: 'SOL_USDT', index_price: '85.0' },
        ]),
        { status: 200 },
      ),
    );

    const runtime = new IndexPriceRuntime();
    await runtime.start({ gateio: true });
    await vi.waitFor(() => {
      expect(runtime.get('gateio', 'SOL')).toBe(85.0);
    });
    expect(runtime.get('gateio', 'BTC')).toBeNull();
    expect(runtime.get('gateio', 'ETH')).toBeNull();

    runtime.dispose();
  });

  it('repeats the poll on the 30s cadence', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ name: 'BTC_USDT', index_price: '70000' }]), { status: 200 }),
    );

    const runtime = new IndexPriceRuntime();
    await runtime.start({ gateio: true });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(30 * 1000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    runtime.dispose();
  });

  it('does not start the Coincall WS subscription path when keys are missing', async () => {
    vi.stubEnv('COINCALL_API_KEY', '');
    vi.stubEnv('COINCALL_API_SECRET', '');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    const runtime = new IndexPriceRuntime();
    await runtime.start({ gateio: false, coincallUnderlyings: ['MNT', 'LIT'] });
    expect(runtime.get('coincall', 'MNT')).toBeNull();
    expect(runtime.get('coincall', 'LIT')).toBeNull();

    runtime.dispose();
  });

  it('dispose clears stored prices and the polling timer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ name: 'BTC_USDT', index_price: '70000' }]), { status: 200 }),
    );

    const runtime = new IndexPriceRuntime();
    await runtime.start({ gateio: true });
    await vi.waitFor(() => expect(runtime.get('gateio', 'BTC')).toBe(70_000));

    runtime.dispose();
    expect(runtime.get('gateio', 'BTC')).toBeNull();
  });
});
