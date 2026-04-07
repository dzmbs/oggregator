import { z } from 'zod';
import { DERIBIT_WS_URL, DERIBIT_REST_BASE_URL } from '../feeds/shared/endpoints.js';
import { JsonRpcWsClient } from '../feeds/shared/jsonrpc-client.js';
import { feedLogger } from '../utils/logger.js';

const log = feedLogger('dvol');

// ── Types ─────────────────────────────────────────────────────

export interface DvolSnapshot {
  currency: string;
  /** Current DVOL as fraction (0.52 = 52%) */
  current: number;
  /** 52-week high as fraction */
  high52w: number;
  /** 52-week low as fraction */
  low52w: number;
  /** IV Rank: 0–100 percentile within 52-week range */
  ivr: number;
  /** Yesterday's close as fraction */
  previousClose: number;
  /** 1-day IV change as fraction (current − previousClose) */
  ivChange1d: number;
  updatedAt: number;
}

// DVOL candle: [timestamp, open, high, low, close]
const CandleSchema = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]);
const CandlesResultSchema = z.object({ data: z.array(CandleSchema) });

// TradingView chart data: { status, ticks, open, high, low, close, volume, cost }
const TvChartSchema = z.object({
  status: z.string(),
  ticks:  z.array(z.number()),
  close:  z.array(z.number()),
  // We only need ticks + close for RV; accept but ignore the rest
  open:   z.array(z.number()).optional(),
  high:   z.array(z.number()).optional(),
  low:    z.array(z.number()).optional(),
  volume: z.array(z.number()).optional(),
  cost:   z.array(z.number()).optional(),
}).passthrough();

// Live push: { index_name: "btc_usd", volatility: 53.48 }
const DvolPushSchema = z.object({
  index_name: z.string(),
  volatility: z.number(),
});

const RV_WINDOW = 30; // 30-day rolling window to match DVOL's 30-day ATM IV

/** Compute rolling realized vol from daily closes. Returns percentage values. */
function computeRealizedVol(
  timestamps: number[],
  closes: number[],
  window: number,
): HvPoint[] {
  if (closes.length < window + 1) return [];

  // Precompute daily log returns
  const logReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    logReturns.push(Math.log(closes[i]! / closes[i - 1]!));
  }

  const points: HvPoint[] = [];
  const sqrtAnnual = Math.sqrt(365);

  for (let i = window - 1; i < logReturns.length; i++) {
    // Mean of returns in window
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += logReturns[j]!;
    const mean = sum / window;

    // Variance (sample)
    let varSum = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const diff = logReturns[j]! - mean;
      varSum += diff * diff;
    }
    const stddev = Math.sqrt(varSum / (window - 1));
    const rv = stddev * sqrtAnnual * 100; // annualize and convert to percentage

    points.push({ timestamp: timestamps[i + 1]!, value: rv });
  }

  return points;
}

// ── Service ───────────────────────────────────────────────────

/**
 * Fetches Deribit DVOL (30-day ATM IV index) history and subscribes to
 * live updates. Computes IVR and 1-day IV change from the candle data.
 */
export interface DvolCandle {
  timestamp: number;
  open:  number;
  high:  number;
  low:   number;
  close: number;
}

export interface HvPoint {
  timestamp: number;
  value:     number;
}

