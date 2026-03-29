import { config as loadEnv } from 'dotenv';
import {
  BlockTradeRuntime,
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

const UNDERLYINGS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'BNB', 'AVAX', 'TRX', 'HYPE'] as const;
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
] as const;
const FLUSH_INTERVAL_MS = 250;
const FLUSH_BATCH_SIZE = 250;
const MAX_PENDING_RECORDS = 10_000;
const MAX_FLUSH_BACKOFF_MS = 30_000;
const OPS_LOG_INTERVAL_MS = 60_000;

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  const tradeStore: TradeStore = databaseUrl
    ? PostgresTradeStore.fromConnectionString(databaseUrl)
    : new NoopTradeStore();

  if (!tradeStore.enabled) {
    log.warn('DATABASE_URL not set, ingest worker is running without persistence');
  }

  const spotRuntime = new SpotRuntime();
  const tradeRuntime = new TradeRuntime();
  const blockTradeRuntime = new BlockTradeRuntime();
  const writer = new BufferedTradeWriter(tradeStore);
  const ops = new IngestOpsTracker();

  tradeRuntime.subscribe((trade: TradeEvent) => {
    ops.recordTrade('live', trade.venue, trade.timestamp);
    writer.push(mapLiveTrade(trade, spotRuntime));
  });

  blockTradeRuntime.subscribe((trade: BlockTradeEvent) => {
    ops.recordTrade('institutional', trade.venue, trade.timestamp);
    writer.push(mapInstitutionalTrade(trade, spotRuntime));
  });

  const [spotStart, tradeStart, blockTradeStart] = await Promise.allSettled([
    spotRuntime.start([...SPOT_SYMBOLS]),
    tradeRuntime.start([...UNDERLYINGS]),
    blockTradeRuntime.start(),
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

  let shutdownPromise: Promise<void> | null = null;

  const shutdown = async () => {
    if (shutdownPromise != null) {
      await shutdownPromise;
      return;
    }

    shutdownPromise = (async () => {
      log.info('shutting down ingest worker');
      clearInterval(opsTimer);
      writer.dispose();
      await writer.flushAll();
      tradeRuntime.dispose();
      blockTradeRuntime.dispose();
      spotRuntime.dispose();
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
  private totalWritten = 0;

  constructor(private readonly tradeStore: TradeStore) {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  push(record: PersistedTradeRecord): void {
    this.queue.push(record);

    if (this.queue.length > MAX_PENDING_RECORDS) {
      const dropped = this.queue.splice(0, this.queue.length - MAX_PENDING_RECORDS);
      log.warn(
        { dropped: dropped.length, queued: this.queue.length },
        'trade queue overflow, dropping oldest records',
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
      this.consecutiveFailures = 0;
      this.nextFlushAt = 0;
      this.lastFlushAt = Date.now();
      this.lastFlushCount = batch.length;
      this.lastFlushError = null;
      this.totalWritten += batch.length;
    } catch (error) {
      this.consecutiveFailures += 1;
      this.queue.unshift(...batch);
      const backoffMs = Math.min(1_000 * 2 ** (this.consecutiveFailures - 1), MAX_FLUSH_BACKOFF_MS);
      this.nextFlushAt = Date.now() + backoffMs;
      this.lastFlushError = String(error);
      log.warn(
        { err: String(error), count: batch.length, queued: this.queue.length, backoffMs },
        'trade batch write failed',
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
      totalWritten: this.totalWritten,
    };
  }

  dispose(): void {
    clearInterval(this.flushTimer);
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

function mapLiveTrade(trade: TradeEvent, spotService: SpotRuntime): PersistedTradeRecord {
  const instrument = parseTradeInstrument(trade.instrument);
  const referencePriceUsd = trade.indexPrice ?? getSpotPriceUsd(spotService, trade.underlying);
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
      venue: trade.venue,
      instrument: trade.instrument,
      underlying: trade.underlying,
      side: trade.side,
      price: trade.price,
      size: trade.size,
      iv: trade.iv,
      markPrice: trade.markPrice,
      indexPrice: trade.indexPrice,
      isBlock: trade.isBlock,
      timestamp: trade.timestamp,
    },
  };
}

function mapInstitutionalTrade(
  trade: BlockTradeEvent,
  spotService: SpotRuntime,
): PersistedTradeRecord {
  const referencePriceUsd = trade.indexPrice ?? getSpotPriceUsd(spotService, trade.underlying);
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
      venue: trade.venue,
      tradeId: trade.tradeId,
      timestamp: trade.timestamp,
      underlying: trade.underlying,
      direction: trade.direction,
      strategy: trade.strategy,
      totalSize: trade.totalSize,
      notionalUsd: trade.notionalUsd,
      indexPrice: trade.indexPrice,
      legs,
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
