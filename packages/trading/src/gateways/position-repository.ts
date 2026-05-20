import type { AccountId } from '../book/account.js';
import type { UsdAmount } from '../book/money.js';
import type { Position } from '../book/position.js';

export interface CashLedgerEntry {
  accountId: AccountId;
  deltaUsd: UsdAmount;
  reason: 'fill' | 'fee' | 'init' | 'adjustment';
  refId: string | null;
  ts: Date;
}

export interface PositionRepository {
  listPositions(accountId: AccountId): Promise<Position[]>;
  upsertPosition(pos: Position): Promise<void>;
  appendCashLedger(entry: CashLedgerEntry): Promise<void>;
  getCashBalance(accountId: AccountId): Promise<UsdAmount>;
  ensureAccount(accountId: AccountId, label: string, initialCashUsd: UsdAmount): Promise<void>;
}
