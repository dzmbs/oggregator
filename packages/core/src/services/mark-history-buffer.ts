import type { VenueId } from '../types/common.js';
import { feedLogger } from '../utils/logger.js';

const log = feedLogger('mark-history-buffer');

export interface RawCandle {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  vol: number;
}

export interface MarkHistoryBufferOptions {
  /** Base bucket size for stored OHLC. Default 60s. Query intervals must be a multiple. */
  bucketMs?: number;
  /** Sliding window retained per instrument. Default 7 days. */
  retentionMs?: number;
}

interface InstrumentStore {
  mark: Map<number, RawCandle>;
  trade: Map<number, RawCandle>;
}

const DEFAULT_BUCKET_MS = 60_000;
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Rolling per-instrument OHLC buffer fed by live feeds, used for venues whose
 * REST API does not expose mark-price-history or trade-history endpoints
 * (Derive being the motivating case — `public/get_trade_history` returns
 * sparse/empty data for low-volume contracts like HYPE options, and no
 * mark-price-history endpoint exists at all).
 *
 * Two parallel streams per `(venue, exchangeSymbol)` key:
 *   - mark   — appended on every quote tick where mark price is known
 *   - trade  — appended on every live trade event
 *
 * Stored at 1-minute granularity by default. Query-time re-bucketing rolls
 * adjacent base buckets up to the requested interval (must be a multiple of
 * `bucketMs`). Out-of-order ticks (rare in practice) merge into their natural
 * bucket. Older buckets are pruned lazily on every write.
 */
export class MarkHistoryBuffer {
  private readonly bucketMs: number;
  private readonly retentionMs: number;
  private readonly stores = new Map<string, InstrumentStore>();
  private writeCount = 0;

  constructor(options: MarkHistoryBufferOptions = {}) {
    this.bucketMs = options.bucketMs ?? DEFAULT_BUCKET_MS;
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  }

  recordMark(venue: VenueId, exchangeSymbol: string, ts: number, mark: number | null): void {
    if (mark == null || !Number.isFinite(mark) || mark <= 0) return;
    if (!Number.isFinite(ts) || ts <= 0) return;

    const store = this.ensureStore(venue, exchangeSymbol);
    this.appendOhlc(store.mark, ts, mark, 0);
    this.maybePrune(store, ts);
  }

  recordTrade(
    venue: VenueId,
    exchangeSymbol: string,
    ts: number,
    price: number,
    size: number,
  ): void {
    if (!Number.isFinite(price) || price <= 0) return;
    if (!Number.isFinite(ts) || ts <= 0) return;
    const vol = Number.isFinite(size) && size > 0 ? size : 0;

    const store = this.ensureStore(venue, exchangeSymbol);
    this.appendOhlc(store.trade, ts, price, vol);
    this.maybePrune(store, ts);
  }

  /**
   * Returns mark candles at the requested interval covering [now - rangeMs, now].
   * Empty when the buffer has no recorded ticks for this instrument yet.
   */
  getMarkCandles(
    venue: VenueId,
    exchangeSymbol: string,
    intervalMs: number,
    rangeMs: number,
  ): RawCandle[] {
    const store = this.stores.get(this.key(venue, exchangeSymbol));
    if (!store) return [];
    return this.queryBucketed(store.mark, intervalMs, rangeMs);
  }

  /**
   * Returns trade-bucketed candles (with summed volume) at the requested
   * interval covering [now - rangeMs, now].
   */
  getTradeCandles(
    venue: VenueId,
    exchangeSymbol: string,
    intervalMs: number,
    rangeMs: number,
  ): RawCandle[] {
    const store = this.stores.get(this.key(venue, exchangeSymbol));
    if (!store) return [];
    return this.queryBucketed(store.trade, intervalMs, rangeMs);
  }

  hasMark(venue: VenueId, exchangeSymbol: string): boolean {
    return (this.stores.get(this.key(venue, exchangeSymbol))?.mark.size ?? 0) > 0;
  }

  hasTrade(venue: VenueId, exchangeSymbol: string): boolean {
    return (this.stores.get(this.key(venue, exchangeSymbol))?.trade.size ?? 0) > 0;
  }

