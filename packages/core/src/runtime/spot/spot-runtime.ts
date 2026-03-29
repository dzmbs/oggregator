import { z } from 'zod';
import { BYBIT_REST_BASE_URL, BYBIT_TICKERS } from '../../feeds/shared/endpoints.js';
import { feedLogger } from '../../utils/logger.js';

const log = feedLogger('spot-runtime');
const DEFAULT_POLL_INTERVAL_MS = 60_000;

export interface SpotSnapshot {
  symbol: string;
  lastPrice: number;
  prevPrice24h: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  updatedAt: number;
}

export interface SpotRuntimeHealth {
  connected: boolean;
  symbols: string[];
  lastSuccessAt: number | null;
  lastStatusAt: number | null;
  errors: number;
}

export interface SpotRuntimeSnapshotEvent {
  type: 'snapshot';
  snapshot: SpotSnapshot;
}

export type SpotRuntimeEvent = SpotRuntimeSnapshotEvent;

export interface SpotRuntimeListener {
  onEvent(event: SpotRuntimeEvent): void;
}

export interface SpotRuntimeOptions {
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
  log?: {
    warn: (obj: object, msg: string) => void;
  };
}

const BybitSpotTickerSchema = z.object({
  retCode: z.number(),
  result: z.object({
    list: z.array(z.object({
      lastPrice: z.string(),
      prevPrice24h: z.string(),
      price24hPcnt: z.string(),
      highPrice24h: z.string(),
      lowPrice24h: z.string(),
    })),
  }),
});

export class SpotRuntime {
  private readonly snapshots = new Map<string, SpotSnapshot>();
  private readonly listeners = new Set<SpotRuntimeListener>();
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly runtimeLog: { warn: (obj: object, msg: string) => void };
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private symbols: string[] = [];
  private started = false;
  private health: SpotRuntimeHealth = {
    connected: false,
    symbols: [],
    lastSuccessAt: null,
    lastStatusAt: null,
    errors: 0,
  };

  constructor(options: SpotRuntimeOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.runtimeLog = options.log ?? log;
  }

  async start(symbols: string[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']): Promise<void> {
    this.symbols = [...symbols];
    this.health.symbols = [...symbols];

    await this.poll();

    if (this.started) return;
    this.started = true;
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  subscribe(listener: SpotRuntimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(baseOrSymbol: string): SpotSnapshot | null {
    const symbol = baseOrSymbol.endsWith('USDT') ? baseOrSymbol : `${baseOrSymbol}USDT`;
    return this.snapshots.get(symbol) ?? null;
  }

  getAllSnapshots(): SpotSnapshot[] {
    return [...this.snapshots.values()];
  }

  getHealth(): SpotRuntimeHealth {
    return {
      ...this.health,
      symbols: [...this.health.symbols],
    };
  }

  dispose(): void {
    if (this.pollTimer != null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.started = false;
  }

  private async poll(): Promise<void> {
    let sawSuccess = false;

    for (const symbol of this.symbols) {
      try {
        const response = await this.fetchImpl(`${BYBIT_REST_BASE_URL}${BYBIT_TICKERS}?category=spot&symbol=${symbol}`);
        if (!response.ok) {
          this.runtimeLog.warn({ symbol, status: response.status }, 'spot fetch failed');
          continue;
        }

        const parsed = BybitSpotTickerSchema.safeParse(await response.json());
        if (!parsed.success) {
          this.runtimeLog.warn({ symbol }, 'spot ticker validation failed');
          continue;
        }
        if (parsed.data.retCode !== 0) continue;

        const item = parsed.data.result.list[0];
        if (item == null) continue;

        sawSuccess = true;
        const snapshot: SpotSnapshot = {
          symbol,
          lastPrice: Number(item.lastPrice),
          prevPrice24h: Number(item.prevPrice24h),
          change24hPct: Number(item.price24hPcnt),
          high24h: Number(item.highPrice24h),
          low24h: Number(item.lowPrice24h),
          updatedAt: Date.now(),
        };

        this.snapshots.set(symbol, snapshot);
        this.broadcast({ type: 'snapshot', snapshot });
      } catch (error: unknown) {
        this.health.errors += 1;
        this.health.lastStatusAt = Date.now();
        this.runtimeLog.warn({ symbol, err: String(error) }, 'spot fetch error');
      }
    }

    if (sawSuccess) {
      this.health.connected = true;
      this.health.lastSuccessAt = Date.now();
      this.health.lastStatusAt = Date.now();
    }
  }

  private broadcast(event: SpotRuntimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener.onEvent(event);
      } catch {
        continue;
      }
    }
  }
}
