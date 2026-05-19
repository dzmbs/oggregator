import { setDefaultResultOrder } from 'node:dns';

setDefaultResultOrder('ipv4first');

import { config as loadEnv } from 'dotenv';
import {
  BlockTradeRuntime,
  IndexPriceRuntime,
  SpotRuntime,
  TradeRuntime,
  buildBlockTradeUid,
  buildLiveTradeUid,
  computeBlockTradeAmounts,
  computeLiveTradeAmounts,
  parseTradeInstrument,
  type BlockTradeEvent,
  type TradeEvent,
} from '@oggregator/core';
import {
  NoopTradeStore,
  PostgresTradeStore,
  type PersistedTradeLeg,
  type PersistedTradeRecord,
  type TradeStore,
} from '@oggregator/db';
import pino from 'pino';

loadEnv();

const log = pino(
  process.env['NODE_ENV'] !== 'production'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        },
      }
    : undefined,
);

// Universe spans every base with options on at least one venue we ingest.
// Per-venue filters in trade-runtime skip unsupported pairs: Deribit/Thalex
// are BTC/ETH-centric, Coincall checks COINCALL_TRADE_UNDERLYINGS, Gate.io
// silently no-ops via REST CONTRACT_NOT_FOUND.
const UNDERLYINGS = [
  'BTC',
  'ETH',
  'SOL',
  'DOGE',
  'XRP',
  'BNB',
  'AVAX',
  'TRX',
  'HYPE',
  // Gate.io has options for these (+ Binance USDT spot for USD reference).
  'LTC',
  'ADA',
  'TON',
  'SUI',
  'XAUT',
  // Coincall-listed altcoins with Binance USDT spot for USD reference.
  'AAVE',
  'ORDI',
  'WLFI',
  'ENA',
  'PENDLE',
  'TRUMP',
  // No Binance USDT spot — `referencePriceUsd` falls back to IndexPriceRuntime
  // (Coincall bsInfo for MNT/LIT/KAS, Gate.io underlyings poll for XTI/CL).
  'MNT',
  'LIT',
  'KAS',
  'XTI',
] as const;
const SPOT_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'DOGEUSDT',
  'XRPUSDT',
  'BNBUSDT',
  'AVAXUSDT',
  'TRXUSDT',
  'HYPEUSDT',
  'LTCUSDT',
  'ADAUSDT',
  'TONUSDT',
  'SUIUSDT',
  'XAUTUSDT',
  'AAVEUSDT',
  'ORDIUSDT',
  'WLFIUSDT',
  'ENAUSDT',
  'PENDLEUSDT',
  'TRUMPUSDT',
] as const;
const FLUSH_INTERVAL_MS = 250;
const FLUSH_BATCH_SIZE = 250;
const MAX_PENDING_RECORDS = 10_000;
const MAX_FLUSH_BACKOFF_MS = 30_000;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_TRADE_RETENTION_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1_000;
const OPS_LOG_INTERVAL_MS = 60_000;
const PARTITION_TOPUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const PARTITION_MONTHS_AHEAD = 3;
const RETENTION_PRUNE_INTERVAL_MS = 15 * 60 * 1000;

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  const tradeStore: TradeStore = databaseUrl
    ? PostgresTradeStore.fromConnectionString(databaseUrl)
    : new NoopTradeStore();
  const alerts = new OpsAlerter(process.env['INGEST_ALERT_WEBHOOK_URL'] ?? null);
  const retentionDays = parseTradeRetentionDays(process.env['TRADE_RETENTION_DAYS']);

  if (!tradeStore.enabled) {
    log.warn('DATABASE_URL not set, ingest worker is running without persistence');
  } else {
    try {
      await tradeStore.ensureForwardPartitions(PARTITION_MONTHS_AHEAD);
    } catch (error) {
      log.warn({ err: String(error) }, 'forward partition top-up failed at startup');
    }

    try {
      await pruneTradeHistory(tradeStore, retentionDays, 'startup');
    } catch (error) {
      log.warn({ err: stringifyError(error), retentionDays }, 'trade history prune failed at startup');
    }
  }

  const spotRuntime = new SpotRuntime();
  const tradeRuntime = new TradeRuntime();
  const blockTradeRuntime = new BlockTradeRuntime();
  const indexPriceRuntime = new IndexPriceRuntime();
  const writer = new BufferedTradeWriter(tradeStore, alerts);
  const ops = new IngestOpsTracker();

  tradeRuntime.subscribe((trade: TradeEvent) => {
    ops.recordTrade('live', trade.venue, trade.timestamp);
    writer.push(mapLiveTrade(trade, spotRuntime, indexPriceRuntime));
  });

  blockTradeRuntime.subscribe((trade: BlockTradeEvent) => {
    ops.recordTrade('institutional', trade.venue, trade.timestamp);
    writer.push(mapInstitutionalTrade(trade, spotRuntime, indexPriceRuntime));
  });

  const [spotStart, tradeStart, blockTradeStart, indexPriceStart] = await Promise.allSettled([
    spotRuntime.start([...SPOT_SYMBOLS]),
    tradeRuntime.start([...UNDERLYINGS]),
    blockTradeRuntime.start(),
    indexPriceRuntime.start({
      gateio: true,
      // Coincall fallback only matters for underlyings with no Binance USDT
      // spot pair (MNT/LIT/KAS). Others already resolve via SpotRuntime.
      coincallUnderlyings: ['MNT', 'LIT', 'KAS'],
    }),
  ]);

  if (spotStart.status === 'rejected') {
    log.warn({ err: String(spotStart.reason) }, 'spot runtime failed to start');
  }
  if (tradeStart.status === 'rejected') {
    log.warn({ err: String(tradeStart.reason) }, 'trade runtime failed to start');
  }
  if (blockTradeStart.status === 'rejected') {
    log.warn({ err: String(blockTradeStart.reason) }, 'block trade runtime failed to start');
  }
  if (indexPriceStart.status === 'rejected') {
    log.warn({ err: String(indexPriceStart.reason) }, 'index price runtime failed to start');
  }

  if (
    spotStart.status === 'rejected' &&
    tradeStart.status === 'rejected' &&
    blockTradeStart.status === 'rejected'
  ) {
    throw new Error('all ingest runtimes failed to start');
  }

  const opsTimer = setInterval(() => {
    log.info(
      {
        memory: getProcessMemorySnapshot(),
        writer: writer.getStats(),
        trades: tradeRuntime.getHealth(),
        blockTrades: blockTradeRuntime.getHealth(),
        ingest: ops.snapshot(),
      },
      'ingest ops snapshot',
    );
  }, OPS_LOG_INTERVAL_MS);

  const partitionTimer = tradeStore.enabled
    ? setInterval(() => {
        void tradeStore.ensureForwardPartitions(PARTITION_MONTHS_AHEAD).catch((error) => {
          log.warn({ err: String(error) }, 'forward partition top-up failed');
        });
      }, PARTITION_TOPUP_INTERVAL_MS)
    : null;

  const retentionTimer = tradeStore.enabled
    ? setInterval(() => {
        void pruneTradeHistory(tradeStore, retentionDays, 'interval').catch((error) => {
          log.warn({ err: stringifyError(error), retentionDays }, 'trade history prune failed');
        });
      }, RETENTION_PRUNE_INTERVAL_MS)
    : null;

  let shutdownPromise: Promise<void> | null = null;

  const shutdown = async () => {
    if (shutdownPromise != null) {
      await shutdownPromise;
      return;
    }

    shutdownPromise = (async () => {
      log.info('shutting down ingest worker');
      clearInterval(opsTimer);
      if (partitionTimer != null) clearInterval(partitionTimer);
      if (retentionTimer != null) clearInterval(retentionTimer);
      writer.dispose();
      await writer.flushAll();
      tradeRuntime.dispose();
      blockTradeRuntime.dispose();
      spotRuntime.dispose();
      indexPriceRuntime.dispose();
      await tradeStore.dispose();
    })();

    await shutdownPromise;
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });

  log.info({ persistence: tradeStore.enabled ? 'postgres' : 'noop' }, 'ingest worker started');
}

