import { z } from 'zod';
import { DERIBIT_WS_URL } from '../feeds/shared/endpoints.js';
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

// Live push: { index_name: "btc_usd", volatility: 53.48 }
const DvolPushSchema = z.object({
  index_name: z.string(),
  volatility: z.number(),
});

// ── Service ───────────────────────────────────────────────────

/**
 * Fetches Deribit DVOL (30-day ATM IV index) history and subscribes to
 * live updates. Computes IVR and 1-day IV change from the candle data.
 */
export interface DvolCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface HvPoint {
  timestamp: number;
  value: number;
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

    await Promise.all(currencies.map((c) => Promise.all([this.fetchHistory(c), this.fetchHv(c)])));

    const channels = currencies.map((c) => `deribit_volatility_index.${c.toLowerCase()}_usd`);
    await this.rpc.subscribe(channels, 'dvol');
    log.info({ currencies, channels: channels.length }, 'subscribed to DVOL');

    this.scheduleHistoryRefresh();
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

  /** Hourly realized volatility snapshots (percentage values). */
  getHv(currency: string): HvPoint[] {
    return this.hvHistory.get(currency) ?? [];
  }

  // ── History fetch ─────────────────────────────────────────────

  private async fetchHistory(currency: string): Promise<void> {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const oneYearAgo = now - 365 * MS_PER_DAY;
    const thirtyDaysAgo = now - 30 * MS_PER_DAY;

    // Daily for the 52-week IVR window, hourly for the recent overlap with HV.
    // Hourly matches Deribit HV's native 1h resolution so the chart's categorical
    // time axis spaces both series at the same cadence — without this, hourly HV
    // points stretch each daily DVOL bar across 24 slots and the line goes flat.
    const [dailyRaw, hourlyRaw] = await Promise.all([
      this.rpc!.call('public/get_volatility_index_data', {
        currency,
        start_timestamp: oneYearAgo,
        end_timestamp: thirtyDaysAgo,
        resolution: '1D',
      }),
      this.rpc!.call('public/get_volatility_index_data', {
        currency,
        start_timestamp: thirtyDaysAgo,
        end_timestamp: now,
        resolution: '3600',
      }),
    ]);

    const dailyParsed = CandlesResultSchema.safeParse(dailyRaw);
    const hourlyParsed = CandlesResultSchema.safeParse(hourlyRaw);
    const dailyData = dailyParsed.success ? dailyParsed.data.data : [];
    const hourlyData = hourlyParsed.success ? hourlyParsed.data.data : [];

    if (dailyData.length === 0 && hourlyData.length === 0) {
      log.warn({ currency }, 'no DVOL candles returned');
      return;
    }

    const merged = [...dailyData, ...hourlyData].sort((a, b) => a[0] - b[0]);
    const candles: typeof merged = [];
    for (const c of merged) {
      const tail = candles[candles.length - 1];
      if (tail && tail[0] === c[0]) candles[candles.length - 1] = c;
      else candles.push(c);
    }

    this.candleHistory.set(
      currency,
      candles.map(([ts, o, h, l, c]) => ({
        timestamp: ts,
        open: o,
        high: h,
        low: l,
        close: c,
      })),
    );

    let high52w = -Infinity;
    let low52w = Infinity;
    for (const [, , h, l] of candles) {
      if (h > high52w) high52w = h;
      if (l < low52w) low52w = l;
    }

    const last = candles[candles.length - 1]!;

    // ivChange1d compares against yesterday's close, not the previous candle —
    // with hourly granularity the previous candle is one hour ago.
    const todayMidnightMs = Math.floor(now / MS_PER_DAY) * MS_PER_DAY;
    let prev = last;
    for (let i = candles.length - 1; i >= 0; i--) {
      if (candles[i]![0] < todayMidnightMs) {
        prev = candles[i]!;
        break;
      }
    }

    this.snapshots.set(currency, this.buildSnapshot(currency, last[4], prev[4], high52w, low52w));

    log.info(
      {
        currency,
        current: (last[4] / 100).toFixed(4),
        ivr: this.snapshots.get(currency)!.ivr.toFixed(1),
        candles: candles.length,
        daily: dailyData.length,
        hourly: hourlyData.length,
      },
      'DVOL history loaded',
    );
  }

  private async fetchHv(currency: string): Promise<void> {
    try {
      const raw = await this.rpc!.call('public/get_historical_volatility', { currency });

      if (!Array.isArray(raw)) {
        log.warn({ currency }, 'unexpected HV response shape');
        return;
      }

      const points: HvPoint[] = [];
      for (const item of raw) {
        if (!Array.isArray(item) || item.length < 2) continue;
        const ts = Number(item[0]);
        const val = Number(item[1]);
        if (Number.isFinite(ts) && Number.isFinite(val)) {
          points.push({ timestamp: ts, value: val });
        }
      }

      this.hvHistory.set(currency, points);
      log.info({ currency, count: points.length }, 'HV history loaded');
    } catch (err: unknown) {
      log.warn({ currency, err: String(err) }, 'HV fetch failed');
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

    this.upsertLiveCandle(currency, parsed.data.volatility);
  }

  /** Keep the current hour's candle in sync with the live push so the chart's right edge advances between Deribit's hourly closes. Hourly buckets align with how `fetchHistory` requests recent candles (resolution='3600'). */
  private upsertLiveCandle(currency: string, valuePct: number): void {
    const candles = this.candleHistory.get(currency);
    if (!candles?.length) return;

    const HOUR_MS = 60 * 60 * 1000;
    const currentHourMs = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    const last = candles[candles.length - 1]!;

    if (last.timestamp >= currentHourMs) {
      last.close = valuePct;
      if (valuePct > last.high) last.high = valuePct;
      if (valuePct < last.low) last.low = valuePct;
    } else {
      candles.push({
        timestamp: currentHourMs,
        open: valuePct,
        high: valuePct,
        low: valuePct,
        close: valuePct,
      });
    }
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
          try {
            await Promise.all([this.fetchHistory(currency), this.fetchHv(currency)]);
          } catch (err: unknown) {
            log.warn({ currency, err: String(err) }, 'DVOL refresh failed');
          }
        }),
      );
      this.scheduleHistoryRefresh();
    }, msUntil);
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.rpc?.disconnect();
    this.rpc = null;
  }
}
