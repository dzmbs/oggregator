import {
  DerivePrivateClient,
  type DerivePrivateCreds,
  type PositionLeg,
  type PositionStore,
  type PositionStoreListener,
} from '@oggregator/core';

export interface DerivePositionStoreCreds extends DerivePrivateCreds {
  accountId: string;
}

export class DerivePositionStore implements PositionStore {
  private readonly cache = new Map<string, Map<string, PositionLeg>>();
  private readonly listeners = new Set<PositionStoreListener>();
  private readonly clients = new Map<string, DerivePrivateClient>();
  private readonly unsubscribes = new Map<string, () => void>();

  list(accountId: string): PositionLeg[] {
    const legs = this.cache.get(accountId);
    return legs == null ? [] : [...legs.values()];
  }

  get(accountId: string, legId: string): PositionLeg | null {
    return this.cache.get(accountId)?.get(legId) ?? null;
  }

  upsert(): PositionLeg {
    throw new Error('derive positions are read-only');
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

  async connect(creds: DerivePositionStoreCreds): Promise<void> {
    await this.disconnect(creds.accountId);

    const client = new DerivePrivateClient(creds);
    const unsubscribe = client.subscribe((legs) => {
      this.applyLegs(creds.accountId, legs);
    });
    this.clients.set(creds.accountId, client);
    this.unsubscribes.set(creds.accountId, unsubscribe);
    await client.start();
  }

  async disconnect(accountId: string): Promise<void> {
    const unsubscribe = this.unsubscribes.get(accountId);
    if (unsubscribe != null) {
      unsubscribe();
      this.unsubscribes.delete(accountId);
    }
    const client = this.clients.get(accountId);
    if (client != null) {
      this.clients.delete(accountId);
      await client.dispose();
    }
    this.cache.delete(accountId);
    this.broadcast(accountId, []);
  }

  isConnected(accountId: string): boolean {
    return this.clients.has(accountId);
  }

  async dispose(): Promise<void> {
    const accountIds = [...this.clients.keys()];
    await Promise.allSettled(accountIds.map((id) => this.disconnect(id)));
    this.listeners.clear();
  }

  private applyLegs(accountId: string, legs: PositionLeg[]): void {
    const next = new Map<string, PositionLeg>(legs.map((leg) => [leg.legId, leg]));
    const prev = this.cache.get(accountId) ?? new Map<string, PositionLeg>();
    const changedLegIds: string[] = [];
    for (const [legId, leg] of next) {
      const prior = prev.get(legId);
      if (prior == null || prior.size !== leg.size || prior.entryPriceUsd !== leg.entryPriceUsd) {
        changedLegIds.push(legId);
      }
    }
    for (const legId of prev.keys()) {
      if (!next.has(legId)) changedLegIds.push(legId);
    }
    this.cache.set(accountId, next);
    if (changedLegIds.length > 0 || prev.size !== next.size) {
      this.broadcast(accountId, changedLegIds);
    }
  }

  private broadcast(accountId: string, changedLegIds: string[]): void {
    for (const listener of this.listeners) {
      try {
        listener({ accountId, changedLegIds });
      } catch {}
    }
  }
}

export const derivePositionStore = new DerivePositionStore();
