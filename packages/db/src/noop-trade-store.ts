import type { RecentTradeQuery, TradeStore } from './trade-store.js';
import type { PersistedTradeRecord } from './types.js';

export class NoopTradeStore implements TradeStore {
  readonly enabled = false;

  async writeMany(_records: PersistedTradeRecord[]): Promise<void> {}

  async loadRecent(_query: RecentTradeQuery): Promise<PersistedTradeRecord[]> {
    return [];
  }

  async dispose(): Promise<void> {}
}
