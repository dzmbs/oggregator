import type { UsdAmount } from './money.js';

export type AccountId = string;

export interface Account {
  id: AccountId;
  label: string;
  initialCashUsd: UsdAmount;
  createdAt: Date;
}

export const DEFAULT_ACCOUNT_ID: AccountId = 'paper-default';
export const DEFAULT_ACCOUNT_LABEL = 'Paper (default)';
export const DEFAULT_INITIAL_CASH_USD: UsdAmount = 100_000;
