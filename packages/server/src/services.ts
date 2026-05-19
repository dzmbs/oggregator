import type { FastifyBaseLogger } from 'fastify';
import {
  BlockTradeRuntime,
  DvolService,
  IndexPriceRuntime,
  InstrumentCandleService,
  IvHistoryService,
  MarkHistoryBuffer,
  RegimeService,
  SpotCandleService,
  SpotRuntime,
  TradeRuntime,
  buildIvSurfaceGrid,
  interpBasisToTenor,
  type RegimeInputs,
  type RegimePersistence,
} from '@oggregator/core';
import {
  DEFAULT_IV_HISTORY_SIZE_WARN_BYTES,
  NoopIvHistoryStore,
  NoopRegimeStore,
  NoopTradeStore,
  PostgresIvHistoryStore,
  PostgresRegimeStore,
  PostgresTradeStore,
  type IvHistoryStorageStats,
  type IvHistoryStore,
  type RegimeStore,
  type TradeStore,
} from '@oggregator/db';
import { disposeSettlementJob, startSettlementJob } from './settlement-service.js';
import { createNewsRuntimeFromEnv, type NewsRuntime } from './news-service.js';

export const dvolService = new DvolService();
export const spotService = new SpotRuntime();
export const spotCandleService = new SpotCandleService();
// Rolling mark + trade buffer for venues with no REST mark-history endpoint
// (Derive). Fed by every adapter's quote recorder and by TradeRuntime, queried
// by the instrument-candles service when the chart panel asks for history.
export const markHistoryBuffer = new MarkHistoryBuffer();
export const instrumentCandleService = new InstrumentCandleService({ markHistoryBuffer });
export const flowService = new TradeRuntime();
export const blockFlowService = new BlockTradeRuntime();
// Third-tier fallback for `referencePriceUsd` lookups (after trade.indexPrice
// and Binance USDT SpotRuntime). Sourced from Gate.io's `/options/underlyings`
// REST poll (covers XTI/CL crude) and Coincall's bsInfo WS channel (covers
// MNT/LIT/KAS — Coincall-listed altcoins with no Binance USDT spot pair).
export const indexPriceService = new IndexPriceRuntime();
export let newsService: NewsRuntime | null = null;
const databaseUrl = process.env['DATABASE_URL'];
const ivHistorySizeWarnBytes = parseIvHistoryWarnBytes(
  process.env['IV_HISTORY_SIZE_WARN_BYTES'],
);
export const ivHistoryStore: IvHistoryStore = databaseUrl
  ? PostgresIvHistoryStore.fromConnectionString(databaseUrl, ivHistorySizeWarnBytes)
  : new NoopIvHistoryStore(ivHistorySizeWarnBytes);
export const ivHistoryService = new IvHistoryService({
  dvol: dvolService,
  store: ivHistoryStore,
  getSurfaceGrid: async (underlying: string) => {
    const entries = await buildIvSurfaceGrid({ underlying });
    return entries.map((e) => e.surfaceRow);
  },
});
export const tradeStore: TradeStore = databaseUrl
  ? PostgresTradeStore.fromConnectionString(databaseUrl)
  : new NoopTradeStore();

export const regimeStore: RegimeStore = databaseUrl
  ? PostgresRegimeStore.fromConnectionString(databaseUrl)
  : new NoopRegimeStore();

const regimePersistence: RegimePersistence = {
  enabled: regimeStore.enabled,
  loadModel: async (underlying) => {
    const persisted = await regimeStore.loadModel(underlying);
    if (!persisted) return null;
    const hmm = persisted.hmm as RegimePersistedHmm;
    const standardization = persisted.standardization as RegimePersistedStandardization;
    return {
      underlying: persisted.underlying,
      fittedAt: persisted.fittedAt.getTime(),
      observationCount: persisted.observationCount,
      hmm,
      standardization,
      stateLabels: persisted.stateLabels,
    };
  },
  saveModel: async (model) => {
    await regimeStore.saveModel({
      underlying: model.underlying,
      fittedAt: new Date(model.fittedAt),
      observationCount: model.observationCount,
      nStates: model.hmm.nStates,
      hmm: model.hmm,
      standardization: model.standardization,
      stateLabels: model.stateLabels,
    });
  },
  loadObservationsSince: async ({ underlyings, since }) => {
    const rows = await regimeStore.loadObservationsSince({
      underlyings,
      since: new Date(since),
    });
    return rows.map((r) => ({
      underlying: r.underlying,
      ts: r.ts.getTime(),
      features: r.features,
      posterior: r.posterior,
      dominant: r.dominant,
    }));
  },
  saveObservation: async (row) => {
    await regimeStore.saveObservation({
      underlying: row.underlying,
      ts: new Date(row.ts),
      features: row.features,
      posterior: row.posterior,
      dominant: row.dominant,
    });
  },
};

