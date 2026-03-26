import { config as loadEnv } from 'dotenv';
import {
  BlockFlowService,
  SpotService,
  FlowService,
  buildBlockTradeUid,
  buildLiveTradeUid,
  computeBlockTradeAmounts,
  computeLiveTradeAmounts,
  parseTradeInstrument,
  type BlockTradeEvent,
  type TradeEvent,
} from '@oggregator/core';
import { NoopTradeStore, PostgresTradeStore, type PersistedTradeLeg, type PersistedTradeRecord, type TradeStore } from '@oggregator/db';
import pino from 'pino';

loadEnv();

const log = pino(process.env['NODE_ENV'] !== 'production'
  ? {
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    }
  : undefined);

const UNDERLYINGS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'BNB', 'AVAX', 'TRX', 'HYPE'] as const;
const SPOT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT', 'BNBUSDT', 'AVAXUSDT', 'TRXUSDT', 'HYPEUSDT'] as const;
const FLUSH_INTERVAL_MS = 250;
const FLUSH_BATCH_SIZE = 250;
const MAX_PENDING_RECORDS = 10_000;
const MAX_FLUSH_BACKOFF_MS = 30_000;

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  const tradeStore: TradeStore = databaseUrl
    ? PostgresTradeStore.fromConnectionString(databaseUrl)
    : new NoopTradeStore();

  if (!tradeStore.enabled) {
    log.warn('DATABASE_URL not set, ingest worker is running without persistence');
  }

  const spotService = new SpotService();
  const flowService = new FlowService();
  const blockFlowService = new BlockFlowService();
  const writer = new BufferedTradeWriter(tradeStore);

  flowService.subscribe((trade: TradeEvent) => {
    writer.push(mapLiveTrade(trade, spotService));
  });

  blockFlowService.subscribe((trade: BlockTradeEvent) => {
    writer.push(mapInstitutionalTrade(trade, spotService));
  });

  await Promise.all([
    spotService.start([...SPOT_SYMBOLS]),
    flowService.start([...UNDERLYINGS]),
    blockFlowService.start(),
  ]);

  const shutdown = async () => {
    log.info('shutting down ingest worker');
    writer.dispose();
    await writer.flush();
    flowService.dispose();
    blockFlowService.dispose();
    spotService.dispose();
    await tradeStore.dispose();
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });

  log.info({ persistence: tradeStore.enabled ? 'postgres' : 'noop' }, 'ingest worker started');
}

class BufferedTradeWriter {
  private queue: PersistedTradeRecord[] = [];
  private flushTimer: ReturnType<typeof setInterval>;
  private flushing = false;
  private consecutiveFailures = 0;
  private nextFlushAt = 0;

  constructor(private readonly tradeStore: TradeStore) {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  push(record: PersistedTradeRecord): void {
    this.queue.push(record);

    if (this.queue.length > MAX_PENDING_RECORDS) {
      const dropped = this.queue.splice(0, this.queue.length - MAX_PENDING_RECORDS);
      log.warn({ dropped: dropped.length, queued: this.queue.length }, 'trade queue overflow, dropping oldest records');
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
    } catch (error) {
      this.consecutiveFailures += 1;
      this.queue.unshift(...batch);
      const backoffMs = Math.min(1_000 * 2 ** (this.consecutiveFailures - 1), MAX_FLUSH_BACKOFF_MS);
      this.nextFlushAt = Date.now() + backoffMs;
      log.warn({ err: String(error), count: batch.length, queued: this.queue.length, backoffMs }, 'trade batch write failed');
    } finally {
      this.flushing = false;
    }
  }

  dispose(): void {
    clearInterval(this.flushTimer);
  }
}

function mapLiveTrade(trade: TradeEvent, spotService: SpotService): PersistedTradeRecord {
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

function mapInstitutionalTrade(trade: BlockTradeEvent, spotService: SpotService): PersistedTradeRecord {
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

function getSpotPriceUsd(spotService: SpotService, underlying: string): number | null {
  const snapshot = spotService.getSnapshot(underlying.toUpperCase());
  return snapshot?.lastPrice ?? null;
}

void main().catch((error) => {
  log.fatal({ err: String(error) }, 'ingest worker failed');
  process.exit(1);
});
