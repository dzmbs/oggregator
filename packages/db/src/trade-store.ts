import type { PersistedTradeMode, PersistedTradeRecord } from './types.js';

export interface RecentTradeQuery {
  mode?: PersistedTradeMode;
  underlying?: string;
  venue?: string;
  limit: number;
}

export interface TradeStore {
  readonly enabled: boolean;
  writeMany(records: PersistedTradeRecord[]): Promise<void>;
  loadRecent(query: RecentTradeQuery): Promise<PersistedTradeRecord[]>;
  dispose(): Promise<void>;
}
