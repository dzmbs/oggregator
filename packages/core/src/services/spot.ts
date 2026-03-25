import { z } from 'zod';
import { BYBIT_REST_BASE_URL } from '../feeds/shared/endpoints.js';
import { feedLogger } from '../utils/logger.js';

const log = feedLogger('spot');

export interface SpotSnapshot {
  symbol: string;
  lastPrice: number;
  prevPrice24h: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  updatedAt: number;
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

/**
 * Polls Bybit spot tickers for 24h price change data.
 * Bybit returns `price24hPcnt` pre-calculated.
 */
export class SpotService {
  private snapshots = new Map<string, SpotSnapshot>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private symbols: string[] = [];

  async start(symbols: string[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']): Promise<void> {
    this.symbols = symbols;
    await this.poll();
    this.pollTimer = setInterval(() => {
      this.poll().catch((err: unknown) => {
        log.warn({ err: String(err) }, 'spot poll failed');
      });
    }, 60_000);
  }

  getSnapshot(base: string): SpotSnapshot | null {
    return this.snapshots.get(`${base}USDT`) ?? null;
  }

  getAllSnapshots(): SpotSnapshot[] {
    return [...this.snapshots.values()];
  }

  private async poll(): Promise<void> {
    for (const symbol of this.symbols) {
      try {
        const res = await fetch(`${BYBIT_REST_BASE_URL}/v5/market/tickers?category=spot&symbol=${symbol}`);
        if (!res.ok) { log.warn({ symbol, status: res.status }, 'spot fetch failed'); continue; }

        const parsed = BybitSpotTickerSchema.safeParse(await res.json());
        if (!parsed.success) { log.warn({ symbol }, 'spot ticker validation failed'); continue; }
        if (parsed.data.retCode !== 0) continue;

        const item = parsed.data.result.list[0];
        if (!item) continue;

        this.snapshots.set(symbol, {
          symbol,
          lastPrice: Number(item.lastPrice),
          prevPrice24h: Number(item.prevPrice24h),
          change24hPct: Number(item.price24hPcnt),
          high24h: Number(item.highPrice24h),
          low24h: Number(item.lowPrice24h),
          updatedAt: Date.now(),
        });
      } catch (err: unknown) {
        log.warn({ symbol, err: String(err) }, 'spot fetch error');
      }
    }

    log.info({ count: this.snapshots.size }, 'spot prices updated');
  }

  dispose(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }
}