export class DvolService {
  private snapshots = new Map<string, DvolSnapshot>();
  private candleHistory = new Map<string, DvolCandle[]>();
  private hvHistory = new Map<string, HvPoint[]>();
  private rpc: JsonRpcWsClient | null = null;
  private currencies: string[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  async start(currencies: string[] = ['BTC', 'ETH']): Promise<void> {
    this.currencies = currencies;

    this.rpc = new JsonRpcWsClient(DERIBIT_WS_URL, 'dvol', {
      heartbeatIntervalSec: 30,
    });

    this.rpc.onSubscription((_channel: string, data: unknown) => {
      this.handlePush(data);
    });

    await this.rpc.connect();

    await Promise.all(currencies.map(c => this.fetchHistory(c)));

    const channels = currencies.map(c => `deribit_volatility_index.${c.toLowerCase()}_usd`);
    await this.rpc.subscribe(channels);
    log.info({ currencies, channels: channels.length }, 'subscribed to DVOL');

    this.scheduleHistoryRefresh();

    // Fetch index candles for self-computed RV in the background — not on the critical path
    Promise.allSettled(currencies.map(c => this.fetchIndexCandles(c)))
      .catch(() => {});
  }

  getSnapshot(currency: string): DvolSnapshot | null {
    return this.snapshots.get(currency) ?? null;
  }

  getAllSnapshots(): DvolSnapshot[] {
    return [...this.snapshots.values()];
  }

  /** Daily DVOL candles (percentage values, e.g. 52.1 = 52.1% IV). */
  getHistory(currency: string): DvolCandle[] {
    return this.candleHistory.get(currency) ?? [];
  }

  /** Rolling 30-day realized volatility computed from daily index prices (percentage values). */
  getHv(currency: string): HvPoint[] {
    return this.hvHistory.get(currency) ?? [];
  }

  // ── History fetch ─────────────────────────────────────────────

  private async fetchHistory(currency: string): Promise<void> {
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;

    const raw = await this.rpc!.call('public/get_volatility_index_data', {
      currency,
      start_timestamp: oneYearAgo,
      end_timestamp: Date.now(),
      resolution: '1D',
    });

    const parsed = CandlesResultSchema.safeParse(raw);
    if (!parsed.success || parsed.data.data.length === 0) {
      log.warn({ currency }, 'no DVOL candles returned');
      return;
    }

    const candles = parsed.data.data;

    this.candleHistory.set(currency, candles.map(([ts, o, h, l, c]) => ({
      timestamp: ts, open: o, high: h, low: l, close: c,
    })));

    let high52w = -Infinity;
    let low52w = Infinity;
    for (const [, , h, l] of candles) {
      if (h > high52w) high52w = h;
      if (l < low52w) low52w = l;
    }

    const last = candles[candles.length - 1]!;
    const prev = candles.length >= 2 ? candles[candles.length - 2]! : last;

    this.snapshots.set(currency, this.buildSnapshot(
      currency, last[4], prev[4], high52w, low52w,
    ));

    log.info({
      currency,
      current: (last[4] / 100).toFixed(4),
      ivr: this.snapshots.get(currency)!.ivr.toFixed(1),
      candles: candles.length,
    }, 'DVOL history loaded');
  }

  private async fetchIndexCandles(currency: string): Promise<void> {
    try {
      const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
      const instrumentName = `${currency}-PERPETUAL`;
      const params = new URLSearchParams({
        instrument_name: instrumentName,
        start_timestamp: String(oneYearAgo),
        end_timestamp: String(Date.now()),
        resolution: '1D',
      });

      const url = `${DERIBIT_REST_BASE_URL}/api/v2/public/get_tradingview_chart_data?${params}`;
      const res = await fetch(url);
      if (!res.ok) {
        log.warn({ currency, status: res.status }, 'index candle REST fetch failed');
        return;
      }

      const json = await res.json() as { result?: unknown };
      const parsed = TvChartSchema.safeParse(json.result);
      if (!parsed.success || parsed.data.ticks.length === 0) {
        log.warn({ currency }, 'no index candles returned');
        return;
      }

      const { ticks, close } = parsed.data;
      const points = computeRealizedVol(ticks, close, RV_WINDOW);

      this.hvHistory.set(currency, points);
      log.info({ currency, candles: ticks.length, hvPoints: points.length }, 'RV computed from index candles');
    } catch (err: unknown) {
      log.warn({ currency, err: String(err) }, 'index candle fetch failed');
    }
  }

  // ── Live updates ──────────────────────────────────────────────

  private handlePush(data: unknown): void {
    const parsed = DvolPushSchema.safeParse(data);
    if (!parsed.success) return;

    const currency = parsed.data.index_name.split('_')[0]!.toUpperCase();
    const existing = this.snapshots.get(currency);
    if (!existing) return;

    // Rebuild snapshot with new current value, keeping 52w range and previous close
    const snapshot = this.buildSnapshot(
      currency,
      parsed.data.volatility,
      existing.previousClose * 100, // back to percentage for buildSnapshot
      existing.high52w * 100,
      existing.low52w * 100,
    );
    this.snapshots.set(currency, snapshot);
  }

  // ── Helpers ───────────────────────────────────────────────────

  /** All inputs in Deribit percentage format (53.48 = 53.48%). Output in fractions. */
  private buildSnapshot(
    currency: string,
    currentPct: number,
    previousClosePct: number,
    high52wPct: number,
    low52wPct: number,
  ): DvolSnapshot {
    const range = high52wPct - low52wPct;
    return {
      currency,
      current: currentPct / 100,
      high52w: high52wPct / 100,
      low52w: low52wPct / 100,
      ivr: range > 0 ? ((currentPct - low52wPct) / range) * 100 : 0,
      previousClose: previousClosePct / 100,
      ivChange1d: (currentPct - previousClosePct) / 100,
      updatedAt: Date.now(),
    };
  }

  /** Re-fetch history daily so previousClose, 52w range, and IVR stay correct. */
  private scheduleHistoryRefresh(): void {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
    nextMidnight.setUTCHours(0, 5, 0, 0); // 00:05 UTC — 5 min buffer for candle close
    const msUntil = nextMidnight.getTime() - now.getTime();

    this.refreshTimer = setTimeout(async () => {
      log.info('refreshing DVOL history (daily rollover)');
      await Promise.allSettled(
        this.currencies.map(async (currency) => {
          try { await this.fetchHistory(currency); }
          catch (err: unknown) { log.warn({ currency, err: String(err) }, 'DVOL refresh failed'); }
        }),
      );
      this.scheduleHistoryRefresh();
    }, msUntil);
  }

  dispose(): void {
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
    this.rpc?.disconnect();
    this.rpc = null;
  }
}
