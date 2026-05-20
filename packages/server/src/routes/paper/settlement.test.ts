import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fill } from '@oggregator/trading';
import type {
  PaperPositionRow,
  PaperTradePositionRow,
  PaperTradeRow,
} from '@oggregator/db';

// Stand-ins for the singletons in trading-services.ts. Replacing the modules
// keeps these tests hermetic — no DATABASE_URL, no chain runtime, no fastify
// boot.
const orderRepository = {
  saveOrder: vi.fn(async () => {}),
  saveFills: vi.fn(async () => {}),
  updateOrderStatus: vi.fn(async () => {}),
  listFills: vi.fn(async () => [] as Fill[]),
  getOrder: vi.fn(async () => null),
  listOrders: vi.fn(async () => []),
};

const positionRepository = {
  listPositions: vi.fn(async () => []),
  upsertPosition: vi.fn(async () => {}),
  appendCashLedger: vi.fn(async () => {}),
  getCashBalance: vi.fn(async () => 0),
};

const paperTradingStore = {
  enabled: true,
  listExpiredOpenPositions: vi.fn(async () => [] as PaperPositionRow[]),
  listAllAccountIdsWithOpenPositions: vi.fn(async () => [] as string[]),
  listTrades: vi.fn(async () => [] as PaperTradeRow[]),
  listTradePositions: vi.fn(async () => [] as PaperTradePositionRow[]),
  insertTradeOrder: vi.fn(async () => {}),
  upsertTradePosition: vi.fn(async () => {}),
  getTrade: vi.fn(async () => null as PaperTradeRow | null),
  updateTrade: vi.fn(async () => {}),
  insertTradeActivity: vi.fn(async (row: object) => ({ ...row, id: 'act_1' })),
  listTradeOrders: vi.fn(async () => []),
  listTradeNotes: vi.fn(async () => []),
  listTradeActivities: vi.fn(async () => []),
  getSettlementPrice: vi.fn(async () => null),
  upsertSettlementPrice: vi.fn(async () => {}),
};

vi.mock('../../trading-services.js', () => ({
  orderRepository,
  positionRepository,
  paperTradingStore,
  ensureDefaultAccount: vi.fn(async () => {}),
  orderPlacementService: { place: vi.fn() },
  pnlService: { snapshot: vi.fn() },
}));

vi.mock('../../chain-engines.js', () => ({ chainEngines: {} }));

vi.mock('./events.js', () => ({
  paperEvents: {
    emitOrder: vi.fn(),
    emitTrade: vi.fn(),
    emitActivity: vi.fn(),
  },
}));

const { settleExpiredPositionsForAccount } = await import('./workspace.js');
const { paperEvents } = await import('./events.js');

const ASOF = new Date('2026-04-26T08:05:00Z');
const ACCT = 'acct_test';

const log = { warn: vi.fn(), info: vi.fn() };

