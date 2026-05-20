import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NewsRuntime } from './news-service.js';

function makeTweet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    text: 'BREAKING: Fed pauses rate hikes',
    url: 'https://x.com/zerohedge/status/1',
    source: 'Twitter[breaking-news] - @zerohedge',
    handle: 'zerohedge',
    ruleTag: 'breaking-news',
    timestamp: 1_700_000_000_000,
    classification: 'GOOD' as const,
    createdAt: '2024-11-14T22:13:20.000Z',
    ...overrides,
  };
}

function mockFetch(payload: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

describe('NewsRuntime', () => {
  let runtime: NewsRuntime;

  beforeEach(() => {
    vi.useRealTimers();
  });

  it('fetches, filters to GOOD, and caches', async () => {
    const good = makeTweet({ id: 'g1' });
    const bad = makeTweet({ id: 'b1', classification: 'BAD' });
    const fetchImpl = mockFetch({ count: 2, tweets: [good, bad] });

    runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl,
      pollIntervalMs: 60_000,
    });
    await runtime.start();
    runtime.dispose();

    expect(runtime.isReady()).toBe(true);
    const items = runtime.getItems();
    expect(items.map((i) => i.id)).toEqual(['g1']);
    expect(items[0]!.classification).toBe('GOOD');
  });

  it('puts secret in URL path on first call (no since)', async () => {
    const fetchImpl = mockFetch({ count: 0, tweets: [] });
    runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl,
      pollIntervalMs: 60_000,
    });
    await runtime.start();
    runtime.dispose();

    const called = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls[0]![0];
    expect(called).toContain('/feed/SECRET/twitter');
    expect(called).toContain('limit=50');
    expect(called).not.toContain('since=');
  });

  it('passes since on subsequent calls', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) {
        return new Response(JSON.stringify({ count: 1, tweets: [makeTweet({ timestamp: 1_700_000_500_000 })] }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ count: 0, tweets: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl,
      pollIntervalMs: 60_000,
    });
    await runtime.start();
    await (runtime as unknown as { poll: () => Promise<void> }).poll();
    runtime.dispose();

    const secondCallUrl = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls[1]![0];
    expect(secondCallUrl).toContain('since=2023-11-14T22%3A21%3A40.000Z');
  });

  it('keeps cache on upstream failure and increments errors', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) {
        return new Response(JSON.stringify({ count: 1, tweets: [makeTweet({ id: 'g1' })] }), { status: 200 });
      }
      return new Response('err', { status: 500 });
    }) as unknown as typeof fetch;

    runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl,
      pollIntervalMs: 60_000,
    });
    await runtime.start();
    await (runtime as unknown as { poll: () => Promise<void> }).poll();
    runtime.dispose();

    expect(runtime.errors).toBe(1);
    expect(runtime.getItems().map((i) => i.id)).toEqual(['g1']);
  });

  it('caps cache at cacheCap', async () => {
    const tweets = Array.from({ length: 10 }, (_, i) =>
      makeTweet({ id: `g${i}`, timestamp: 1_700_000_000_000 + i }),
    );
    const fetchImpl = mockFetch({ count: tweets.length, tweets });

    runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl,
      cacheCap: 3,
      pollIntervalMs: 60_000,
    });
    await runtime.start();
    runtime.dispose();

    const items = runtime.getItems();
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id)).toEqual(['g9', 'g8', 'g7']);
  });

  it('filters items by since param', async () => {
    const tweets = [
      makeTweet({ id: 'old', timestamp: 1_700_000_000_000 }),
      makeTweet({ id: 'new', timestamp: 1_700_000_100_000 }),
    ];
    const fetchImpl = mockFetch({ count: 2, tweets });

    runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl,
      pollIntervalMs: 60_000,
    });
    await runtime.start();
    runtime.dispose();

    expect(runtime.getItems({ since: 1_700_000_050_000 }).map((i) => i.id)).toEqual(['new']);
  });
});
