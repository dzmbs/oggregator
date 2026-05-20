import type {
  PositionLeg,
  PositionStore,
  PositionStoreListener,
} from './types.js';
import { logger } from '../utils/logger.js';

function makeLegId(): string {
  return `leg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class InMemoryPositionStore implements PositionStore {
  private readonly byAccount = new Map<string, Map<string, PositionLeg>>();
  private readonly listeners = new Set<PositionStoreListener>();

  list(accountId: string): PositionLeg[] {
    const legs = this.byAccount.get(accountId);
    return legs == null ? [] : [...legs.values()];
  }

  get(accountId: string, legId: string): PositionLeg | null {
    return this.byAccount.get(accountId)?.get(legId) ?? null;
  }

  upsert(accountId: string, leg: PositionLeg): PositionLeg {
    let legs = this.byAccount.get(accountId);
    if (legs == null) {
      legs = new Map();
      this.byAccount.set(accountId, legs);
    }
    legs.set(leg.legId, leg);
    this.broadcast({ accountId, changedLegIds: [leg.legId] });
    return leg;
  }

  remove(accountId: string, legId: string): boolean {
    const legs = this.byAccount.get(accountId);
    if (legs == null) return false;
    const removed = legs.delete(legId);
    if (removed) this.broadcast({ accountId, changedLegIds: [legId] });
    return removed;
  }

  subscribe(listener: PositionStoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private broadcast(event: { accountId: string; changedLegIds: string[] }): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error(
          { err, accountId: event.accountId, changedLegIds: event.changedLegIds },
          'portfolio store listener failed',
        );
      }
    }
  }
}

export function generateLegId(): string {
  return makeLegId();
}