// RegimeService is BTC/ETH-only because IvHistoryService only seeds 30d ATM
// for those two underlyings (DVOL coverage). Other assets would need to
// accumulate ~30 days of live snapshots before fits are usable.
export const regimeService = new RegimeService(
  {
    underlyings: ['BTC', 'ETH'],
    store: regimePersistence,
    getRegimeInputs: async (underlying) => buildRegimeInputs(underlying),
  },
  { intervalMs: 5 * 60 * 1000 },
);

interface RegimePersistedHmm {
  nStates: number;
  pi: number[];
  A: number[][];
  mu: number[][];
  sigma2: number[][];
}

interface RegimePersistedStandardization {
  means: number[];
  stds: number[];
}

async function buildRegimeInputs(underlying: string): Promise<RegimeInputs> {
  const ts = Date.now();
  const ivQuery = ivHistoryService.query(underlying, 30).tenors['30d'].current;
  const atmIv30d = ivQuery.atmIv;
  const rr25d_30d = ivQuery.rr25d;
  const bfly25d_30d = ivQuery.bfly25d;

  let basis30d: number | null = null;
  try {
    const entries = await buildIvSurfaceGrid({ underlying });
    const points = entries
      .filter((e) => e.basisPct != null)
      .map((e) => ({ dte: e.dte, basisPct: e.basisPct as number }));
    basis30d = interpBasisToTenor(points, 30);
  } catch {
    // Surface grid fetch failures are non-fatal — feed yields a null-feature
    // snapshot which RegimeService skips without breaking the buffer.
  }

  return { ts, atmIv30d, rr25d_30d, bfly25d_30d, basis30d };
}

let ivHistoryStorageAlarmTimer: ReturnType<typeof setInterval> | null = null;

const serviceHealth = {
  dvol: false,
  spot: false,
  spotCandles: false,
  instrumentCandles: false,
  flow: false,
  blockFlow: false,
  ivHistory: false,
  regime: false,
  news: false,
};

export function isDvolReady(): boolean {
  return serviceHealth.dvol;
}
export function isSpotReady(): boolean {
  return serviceHealth.spot;
}
export function isSpotCandlesReady(): boolean {
  return serviceHealth.spotCandles;
}
export function isInstrumentCandlesReady(): boolean {
  return serviceHealth.instrumentCandles;
}
export function isFlowReady(): boolean {
  return serviceHealth.flow;
}
export function isBlockFlowReady(): boolean {
  return serviceHealth.blockFlow;
}
export function isIvHistoryReady(): boolean {
  return serviceHealth.ivHistory;
}
export function isRegimeReady(): boolean {
  return serviceHealth.regime;
}
export function isNewsReady(): boolean {
  return serviceHealth.news;
}

export async function getIvHistoryStorageStats(): Promise<IvHistoryStorageStats> {
  try {
    return await ivHistoryStore.getStorageStats();
  } catch {
    return {
      enabled: ivHistoryStore.enabled,
      bytes: null,
      thresholdBytes: ivHistorySizeWarnBytes,
      warning: false,
    };
  }
}