  stats(): { instruments: number; markBuckets: number; tradeBuckets: number } {
    let markBuckets = 0;
    let tradeBuckets = 0;
    for (const store of this.stores.values()) {
      markBuckets += store.mark.size;
      tradeBuckets += store.trade.size;
    }
    return { instruments: this.stores.size, markBuckets, tradeBuckets };
  }

  clear(): void {
    this.stores.clear();
    this.writeCount = 0;
  }

  private key(venue: VenueId, exchangeSymbol: string): string {
    return `${venue}:${exchangeSymbol}`;
  }

  private ensureStore(venue: VenueId, exchangeSymbol: string): InstrumentStore {
    const k = this.key(venue, exchangeSymbol);
    let store = this.stores.get(k);
    if (!store) {
      store = { mark: new Map(), trade: new Map() };
      this.stores.set(k, store);
    }
    return store;
  }

  private appendOhlc(target: Map<number, RawCandle>, ts: number, price: number, vol: number): void {
    const bucket = Math.floor(ts / this.bucketMs) * this.bucketMs;
    const existing = target.get(bucket);
    if (!existing) {
      target.set(bucket, { ts: bucket, o: price, h: price, l: price, c: price, vol });
      return;
    }
    if (price > existing.h) existing.h = price;
    if (price < existing.l) existing.l = price;
    existing.c = price;
    existing.vol += vol;
  }

  // Prune entries older than the retention window. Runs every 256 writes to
  // amortize the cost. Sweeps every instrument store, not just the one being
  // written — otherwise inactive instruments keep stale buckets forever.
  private maybePrune(_store: InstrumentStore, ts: number): void {
    this.writeCount++;
    if ((this.writeCount & 0xff) !== 0) return;
    const cutoff = ts - this.retentionMs;
    for (const store of this.stores.values()) {
      this.pruneStore(store, cutoff);
    }
  }

  private pruneStore(store: InstrumentStore, cutoff: number): void {
    for (const map of [store.mark, store.trade]) {
      let removed = 0;
      for (const bucket of map.keys()) {
        if (bucket >= cutoff) continue;
        map.delete(bucket);
        removed++;
      }
      if (removed > 0) {
        log.debug({ removed, cutoff }, 'pruned stale buckets');
      }
    }
  }

  private queryBucketed(
    source: Map<number, RawCandle>,
    intervalMs: number,
    rangeMs: number,
  ): RawCandle[] {
    if (source.size === 0) return [];
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return [];

    const cutoff = Date.now() - rangeMs;
    const since = Math.floor(cutoff / this.bucketMs) * this.bucketMs;
    const sorted = [...source.values()]
      .filter((candle) => candle.ts >= since)
      .sort((a, b) => a.ts - b.ts);

    if (intervalMs === this.bucketMs) return sorted;

    return mergeBaseBuckets(sorted, intervalMs);
  }
}

/**
 * Rolls consecutive base-interval candles up to a coarser interval. Open is the
 * first bucket's open, close is the last bucket's close, high/low are the
 * window extrema, and volume sums. Buckets must be sorted ascending.
 */
export function mergeBaseBuckets(
  sorted: readonly RawCandle[],
  intervalMs: number,
): RawCandle[] {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new TypeError(`mergeBaseBuckets: intervalMs must be a finite positive number, got ${intervalMs}`);
  }
  if (sorted.length === 0) return [];
  const out: RawCandle[] = [];
  let current: RawCandle | null = null;

  for (const candle of sorted) {
    const slot = Math.floor(candle.ts / intervalMs) * intervalMs;
    if (current == null || current.ts !== slot) {
      if (current) out.push(current);
      current = { ts: slot, o: candle.o, h: candle.h, l: candle.l, c: candle.c, vol: candle.vol };
      continue;
    }
    if (candle.h > current.h) current.h = candle.h;
    if (candle.l < current.l) current.l = candle.l;
    current.c = candle.c;
    current.vol += candle.vol;
  }
  if (current) out.push(current);
  return out;
}
