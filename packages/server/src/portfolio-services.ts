import {
  InMemoryPositionStore,
  PortfolioRuntime,
  VENUE_IDS,
  thetaPerDay,
  type ChainRuntimeListener,
  type EnrichedChainResponse,
  type EnrichedStrike,
  type MarkContext,
  type MarkProvider,
  type PositionLeg,
  type VenueId,
} from '@oggregator/core';

import { chainEngines } from './chain-engines.js';

const RUNTIME_IDLE_TTL_MS = 30 * 60 * 1000;

export const portfolioStore = new InMemoryPositionStore();

interface ChainRefHandle {
  release: () => Promise<void>;
  unsubscribe: () => void;
  snapshot: EnrichedChainResponse | null;
  lastUsedAt: number;
}

const chainRefs = new Map<string, ChainRefHandle>();
const pendingEnsure = new Map<string, Promise<void>>();

function chainKey(underlying: string, expiry: string): string {
  return `${underlying}:${expiry}`;
}

async function ensureChain(underlying: string, expiry: string): Promise<void> {
  const key = chainKey(underlying, expiry);
  const existing = chainRefs.get(key);
  if (existing != null) {
    existing.lastUsedAt = Date.now();
    return;
  }
  const pending = pendingEnsure.get(key);
  if (pending != null) return pending;

  const ensurePromise = (async () => {
    const { runtime, release } = await chainEngines.acquire({
      underlying,
      expiry,
      venues: [...VENUE_IDS],
    });

    const handle: ChainRefHandle = {
      release: async () => {},
      unsubscribe: () => {},
      snapshot: null,
      lastUsedAt: Date.now(),
    };

    const listener: ChainRuntimeListener = {
      onEvent: (event) => {
        if (event.type === 'snapshot') {
          handle.snapshot = event.data;
        } else if (event.type === 'delta') {
          const prev = handle.snapshot;
          if (prev == null) return;
          handle.snapshot = {
            ...prev,
            stats: event.patch.stats,
            strikes: event.patch.strikes,
            gex: event.patch.gex,
          };
        }
      },
    };
    handle.unsubscribe = runtime.subscribe(listener);
    handle.release = release;

    try {
      handle.snapshot = await runtime.fetchSnapshotData();
    } catch {}

    chainRefs.set(key, handle);
  })();

  pendingEnsure.set(key, ensurePromise);
  try {
    await ensurePromise;
  } finally {
    pendingEnsure.delete(key);
  }
}

function findStrike(snapshot: EnrichedChainResponse, strike: number): EnrichedStrike | null {
  return snapshot.strikes.find((s) => s.strike === strike) ?? null;
}

function average(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (filtered.length === 0) return null;
  return filtered.reduce((acc, v) => acc + v, 0) / filtered.length;
}

function emptyMark(): MarkContext {
  return {
    underlyingPriceUsd: null,
    forwardPriceUsd: null,
    markPriceUsd: null,
    iv: null,
    delta: null,
    gamma: null,
    vega: null,
    theta: null,
    yearsToExpiry: null,
  };
}

function yearsToExpiry(expiry: string, nowMs: number): number | null {
  const target = Date.parse(`${expiry}T08:00:00.000Z`);
  if (!Number.isFinite(target)) return null;
  const secs = (target - nowMs) / 1000;
  if (!(secs > 0)) return null;
  return secs / (365 * 24 * 60 * 60);
}