function makeRow(overrides: Partial<PaperPositionRow> = {}): PaperPositionRow {
  return {
    accountId: ACCT,
    underlying: 'BTC',
    expiry: '2026-04-25',
    strike: 30_000,
    optionRight: 'call',
    netQuantity: 5,
    avgEntryPriceUsd: 1_200,
    realizedPnlUsd: 0,
    openedAt: new Date('2026-04-01T00:00:00Z'),
    lastFillAt: new Date('2026-04-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of [
    ...Object.values(orderRepository),
    ...Object.values(positionRepository),
    ...Object.values(paperTradingStore),
  ]) {
    if (typeof fn === 'function' && 'mockReset' in fn) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  }
  for (const fn of Object.values(paperEvents) as Array<ReturnType<typeof vi.fn>>) {
    fn.mockReset?.();
  }
  log.warn.mockReset();
  log.info.mockReset();

  // restore default async return values
  paperTradingStore.listExpiredOpenPositions.mockResolvedValue([]);
  paperTradingStore.listAllAccountIdsWithOpenPositions.mockResolvedValue([]);
  paperTradingStore.listTrades.mockResolvedValue([]);
  paperTradingStore.listTradePositions.mockResolvedValue([]);
  paperTradingStore.getTrade.mockResolvedValue(null);
  paperTradingStore.insertTradeActivity.mockImplementation(async (row: object) => ({
    ...row,
    id: 'act_1',
  } as never));
  orderRepository.listFills.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('settleExpiredPositionsForAccount', () => {
  it('returns empty when no positions are expired', async () => {
    paperTradingStore.listExpiredOpenPositions.mockResolvedValue([]);
    const result = await settleExpiredPositionsForAccount(ACCT, ASOF, {
      resolveSpot: async () => 35_000,
      log,
    });
    expect(result).toEqual({ fillsCount: 0, settledTradeIds: [], skipped: [] });
  });

  it('skips with no_spot reason when resolveSpot returns null', async () => {
    paperTradingStore.listExpiredOpenPositions.mockResolvedValue([makeRow()]);
    const result = await settleExpiredPositionsForAccount(ACCT, ASOF, {
      resolveSpot: async () => null,
      log,
    });
    expect(result.fillsCount).toBe(0);
    expect(result.skipped).toEqual([
      { underlying: 'BTC', expiry: '2026-04-25', reason: 'no_spot' },
    ]);
    expect(orderRepository.saveOrder).not.toHaveBeenCalled();
  });

  it('settles a leg not held by any trade at account level only', async () => {
    paperTradingStore.listExpiredOpenPositions.mockResolvedValue([makeRow({ netQuantity: 5 })]);
    paperTradingStore.listTrades.mockResolvedValue([]);

    const result = await settleExpiredPositionsForAccount(ACCT, ASOF, {
      resolveSpot: async () => 35_000,
      log,
    });

    expect(result.fillsCount).toBe(1);
    expect(result.settledTradeIds).toEqual([]);
    expect(orderRepository.saveOrder).toHaveBeenCalledTimes(1);
    expect(orderRepository.saveFills).toHaveBeenCalledTimes(1);
    expect(positionRepository.upsertPosition).toHaveBeenCalled();
    expect(paperTradingStore.insertTradeOrder).not.toHaveBeenCalled();

    const [[savedFill]] = orderRepository.saveFills.mock.calls as [[Fill[]]];
    expect(savedFill[0]?.priceUsd).toBe(5_000);
    expect(savedFill[0]?.side).toBe('sell');
    expect(savedFill[0]?.source).toBe('settlement');
  });

  it('settles per-trade when the leg is held by an open trade', async () => {
    const tradeRow: PaperTradeRow = {
      id: 'trd_1',
      accountId: ACCT,
      underlying: 'BTC',
      label: 'Long Call',
      strategyName: 'long_call',
      status: 'open',
      entrySpotUsd: 28_000,
      openedAt: new Date('2026-04-01T00:00:00Z'),
      closedAt: null,
      createdAt: new Date('2026-04-01T00:00:00Z'),
    };
    const tradePos: PaperTradePositionRow = {
      tradeId: 'trd_1',
      underlying: 'BTC',
      expiry: '2026-04-25',
      strike: 30_000,
      optionRight: 'call',
      netQuantity: 5,
      avgEntryPriceUsd: 1_200,
      realizedPnlUsd: 0,
      openedAt: new Date('2026-04-01T00:00:00Z'),
      lastFillAt: new Date('2026-04-01T00:00:00Z'),
    };

    paperTradingStore.listExpiredOpenPositions.mockResolvedValue([makeRow({ netQuantity: 5 })]);
    paperTradingStore.listTrades.mockResolvedValue([tradeRow]);
    paperTradingStore.listTradePositions.mockResolvedValue([tradePos]);
    paperTradingStore.getTrade.mockResolvedValue({ ...tradeRow, status: 'closed', closedAt: ASOF });

    const result = await settleExpiredPositionsForAccount(ACCT, ASOF, {
      resolveSpot: async () => 35_000,
      log,
    });

    expect(result.fillsCount).toBe(1);
    expect(result.settledTradeIds).toEqual(['trd_1']);
    expect(paperTradingStore.insertTradeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ tradeId: 'trd_1', intent: 'settlement' }),
    );
    expect(paperTradingStore.upsertTradePosition).toHaveBeenCalled();
    expect(paperTradingStore.insertTradeActivity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'trade_settled', tradeId: 'trd_1' }),
    );
    expect(paperEvents.emitOrder).toHaveBeenCalled();
    expect(paperEvents.emitActivity).toHaveBeenCalled();
  });

  it('uses the venue from the most recent fill on this leg', async () => {
    const fill: Fill = {
      id: 'fil_x',
      orderId: 'ord_x',
      legIndex: 0,
      venue: 'okx',
      side: 'buy',
      optionRight: 'call',
      underlying: 'BTC',
      expiry: '2026-04-25',
      strike: 30_000,
      quantity: 5,
      requestedQuantity: 5,
      priceUsd: 1_200,
      feesUsd: 1,
      slippageUsd: 0,
      partialFill: false,
      benchmarkBidUsd: null,
      benchmarkAskUsd: null,
      benchmarkMidUsd: null,
      underlyingSpotUsd: 28_000,
      source: 'paper',
      filledAt: new Date('2026-04-01T00:00:00Z'),
    };
    orderRepository.listFills.mockResolvedValue([fill]);
    paperTradingStore.listExpiredOpenPositions.mockResolvedValue([makeRow({ netQuantity: 5 })]);

    await settleExpiredPositionsForAccount(ACCT, ASOF, {
      resolveSpot: async () => 35_000,
      log,
    });

    const [[savedFills]] = orderRepository.saveFills.mock.calls as [[Fill[]]];
    expect(savedFills[0]?.venue).toBe('okx');
  });
});