class BufferedTradeWriter {
  private queue: PersistedTradeRecord[] = [];
  private flushTimer: ReturnType<typeof setInterval>;
  private flushing = false;
  private consecutiveFailures = 0;
  private nextFlushAt = 0;
  private lastFlushAt: number | null = null;
  private lastFlushCount = 0;
  private lastFlushError: string | null = null;
  private lastDropAt: number | null = null;
  private totalDropped = 0;
  private totalWriteFailures = 0;
  private totalWritten = 0;

  constructor(
    private readonly tradeStore: TradeStore,
    private readonly alerts: OpsAlerter,
  ) {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  push(record: PersistedTradeRecord): void {
    this.queue.push(record);

    if (this.queue.length > MAX_PENDING_RECORDS) {
      const dropped = this.queue.splice(0, this.queue.length - MAX_PENDING_RECORDS);
      this.totalDropped += dropped.length;
      this.lastDropAt = Date.now();
      const details = {
        dropped: dropped.length,
        queued: this.queue.length,
        totalDropped: this.totalDropped,
        lastFlushError: this.lastFlushError,
      };
      log.error(details, 'trade queue overflow, dropping oldest records');
      void this.alerts.send(
        'trade_queue_overflow',
        'error',
        'Trade ingest is dropping live records because persistence cannot keep up',
        details,
      );
    }

    if (this.queue.length >= FLUSH_BATCH_SIZE) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0 || Date.now() < this.nextFlushAt) return;

    this.flushing = true;
    const batch = this.queue.splice(0, FLUSH_BATCH_SIZE);

    try {
      await this.tradeStore.writeMany(batch);
      const recoveredAfterFailures = this.consecutiveFailures > 0;
      this.consecutiveFailures = 0;
      this.nextFlushAt = 0;
      this.lastFlushAt = Date.now();
      this.lastFlushCount = batch.length;
      this.lastFlushError = null;
      this.totalWritten += batch.length;
      if (recoveredAfterFailures) {
        const details = {
          written: batch.length,
          queued: this.queue.length,
          totalWritten: this.totalWritten,
        };
        log.info(details, 'trade persistence recovered');
        void this.alerts.send(
          'trade_store_recovered',
          'info',
          'Trade persistence recovered after prior write failures',
          details,
        );
      }
    } catch (error) {
      this.consecutiveFailures += 1;
      this.totalWriteFailures += 1;
      this.queue.unshift(...batch);
      const backoffMs = Math.min(1_000 * 2 ** (this.consecutiveFailures - 1), MAX_FLUSH_BACKOFF_MS);
      this.nextFlushAt = Date.now() + backoffMs;
      const err = stringifyError(error);
      this.lastFlushError = err;
      const details = {
        err,
        count: batch.length,
        queued: this.queue.length,
        backoffMs,
        consecutiveFailures: this.consecutiveFailures,
        totalWriteFailures: this.totalWriteFailures,
        storageQuotaExceeded: isStorageQuotaError(error),
      };
      log.error(details, 'trade batch write failed');
      void this.alerts.send(
        'trade_store_write_failed',
        'error',
        details.storageQuotaExceeded
          ? 'Trade persistence stopped because the database storage quota is full'
          : 'Trade persistence write failed',
        details,
      );
    } finally {
      this.flushing = false;
    }
  }

