import type { WsSubscriptionRequest } from '../../core/types.js';
import { ChainRuntime, type ChainRuntimeOptions } from './chain-runtime.js';

const RUNTIME_IDLE_TTL_MS = 15 * 60 * 1000;
const RUNTIME_CLEANUP_INTERVAL_MS = 60 * 1000;

interface ChainRuntimeEntry {
  runtime: ChainRuntime;
  refCount: number;
  lastUsedAt: number;
}

function normalizeVenues(venues: WsSubscriptionRequest['venues']): WsSubscriptionRequest['venues'] {
  return [...venues].sort();
}

function runtimeKey(request: WsSubscriptionRequest): string {
  return `${request.underlying}:${request.expiry}:${normalizeVenues(request.venues).join(',')}`;
}

export class ChainRuntimeRegistry {
  private readonly entries = new Map<string, ChainRuntimeEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: ChainRuntimeOptions = {}) {}

  start(): void {
    if (this.cleanupTimer != null) return;
    this.cleanupTimer = setInterval(() => {
      void this.cleanup();
    }, RUNTIME_CLEANUP_INTERVAL_MS);
  }

  async acquire(request: WsSubscriptionRequest): Promise<{
    runtime: ChainRuntime;
    release(): Promise<void>;
  }> {
    const normalizedRequest: WsSubscriptionRequest = {
      ...request,
      venues: normalizeVenues(request.venues),
    };
    const key = runtimeKey(normalizedRequest);
    let entry = this.entries.get(key);

    if (entry == null) {
      entry = {
        runtime: new ChainRuntime(key, normalizedRequest, this.options),
        refCount: 0,
        lastUsedAt: Date.now(),
      };
      this.entries.set(key, entry);
    }

    entry.refCount += 1;
    entry.lastUsedAt = Date.now();
    await entry.runtime.ready();

    let released = false;

    return {
      runtime: entry.runtime,
      release: async () => {
        if (released) return;
        released = true;
        const current = this.entries.get(key);
        if (current == null) return;
        current.refCount = Math.max(0, current.refCount - 1);
        current.lastUsedAt = Date.now();
      },
    };
  }

  async dispose(): Promise<void> {
    if (this.cleanupTimer != null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.allSettled(entries.map(async (entry) => entry.runtime.dispose()));
  }

  private async cleanup(): Promise<void> {
    const cutoff = Date.now() - RUNTIME_IDLE_TTL_MS;
    const staleEntries = [...this.entries.entries()].filter(
      ([, entry]) => entry.refCount === 0 && entry.lastUsedAt < cutoff,
    );

    for (const [key, entry] of staleEntries) {
      this.entries.delete(key);
      await entry.runtime.dispose();
    }
  }
}
