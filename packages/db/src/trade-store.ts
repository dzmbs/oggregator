import type { PersistedTradeMode, PersistedTradeRecord } from './types.js';

export interface TradeFilterQuery {
  mode?: PersistedTradeMode;
  underlying?: string;
  venues?: string[];
  startTs?: Date;
  endTs?: Date;
}

export interface RecentTradeQuery extends TradeFilterQuery {
  limit: number;
}

export interface TradeHistoryQuery extends TradeFilterQuery {
  mode: PersistedTradeMode;
  beforeTs?: Date;
  beforeUid?: string;
  limit: number;
}

export interface TradeVenueSummary {
  venue: string;
  count: number;
  premiumUsd: number;
  notionalUsd: number;
}

export interface TradeHistorySummary {
  count: number;
  premiumUsd: number;
  notionalUsd: number;
  oldestTs: Date | null;
  newestTs: Date | null;
  venues: TradeVenueSummary[];
}

export interface TradeStore {
  readonly enabled: boolean;
  writeMany(records: PersistedTradeRecord[]): Promise<void>;
  loadRecent(query: RecentTradeQuery): Promise<PersistedTradeRecord[]>;
  loadHistory(query: TradeHistoryQuery): Promise<PersistedTradeRecord[]>;
  summarizeHistory(query: TradeFilterQuery & { mode: PersistedTradeMode }): Promise<TradeHistorySummary>;
  dispose(): Promise<void>;
}
