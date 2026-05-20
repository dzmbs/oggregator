import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpotCandleService } from './spot-candles.js';

function makeKlinesPayload(closes: number[]): unknown {
  const ticks = closes.map((_, i) => 1_700_000_000_000 + i * 60_000);
  return {
    result: {
      status: 'ok',
      ticks,
      open: closes,
      high: closes,
      low: closes,
      close: closes,
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SpotCandleService — stale fallback on upstream failure', () => {
  let svc: SpotCandleService;
  const fetchSpy = vi.fn();

  beforeEach(() => {
    svc = new SpotCandleService();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockReset();
  });
  afterEach(() => {
    svc.dispose();
    vi.unstubAllGlobals();
  });

  it('serves cached candles past TTL when the next upstream fetch fails', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(makeKlinesPayload([100, 101, 102])))
      .mockRejectedValueOnce(new Error('Deribit 502'));

    // First call populates the cache.
    const first = await svc.getCandles('BTC', 3600, 24);
    expect(first).toHaveLength(3);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Force the cache entry to look expired so the next call must hit the
    // network. The fetch is mocked to fail — we expect the service to fall
    // back to the cached payload instead of throwing.
    const cache = (svc as unknown as { cache: Map<string, { fetchedAt: number; candles: unknown[] }> }).cache;
    const key = 'BTC|3600|24';
    const entry = cache.get(key)!;
    cache.set(key, { ...entry, fetchedAt: Date.now() - 120_000 });

    const stale = await svc.getCandles('BTC', 3600, 24);
    expect(stale).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws when upstream fails and the cache is cold', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Deribit 502'));

    await expect(svc.getCandles('BTC', 3600, 24)).rejects.toThrow('Deribit 502');
  });
});