  async flushAll(): Promise<void> {
    while (this.queue.length > 0) {
      const queuedBeforeFlush = this.queue.length;
      await this.flush();
      if (this.queue.length >= queuedBeforeFlush) {
        break;
      }
    }
  }

  getStats() {
    return {
      queued: this.queue.length,
      flushing: this.flushing,
      consecutiveFailures: this.consecutiveFailures,
      nextFlushAt: this.nextFlushAt || null,
      lastFlushAt: this.lastFlushAt,
      lastFlushCount: this.lastFlushCount,
      lastFlushError: this.lastFlushError,
      lastDropAt: this.lastDropAt,
      totalDropped: this.totalDropped,
      totalWriteFailures: this.totalWriteFailures,
      totalWritten: this.totalWritten,
    };
  }

  dispose(): void {
    clearInterval(this.flushTimer);
  }
}

class OpsAlerter {
  private lastSentAt = new Map<string, number>();

  constructor(private readonly webhookUrl: string | null) {}

  async send(
    event: string,
    severity: 'info' | 'error',
    message: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    if (!this.webhookUrl) return;

    const now = Date.now();
    const lastSentAt = this.lastSentAt.get(event) ?? 0;
    if (now - lastSentAt < ALERT_COOLDOWN_MS) return;
    this.lastSentAt.set(event, now);

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'oggregator-ingest',
          event,
          severity,
          message,
          ts: new Date(now).toISOString(),
          details,
        }),
      });

      if (!response.ok) {
        throw new Error(`alert webhook returned ${response.status}`);
      }
    } catch (error) {
      log.warn({ err: stringifyError(error), event }, 'ops alert delivery failed');
    }
  }
}

class IngestOpsTracker {
  private tradeCounts = new Map<string, number>();
  private lastTradeAt = new Map<string, number>();

  recordTrade(mode: 'live' | 'institutional', venue: string, timestamp: number): void {
    const key = `${mode}:${venue}`;
    this.tradeCounts.set(key, (this.tradeCounts.get(key) ?? 0) + 1);
    const current = this.lastTradeAt.get(key);
    if (current == null || timestamp > current) {
      this.lastTradeAt.set(key, timestamp);
    }
  }

  snapshot() {
    const tradeCounts = Array.from(this.tradeCounts.entries()).map(([key, count]) => {
      const [mode, venue] = key.split(':');
      return {
        mode,
        venue,
        count,
        lastTradeAt: this.lastTradeAt.get(key) ?? null,
      };
    });

    return { tradeCounts };
  }
}