export const portfolioMarkProvider: MarkProvider = (leg: PositionLeg) => {
  const snapshot = chainRefs.get(chainKey(leg.underlying, leg.expiry))?.snapshot ?? null;
  if (snapshot == null) return emptyMark();

  const strikeRow = findStrike(snapshot, leg.strike);
  if (strikeRow == null) return emptyMark();

  const side = leg.optionRight === 'call' ? strikeRow.call : strikeRow.put;
  const quotes = Object.values(side.venues).filter(
    (q): q is NonNullable<typeof q> => q != null,
  );
  if (quotes.length === 0) return emptyMark();

  const forwardPriceUsd = snapshot.stats.forwardPriceUsd ?? snapshot.stats.indexPriceUsd ?? null;
  const underlyingPriceUsd = snapshot.stats.indexPriceUsd ?? forwardPriceUsd;
  const markPriceUsd = average(quotes.map((q) => q.mid ?? null));
  const iv = average(quotes.map((q) => q.markIv ?? null));
  const delta = average(quotes.map((q) => q.delta ?? null));
  const gamma = average(quotes.map((q) => q.gamma ?? null));
  const vega = average(quotes.map((q) => q.vega ?? null));
  const venueTheta = average(quotes.map((q) => q.theta ?? null));
  const ty = yearsToExpiry(leg.expiry, Date.now());

  const theta = venueTheta ?? thetaPerDay(forwardPriceUsd, leg.strike, iv, ty);

  return {
    underlyingPriceUsd,
    forwardPriceUsd,
    markPriceUsd,
    iv,
    delta,
    gamma,
    vega,
    theta,
    yearsToExpiry: ty,
  };
};

export async function ensureChainForLeg(leg: PositionLeg): Promise<void> {
  await ensureChain(leg.underlying, leg.expiry);
}

export async function ensureChainsForBook(legs: PositionLeg[]): Promise<void> {
  const pairs = new Set(legs.map((l) => chainKey(l.underlying, l.expiry)));
  await Promise.allSettled(
    [...pairs].map(async (key) => {
      const [underlying, expiry] = key.split(':');
      if (underlying != null && expiry != null) await ensureChain(underlying, expiry);
    }),
  );
}

const portfolioRuntimes = new Map<string, PortfolioRuntime>();
const portfolioStoreUnsubscribes = new Map<string, () => void>();

export function getOrCreatePortfolioRuntime(accountId: string): PortfolioRuntime {
  const existing = portfolioRuntimes.get(accountId);
  if (existing != null) return existing;

  const runtime = new PortfolioRuntime({
    accountId,
    store: portfolioStore,
    markProvider: portfolioMarkProvider,
  });

  const unsubscribe = portfolioStore.subscribe((event) => {
    if (event.accountId !== accountId) return;
    for (const legId of event.changedLegIds) {
      const leg = portfolioStore.get(accountId, legId);
      if (leg != null) {
        void ensureChainForLeg(leg);
      }
    }
  });
  portfolioStoreUnsubscribes.set(accountId, unsubscribe);

  runtime.start();
  portfolioRuntimes.set(accountId, runtime);
  return runtime;
}

export async function bootstrapPortfolioForAccount(accountId: string): Promise<void> {
  const legs = portfolioStore.list(accountId);
  await ensureChainsForBook(legs);
  getOrCreatePortfolioRuntime(accountId);
}

export async function disposePortfolioServices(): Promise<void> {
  for (const unsubscribe of portfolioStoreUnsubscribes.values()) unsubscribe();
  portfolioStoreUnsubscribes.clear();
  for (const r of portfolioRuntimes.values()) r.dispose();
  portfolioRuntimes.clear();
  const refs = [...chainRefs.values()];
  chainRefs.clear();
  await Promise.allSettled(
    refs.map(async (h) => {
      h.unsubscribe();
      await h.release();
    }),
  );
}

setInterval(() => {
  const cutoff = Date.now() - RUNTIME_IDLE_TTL_MS;
  const referenced = new Set<string>();
  for (const runtime of portfolioRuntimes.values()) {
    const snap = runtime.getSnapshot();
    if (snap == null) continue;
    for (const leg of snap.positions) referenced.add(chainKey(leg.underlying, leg.expiry));
  }
  for (const [key, handle] of [...chainRefs.entries()]) {
    if (!referenced.has(key) && handle.lastUsedAt < cutoff) {
      chainRefs.delete(key);
      handle.unsubscribe();
      void handle.release();
    }
  }
}, 5 * 60 * 1000).unref?.();

export type VenueIdList = VenueId[];
