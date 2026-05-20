import { z } from 'zod';
import { DERIBIT_REST_BASE_URL } from '../feeds/shared/endpoints.js';
import { feedLogger } from '../utils/logger.js';

const log = feedLogger('spot-candles');

export type SpotCandleCurrency = 'BTC' | 'ETH';
export type SpotCandleResolutionSec = 60 | 300 | 1800 | 3600 | 14400 | 86400;

export interface SpotCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const ChartDataSchema = z.object({
  status: z.string(),
  ticks: z.array(z.number()),
  open: z.array(z.number()),
  high: z.array(z.number()),
  low: z.array(z.number()),
  close: z.array(z.number()),
});

const ResponseSchema = z.object({
  result: ChartDataSchema,
});

const RESOLUTION_TO_DERIBIT: Record<SpotCandleResolutionSec, string> = {
  60: '1',
  300: '5',
  1800: '30',
  3600: '60',
  14400: '240',
  86400: '1D',
};

interface CacheEntry {
  fetchedAt: number;
  candles: SpotCandle[];
}

/**
 * On-demand fetcher for Deribit perpetual klines used as a "spot proxy" for
 * BTC/ETH on the Builder V2 chart. Perp basis vs index is bps-scale; acceptable
 * for the 2-minute snapshot view. Deribit only lists BTC/ETH perps — SOL is
 * unsupported here and the caller must handle it as an empty result.
 */
export class SpotCandleService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 60_000;
  private ready = false;

  async start(): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  dispose(): void {
    this.ready = false;
    this.cache.clear();
  }

  async getCandles(
    currency: SpotCandleCurrency,
    resolutionSec: SpotCandleResolutionSec,
    buckets: number,
  ): Promise<SpotCandle[]> {
    const key = `${currency}|${resolutionSec}|${buckets}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
      return cached.candles;
    }

    try {
      const candles = await this.fetchFromDeribit(currency, resolutionSec, buckets);
      // Don't cache empty results: a transient Deribit error or schema drift
      // would otherwise lock every requester into "no data" for the full TTL.
      if (candles.length > 0) {
        this.cache.set(key, { fetchedAt: Date.now(), candles });
      }
      return candles;
    } catch (err) {
      // Upstream blew up. If we've ever served this key successfully, keep
      // serving the last good payload past TTL rather than 502'ing the
      // client — a slightly stale snapshot is far better UX than an error
      // banner during transient Deribit hiccups.
      if (cached) {
        log.warn(
          {
            currency,
            resolutionSec,
            buckets,
            ageMs: Date.now() - cached.fetchedAt,
            err: String(err),
          },
          'serving stale candles after upstream failure',
        );
        return cached.candles;
      }
      throw err;
    }
  }

  private async fetchFromDeribit(
    currency: SpotCandleCurrency,
    resolutionSec: SpotCandleResolutionSec,
    buckets: number,
  ): Promise<SpotCandle[]> {
    const end = Date.now();
    const start = end - resolutionSec * 1000 * buckets;
    const instrument = `${currency}-PERPETUAL`;
    const params = new URLSearchParams({
      instrument_name: instrument,
      start_timestamp: String(start),
      end_timestamp: String(end),
      resolution: RESOLUTION_TO_DERIBIT[resolutionSec],
    });

    const url = `${DERIBIT_REST_BASE_URL}/api/v2/public/get_tradingview_chart_data?${params}`;
    // 10s timeout matches the pattern used in trade/block-trade runtimes.
    // Without it, a hung Deribit connection blocks every client retry.
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`Deribit klines ${res.status}`);
    }

    const json: unknown = await res.json();
    const parsed = ResponseSchema.safeParse(json);
    if (!parsed.success) {
      log.warn({ currency, resolutionSec, issue: parsed.error.message }, 'klines parse failed');
      return [];
    }

    const { ticks, open, high, low, close } = parsed.data.result;
    const len = Math.min(ticks.length, open.length, high.length, low.length, close.length);
    const candles: SpotCandle[] = [];
    for (let i = 0; i < len; i++) {
      candles.push({
        timestamp: ticks[i]!,
        open: open[i]!,
        high: high[i]!,
        low: low[i]!,
        close: close[i]!,
      });
    }
    return candles;
  }
}