export async function bootstrapServices(log: FastifyBaseLogger) {
  const start = Date.now();

  // DVOL only exists for BTC and ETH on Deribit — no index for other assets.
  // Flow and spot cover every asset that has options on at least one venue.
  // Keep this list in sync with `UNDERLYINGS`/`SPOT_SYMBOLS` in @oggregator/ingest;
  // both processes maintain independent TradeRuntime instances against the
  // same venue universe.
  const [dvol, spot, flow, blockFlow, spotCandles, instrumentCandles, indexPrice] =
    await Promise.allSettled([
    dvolService.start(['BTC', 'ETH']),
    spotService.start([
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
    ]),
    flowService.start([
      'BTC',
      'ETH',
      'SOL',
      'DOGE',
      'XRP',
      'BNB',
      'AVAX',
      'TRX',
      'HYPE',
      'LTC',
      'ADA',
      'TON',
      'SUI',
      'XAUT',
      'AAVE',
      'ORDI',
      'WLFI',
      'ENA',
      'PENDLE',
      'TRUMP',
      'MNT',
      'LIT',
      'KAS',
      'XTI',
    ]),
    blockFlowService.start(),
    spotCandleService.start(),
    instrumentCandleService.start(),
    indexPriceService.start({
      gateio: true,
      coincallUnderlyings: ['MNT', 'LIT', 'KAS'],
    }),
  ]);

  if (dvol.status === 'fulfilled') {
    serviceHealth.dvol = true;
    log.info('DVOL service started');
  } else log.warn({ err: String(dvol.reason) }, 'DVOL service failed');

  if (spot.status === 'fulfilled') {
    serviceHealth.spot = true;
    log.info('spot service started');
  } else log.warn({ err: String(spot.reason) }, 'spot service failed');

  if (flow.status === 'fulfilled') {
    serviceHealth.flow = true;
    log.info('flow service started');
  } else log.warn({ err: String(flow.reason) }, 'flow service failed');

  if (blockFlow.status === 'fulfilled') {
    serviceHealth.blockFlow = true;
    log.info('block flow service started');
  } else log.warn({ err: String(blockFlow.reason) }, 'block flow service failed');

  if (spotCandles.status === 'fulfilled') {
    serviceHealth.spotCandles = true;
    log.info('spot-candles service started');
  } else log.warn({ err: String(spotCandles.reason) }, 'spot-candles service failed');

  if (instrumentCandles.status === 'fulfilled') {
    serviceHealth.instrumentCandles = true;
    log.info('instrument-candles service started');
  } else log.warn({ err: String(instrumentCandles.reason) }, 'instrument-candles service failed');

  if (indexPrice.status === 'rejected') {
    log.warn({ err: String(indexPrice.reason) }, 'index price runtime failed');
  }

  // IvHistoryService must start AFTER DVOL so seedFromDvol sees candles, and
  // AFTER adapters so the first snapshot's surface grid has chains to read.
  try {
    await ivHistoryService.start();
    serviceHealth.ivHistory = true;
    log.info('IV history service started');
  } catch (err: unknown) {
    log.warn({ err: String(err) }, 'IV history service failed');
  }

  // RegimeService must start AFTER IvHistoryService — it reads the 30d
  // constant-maturity ATM/RR/butterfly from the IV history query result.
  try {
    await regimeService.start();
    serviceHealth.regime = true;
    log.info('regime service started');
  } catch (err: unknown) {
    log.warn({ err: String(err) }, 'regime service failed');
  }

  startIvHistoryStorageAlarm(log);
  startSettlementJob(log);

  newsService = createNewsRuntimeFromEnv(process.env, log);
  if (newsService) {
    try {
      await newsService.start();
      serviceHealth.news = true;
      log.info('news service started');
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'news service failed');
    }
  } else {
    log.info('news service disabled (OP_FEED_BASE_URL / OP_FEED_SECRET not set)');
  }

  log.info({ ms: Date.now() - start, health: serviceHealth }, 'services bootstrapped');
}

export function disposeServiceStores(): void {
  if (ivHistoryStorageAlarmTimer) {
    clearInterval(ivHistoryStorageAlarmTimer);
    ivHistoryStorageAlarmTimer = null;
  }
  regimeService.dispose();
  newsService?.dispose();
  disposeSettlementJob();
}

function parseIvHistoryWarnBytes(value: string | undefined): number {
  if (!value) return DEFAULT_IV_HISTORY_SIZE_WARN_BYTES;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IV_HISTORY_SIZE_WARN_BYTES;
}

function startIvHistoryStorageAlarm(log: FastifyBaseLogger): void {
  if (ivHistoryStorageAlarmTimer || !ivHistoryStore.enabled) return;

  const check = async () => {
    try {
      const stats = await ivHistoryStore.getStorageStats();
      if (!stats.warning || stats.bytes == null) return;
      log.warn(
        { bytes: stats.bytes, thresholdBytes: stats.thresholdBytes },
        'IV history storage size warning',
      );
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'IV history storage size check failed');
    }
  };

  void check();
  ivHistoryStorageAlarmTimer = setInterval(() => {
    void check();
  }, 5 * 60 * 1000);
  ivHistoryStorageAlarmTimer.unref?.();
}
