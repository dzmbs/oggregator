import type { PaperTradingStore, PaperPositionRow } from '@oggregator/db';
import type { AccountId } from '../book/account.js';
import type { Position } from '../book/position.js';
import type {
  CashLedgerEntry,
  PositionRepository,
} from '../gateways/position-repository.js';

export class PostgresPositionRepository implements PositionRepository {
  constructor(private readonly store: PaperTradingStore) {}

  async listPositions(accountId: AccountId): Promise<Position[]> {
    const rows = await this.store.listPositions(accountId);
    return rows.map(fromRow);
  }

  async upsertPosition(pos: Position): Promise<void> {
    await this.store.upsertPosition(toRow(pos));
  }

  async appendCashLedger(entry: CashLedgerEntry): Promise<void> {
    await this.store.appendCashLedger({
      accountId: entry.accountId,
      deltaUsd: entry.deltaUsd,
      reason: entry.reason,
      refId: entry.refId,
      ts: entry.ts,
    });
  }

  async getCashBalance(accountId: AccountId): Promise<number> {
    return this.store.sumCashLedger(accountId);
  }

  async ensureAccount(
    accountId: AccountId,
    label: string,
    initialCashUsd: number,
  ): Promise<void> {
    await this.store.ensureAccount({
      id: accountId,
      label,
      initialCashUsd,
      createdAt: new Date(),
    });
  }
}

function toRow(pos: Position): PaperPositionRow {
  return {
    accountId: pos.key.accountId,
    underlying: pos.key.underlying,
    expiry: pos.key.expiry,
    strike: pos.key.strike,
    optionRight: pos.key.optionRight,
    netQuantity: pos.netQuantity,
    avgEntryPriceUsd: pos.avgEntryPriceUsd,
    avgEntryIv: pos.avgEntryIv,
    realizedPnlUsd: pos.realizedPnlUsd,
    openedAt: pos.openedAt,
    lastFillAt: pos.lastFillAt,
  };
}

function fromRow(row: PaperPositionRow): Position {
  return {
    key: {
      accountId: row.accountId,
      underlying: row.underlying,
      expiry: row.expiry,
      strike: row.strike,
      optionRight: row.optionRight,
    },
    netQuantity: row.netQuantity,
    avgEntryPriceUsd: row.avgEntryPriceUsd,
    avgEntryIv: row.avgEntryIv ?? null,
    realizedPnlUsd: row.realizedPnlUsd,
    openedAt: row.openedAt,
    lastFillAt: row.lastFillAt,
  };
}
