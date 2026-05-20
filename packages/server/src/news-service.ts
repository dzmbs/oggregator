import type { FastifyBaseLogger } from 'fastify';

interface RawTweet {
  id: string;
  text: string;
  url: string;
  source: string;
  handle?: string | null;
  ruleTag?: string | null;
  timestamp: number;
  classification?: 'GOOD' | 'BAD';
  createdAt?: string;
}

interface RawNewsResponse {
  count: number;
  tweets: RawTweet[];
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function parseNewsResponse(json: unknown): RawNewsResponse | null {
  if (typeof json !== 'object' || json === null) return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj['count'] !== 'number') return null;
  if (!Array.isArray(obj['tweets'])) return null;

  const tweets: RawTweet[] = [];
  for (const t of obj['tweets']) {
    if (typeof t !== 'object' || t === null) return null;
    const r = t as Record<string, unknown>;
    if (!isString(r['id']) || !isString(r['text']) || !isString(r['url']) || !isString(r['source'])) {
      return null;
    }
    if (typeof r['timestamp'] !== 'number') return null;
    const handle = r['handle'];
    const ruleTag = r['ruleTag'];
    const classification = r['classification'];
    const createdAt = r['createdAt'];
    const tweet: RawTweet = {
      id: r['id'],
      text: r['text'],
      url: r['url'],
      source: r['source'],
      timestamp: r['timestamp'],
    };
    if (handle === null || isString(handle)) tweet.handle = handle;
    if (ruleTag === null || isString(ruleTag)) tweet.ruleTag = ruleTag;
    if (classification === 'GOOD' || classification === 'BAD') tweet.classification = classification;
    if (isString(createdAt)) tweet.createdAt = createdAt;
    tweets.push(tweet);
  }
  return { count: obj['count'], tweets };
}

export interface NewsItem {
  id: string;
  text: string;
  url: string;
  source: string;
  handle: string | null;
  ruleTag: string | null;
  timestamp: number;
  classification: 'GOOD' | 'BAD';
  createdAt: string;
}

export interface NewsRuntimeOptions {
  baseUrl: string;
  secret: string;
  pollIntervalMs?: number;
  cacheCap?: number;
  fetchImpl?: typeof fetch;
  log?: FastifyBaseLogger | { warn: (...a: unknown[]) => void; info: (...a: unknown[]) => void };
}

const DEFAULT_POLL_MS = 15_000;
const DEFAULT_CACHE_CAP = 200;
const MAX_BACKOFF_MS = 60_000;

export class NewsRuntime {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly pollIntervalMs: number;
  private readonly cacheCap: number;
  private readonly fetchImpl: typeof fetch;
  private readonly log: NewsRuntimeOptions['log'];

  private items: NewsItem[] = [];
  private latestTs = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private backoffMs = 0;
  errors = 0;
  private lastSuccessAt: number | null = null;

  constructor(opts: NewsRuntimeOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.secret = opts.secret;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.cacheCap = opts.cacheCap ?? DEFAULT_CACHE_CAP;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.log;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.poll();
    this.scheduleNext();
  }

  dispose(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  isReady(): boolean {
    return this.lastSuccessAt !== null;
  }

  getItems({ limit, since }: { limit?: number; since?: number } = {}): NewsItem[] {
    const cap = Math.min(this.cacheCap, Math.max(1, limit ?? 50));
    let result = this.items;
    if (since !== undefined) {
      result = result.filter((i) => i.timestamp > since);
    }
    return result.slice(0, cap);
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    const delay = this.backoffMs > 0 ? this.backoffMs : this.pollIntervalMs;
    this.timer = setTimeout(() => {
      void this.poll().finally(() => this.scheduleNext());
    }, delay);
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    try {
      const url = new URL(`${this.baseUrl}/feed/${this.secret}/twitter`);
      url.searchParams.set('limit', '50');
      if (this.latestTs > 0) {
        url.searchParams.set('since', new Date(this.latestTs).toISOString());
      }

      const res = await this.fetchImpl(url.toString());
      if (!res.ok) {
        throw new Error(`upstream ${res.status}`);
      }
      const json = await res.json();
      const parsed = parseNewsResponse(json);
      if (!parsed) {
        throw new Error('bad payload shape');
      }

      const fresh: NewsItem[] = [];
      for (const t of parsed.tweets) {
        if (t.classification !== 'GOOD') continue;
        fresh.push({
          id: t.id,
          text: t.text,
          url: t.url,
          source: t.source,
          handle: t.handle ?? null,
          ruleTag: t.ruleTag ?? null,
          timestamp: t.timestamp,
          classification: 'GOOD',
          createdAt: t.createdAt ?? new Date(t.timestamp).toISOString(),
        });
        if (t.timestamp > this.latestTs) this.latestTs = t.timestamp;
      }

      if (fresh.length > 0) {
        const seen = new Set(this.items.map((i) => i.id));
        const dedup = fresh.filter((i) => !seen.has(i.id));
        const merged = [...dedup, ...this.items]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, this.cacheCap);
        this.items = merged;
      }

      this.backoffMs = 0;
      this.lastSuccessAt = Date.now();
    } catch (err: unknown) {
      this.errors++;
      this.backoffMs = this.backoffMs === 0 ? this.pollIntervalMs : Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.log?.warn?.({ err: String(err) }, 'news feed poll failed');
    }
  }
}

export function createNewsRuntimeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  log?: NewsRuntimeOptions['log'],
): NewsRuntime | null {
  const baseUrl = env['OP_FEED_BASE_URL'];
  const secret = env['OP_FEED_SECRET'];
  if (!baseUrl || !secret) return null;
  return new NewsRuntime(log ? { baseUrl, secret, log } : { baseUrl, secret });
}