function getProcessMemorySnapshot() {
  const memory = process.memoryUsage();
  return {
    rssMb: Math.round(memory.rss / 1024 / 1024),
    heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
    externalMb: Math.round(memory.external / 1024 / 1024),
    arrayBuffersMb: Math.round(memory.arrayBuffers / 1024 / 1024),
    uptimeSec: Math.round(process.uptime()),
  };
}

async function pruneTradeHistory(
  tradeStore: TradeStore,
  retentionDays: number,
  source: 'startup' | 'interval',
): Promise<void> {
  if (retentionDays <= 0) return;

  const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
  const result = await tradeStore.pruneHistory(cutoff);
  if (result.deleted === 0) return;

  log.warn(
    { deleted: result.deleted, cutoff: cutoff.toISOString(), retentionDays, source },
    'pruned retained trade history',
  );
}

function parseTradeRetentionDays(value: string | undefined): number {
  if (value == null || value.trim() === '') return DEFAULT_TRADE_RETENTION_DAYS;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('TRADE_RETENTION_DAYS must be a non-negative integer');
  }

  return parsed;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isStorageQuotaError(error: unknown): boolean {
  const message = stringifyError(error).toLowerCase();
  return message.includes('project size limit') || message.includes('could not extend file');
}

function mapLiveTrade(
  trade: TradeEvent,
  spotService: SpotRuntime,
  indexPriceService: IndexPriceRuntime,
): PersistedTradeRecord {
  const instrument = parseTradeInstrument(trade.instrument);
  const referencePriceUsd =
    trade.indexPrice ??
    getSpotPriceUsd(spotService, trade.underlying) ??
    indexPriceService.get(trade.venue, trade.underlying);
  const amounts = computeLiveTradeAmounts(trade, referencePriceUsd);

  return {
    tradeUid: buildLiveTradeUid(trade),
    mode: 'live',
    venue: trade.venue,
    underlying: trade.underlying.toUpperCase(),
    instrumentName: trade.instrument,
    tradeTs: new Date(trade.timestamp),
    ingestedAt: new Date(),
    direction: trade.side,
    contracts: amounts.contracts,
    price: trade.price,
    premiumUsd: amounts.premiumUsd,
    notionalUsd: amounts.notionalUsd,
    referencePriceUsd: amounts.referencePriceUsd,
    expiry: instrument.expiry,
    strike: instrument.strike,
    optionType: instrument.optionType,
    iv: trade.iv,
    markPrice: trade.markPrice,
    isBlock: trade.isBlock,
    strategyLabel: null,
    legs: null,
    raw: {
      tradeId: trade.tradeId,
      size: trade.size,
      indexPrice: trade.indexPrice,
    },
  };
}

function mapInstitutionalTrade(
  trade: BlockTradeEvent,
  spotService: SpotRuntime,
  indexPriceService: IndexPriceRuntime,
): PersistedTradeRecord {
  const referencePriceUsd =
    trade.indexPrice ??
    getSpotPriceUsd(spotService, trade.underlying) ??
    indexPriceService.get(trade.venue, trade.underlying);
  const amounts = computeBlockTradeAmounts(trade, referencePriceUsd);
  const firstInstrument = parseTradeInstrument(trade.legs[0]?.instrument ?? trade.underlying);
  const legs: PersistedTradeLeg[] = trade.legs.map((leg) => ({
    instrument: leg.instrument,
    direction: leg.direction,
    price: leg.price,
    size: leg.size,
    ratio: leg.ratio,
  }));

  return {
    tradeUid: buildBlockTradeUid(trade),
    mode: 'institutional',
    venue: trade.venue,
    underlying: trade.underlying.toUpperCase(),
    instrumentName: trade.legs[0]?.instrument ?? trade.underlying,
    tradeTs: new Date(trade.timestamp),
    ingestedAt: new Date(),
    direction: trade.direction,
    contracts: amounts.contracts,
    price: trade.legs[0]?.price ?? null,
    premiumUsd: amounts.premiumUsd,
    notionalUsd: amounts.notionalUsd,
    referencePriceUsd: amounts.referencePriceUsd,
    expiry: firstInstrument.expiry,
    strike: firstInstrument.strike,
    optionType: firstInstrument.optionType,
    iv: null,
    markPrice: null,
    isBlock: true,
    strategyLabel: trade.strategy,
    legs,
    raw: {
      tradeId: trade.tradeId,
      totalSize: trade.totalSize,
      indexPrice: trade.indexPrice,
    },
  };
}

function getSpotPriceUsd(spotService: SpotRuntime, underlying: string): number | null {
  const snapshot = spotService.getSnapshot(underlying.toUpperCase());
  return snapshot?.lastPrice ?? null;
}

void main().catch((error) => {
  log.fatal({ err: String(error) }, 'ingest worker failed');
  process.exitCode = 1;
});
