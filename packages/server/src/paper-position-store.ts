import {
  naturalKeyOf,
  type PositionLeg,
  type PositionStore,
  type PositionStoreListener,
} from '@oggregator/core';
import type { Position } from '@oggregator/trading';

import { positionRepository } from './trading-services.js';
import { paperEvents } from './routes/paper/events.js';

const POLL_INTERVAL_MS = 1000;

function paperToLeg(p: Position): PositionLeg {
  return {
    legId: naturalKeyOf({
      underlying: p.key.underlying,
      expiry: p.key.expiry,
      strike: p.key.strike,
      optionRight: p.key.optionRight,
      source: 'paper',
    }),
    underlying: p.key.underlying,
    expiry: p.key.expiry,
    strike: p.key.strike,
    optionRight: p.key.optionRight,
    size: p.netQuantity,
    entryPriceUsd: p.avgEntryPriceUsd,
    entryIv: p.avgEntryIv,
    realizedPnlUsd: p.realizedPnlUsd,
    entryTs: p.openedAt.getTime(),
    venueHint: null,
    source: 'paper',
  };
}

export class PaperPositionStore implements PositionStore {
  private readonly cache = new Map<string, Map<string, PositionLeg>>();
  private readonly listeners = new Set<PositionStoreListener>();
  private readonly tracked = new Set<string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private busEventUnsubscribe: (() => void) | null = null;

  constructor() {
    this.busEventUnsubscribe = paperEvents.subscribe(() => {
      void this.refreshAll();
    });
  }

  track(accountId: string): void {
    if (this.tracked.has(accountId)) return;
    this.tracked.add(accountId);
    void this.refreshAccount(accountId);
    if (this.pollTimer == null) {
      this.pollTimer = setInterval(() => {
        void this.refreshAll();
      }, POLL_INTERVAL_MS);
      this.pollTimer.unref?.();
    }
  }

  list(accountId: string): PositionLeg[] {
    this.track(accountId);
    const legs = this.cache.get(accountId);
    return legs == null ? [] : [...legs.values()];
  }

  get(accountId: string, legId: string): PositionLeg | null {
    return this.cache.get(accountId)?.get(legId) ?? null;
  }

  upsert(): PositionLeg {
    throw new Error('paper positions are read-only');
  }

  remove(): boolean {
    return false;
  }

  subscribe(listener: PositionStoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.pollTimer != null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.busEventUnsubscribe?.();
    this.busEventUnsubscribe = null;
    this.cache.clear();
    this.tracked.clear();
    this.listeners.clear();
  }

  private async refreshAll(): Promise<void> {
    await Promise.allSettled([...this.tracked].map((id) => this.refreshAccount(id)));
  }

  private async refreshAccount(accountId: string): Promise<void> {
    let positions: Position[];
    try {
      positions = await positionRepository.listPositions(accountId);
    } catch {
      return;
    }
    const open = positions.filter((p) => p.netQuantity !== 0);
    const next = new Map<string, PositionLeg>(
      open.map((p) => {
        const leg = paperToLeg(p);
        return [leg.legId, leg];
      }),
    );
    const prev = this.cache.get(accountId) ?? new Map();

    const changedLegIds: string[] = [];
    for (const [legId, leg] of next) {
      const prior = prev.get(legId);
      if (
        prior == null ||
        prior.size !== leg.size ||
        prior.entryPriceUsd !== leg.entryPriceUsd ||
        prior.entryIv !== leg.entryIv ||
        prior.realizedPnlUsd !== leg.realizedPnlUsd
      ) {
        changedLegIds.push(legId);
      }
    }
    for (const legId of prev.keys()) {
      if (!next.has(legId)) changedLegIds.push(legId);
    }
    if (changedLegIds.length === 0 && prev.size === next.size) return;

    this.cache.set(accountId, next);
    for (const listener of this.listeners) {
      try {
        listener({ accountId, changedLegIds });
      } catch {}
    }
  }
}

export const paperPositionStore = new PaperPositionStore();
