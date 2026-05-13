import {
  type ChainSurfaceProvider,
  InMemoryPositionStore,
  PortfolioRuntime,
  VENUE_IDS,
  delta76,
  fitSvi,
  gamma76,
  price76,
  sviIv,
  thetaPerDay,
  vega76,
  type ChainRuntimeListener,
  type EnrichedChainResponse,
  type EnrichedStrike,
  type MarkContext,
  type MarkProvider,
  type PositionLeg,
  type PositionStore,
  type SviFitPoint,
  type SviParams,
} from '@oggregator/core';
import type { PortfolioSource } from '@oggregator/protocol';

import { chainEngines } from './chain-engines.js';
import { paperPositionStore } from './paper-position-store.js';
import { derivePositionStore } from './derive-position-store.js';
import { thalexPositionStore } from './thalex-position-store.js';

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
const chainTickListeners = new Set<() => void>();

function notifyChainTickListeners(): void {
  for (const listener of chainTickListeners) {
    try {
      listener();
    } catch {}
  }
}

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
          handle.lastUsedAt = Date.now();
          notifyChainTickListeners();
        } else if (event.type === 'delta') {
          const prev = handle.snapshot;
          if (prev == null) return;
          handle.snapshot = {
            ...prev,
            stats: event.patch.stats,
            strikes: event.patch.strikes,
            gex: event.patch.gex,
          };
          handle.lastUsedAt = Date.now();
          notifyChainTickListeners();
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

// Per-field sanity gates: drop venue quote fields that fall outside the band
// of "plausible for any real option" before aggregation. A single venue
// publishing iv=99, vega=1e6, or a crossed bid/ask shouldn't be allowed to
// touch the cross-venue median even if it's the only quote available. Bounds
// are deliberately wide — these are tripwires for malformed feeds, not
// market-color filters.
function sane(v: number | null | undefined, lo: number, hi: number): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v >= lo && v <= hi ? v : null;
}
const saneIv = (v: number | null | undefined) => sane(v, 0.001, 10);
const saneDelta = (v: number | null | undefined) => sane(v, -1.05, 1.05);
const saneGamma = (v: number | null | undefined) => sane(v, 0, 1);
const saneVegaPct = (v: number | null | undefined) => sane(v, 0, 10_000);
const saneTheta = (v: number | null | undefined) => sane(v, -100_000, 100_000);
function sanePrice(v: number | null | undefined, forward: number | null): number | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  if (forward == null) return v;
  // Option premium above 2× forward is unphysical for any vanilla call/put.
  return v < forward * 2 ? v : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

// Median with MAD-based outlier rejection when N ≥ 3. Stale or one-sided
// venue quotes pull the arithmetic mean around badly on illiquid strikes;
// median + 3·MAD cull keeps the cross-venue aggregate steady when one feed
// drifts away from consensus.
function robustCentral(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (finite.length === 0) return null;
  if (finite.length <= 2) return median(finite);
  const m = median(finite)!;
  const mad = median(finite.map((v) => Math.abs(v - m)))!;
  if (mad === 0) return m;
  const kept = finite.filter((v) => Math.abs(v - m) <= 3 * mad);
  return median(kept);
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

const lastSeenMark = new Map<string, MarkContext>();
const smileFits = new Map<string, { snapshot: EnrichedChainResponse; params: SviParams | null }>();
const SVI_MIN_POINTS = 5;

export function buildSviFitPoints(snapshot: EnrichedChainResponse, forward: number): SviFitPoint[] {
  const points: SviFitPoint[] = [];
  for (const row of snapshot.strikes) {
    if (!(row.strike > 0)) continue;
    // Prefer the OTM side per Gatheral — avoids ITM call/put quote crossing.
    const side = row.strike >= forward ? row.call : row.put;
    const iv = side.bestIv;
    if (iv == null || !Number.isFinite(iv) || iv <= 0) continue;
    points.push({ k: Math.log(row.strike / forward), iv });
  }
  return points;
}

export function getSmileFit(
  underlying: string,
  expiry: string,
  snapshot: EnrichedChainResponse,
  forward: number,
  tYears: number,
): SviParams | null {
  const key = chainKey(underlying, expiry);
  const cached = smileFits.get(key);
  if (cached != null && cached.snapshot === snapshot) return cached.params;

  const points = buildSviFitPoints(snapshot, forward);
  const params = points.length >= SVI_MIN_POINTS ? fitSvi(points, tYears) : null;
  smileFits.set(key, { snapshot, params });
  return params;
}

export function sviMark(
  leg: PositionLeg,
  underlyingPriceUsd: number | null,
  forwardPriceUsd: number,
  tYears: number,
  fit: SviParams,
): MarkContext | null {
  const iv = sviIv(fit, Math.log(leg.strike / forwardPriceUsd), tYears);
  if (!(Number.isFinite(iv) && iv > 0)) return null;
  // vega76 is per-σ=1.0 (Black-76 native); every venue feed publishes vega
  // per-σ=0.01 (per 1 vol-point). Scale down so SVI legs aggregate on the
  // same axis as venue-quoted legs — otherwise sum-by-expiry flips 100× when
  // a leg in that expiry drops to the SVI fallback.
  return {
    underlyingPriceUsd,
    forwardPriceUsd,
    markPriceUsd: price76(forwardPriceUsd, leg.strike, iv, tYears, leg.optionRight),
    iv,
    delta: delta76(forwardPriceUsd, leg.strike, iv, tYears, leg.optionRight),
    gamma: gamma76(forwardPriceUsd, leg.strike, iv, tYears),
    vega: vega76(forwardPriceUsd, leg.strike, iv, tYears) / 100,
    theta: thetaPerDay(forwardPriceUsd, leg.strike, iv, tYears),
    yearsToExpiry: tYears,
    ivFromSvi: true,
  };
}

function freshMark(leg: PositionLeg): MarkContext {
  const snapshot = chainRefs.get(chainKey(leg.underlying, leg.expiry))?.snapshot ?? null;
  const ty = yearsToExpiry(leg.expiry, Date.now());
  if (snapshot == null) return { ...emptyMark(), yearsToExpiry: ty };

  const forwardPriceUsd = snapshot.stats.forwardPriceUsd ?? snapshot.stats.indexPriceUsd ?? null;
  const underlyingPriceUsd = snapshot.stats.indexPriceUsd ?? forwardPriceUsd;
  const strikeRow = findStrike(snapshot, leg.strike);

  const venueMark = (() => {
    if (strikeRow == null) return null;
    const side = leg.optionRight === 'call' ? strikeRow.call : strikeRow.put;
    const allQuotes = Object.values(side.venues).filter(
      (q): q is NonNullable<typeof q> => q != null,
    );
    if (allQuotes.length === 0) return null;

    // Prefer venues with a real two-sided book for mark/IV. One-sided quotes
    // fall back to the exchange's published mark in enrichment, which is a
    // different series with different cadence — mixing them into the same
    // arithmetic average is most of the visible mark jitter on near-expiry
    // OTM strikes.
    const twoSided = allQuotes.filter(
      (q) => q.bid != null && q.ask != null && q.bid > 0 && q.ask >= q.bid,
    );
    const priceQuotes = twoSided.length >= 1 ? twoSided : allQuotes;

    const markPriceUsd = robustCentral(priceQuotes.map((q) => sanePrice(q.mid, forwardPriceUsd)));
    const iv = robustCentral(priceQuotes.map((q) => saneIv(q.markIv)));
    const delta = robustCentral(allQuotes.map((q) => saneDelta(q.delta)));
    const gamma = robustCentral(allQuotes.map((q) => saneGamma(q.gamma)));
    const vega = robustCentral(allQuotes.map((q) => saneVegaPct(q.vega)));
    const venueTheta = robustCentral(allQuotes.map((q) => saneTheta(q.theta)));
    const theta = venueTheta ?? thetaPerDay(forwardPriceUsd, leg.strike, iv, ty);

    if (iv == null && markPriceUsd == null && delta == null) return null;

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
    } satisfies MarkContext;
  })();

  if (venueMark != null) return venueMark;

  if (forwardPriceUsd != null && forwardPriceUsd > 0 && ty != null && ty > 0) {
    const fit = getSmileFit(leg.underlying, leg.expiry, snapshot, forwardPriceUsd, ty);
    if (fit != null) {
      const synthetic = sviMark(leg, underlyingPriceUsd, forwardPriceUsd, ty, fit);
      if (synthetic != null) return synthetic;
    }
  }

  return { ...emptyMark(), underlyingPriceUsd, forwardPriceUsd, yearsToExpiry: ty };
}

// Stickiness rule: time-varying fields (yearsToExpiry) always come from
// `fresh`; price/IV/greeks fall back to the last non-null value we ever
// observed for this leg. When an MM pulls quotes the values hold steady
// instead of flashing to "—" and back, and a missing strike at a tick
// fills from cache.
export const portfolioMarkProvider: MarkProvider = (leg: PositionLeg) => {
  const fresh = freshMark(leg);
  const cached = lastSeenMark.get(leg.legId);

  const ivFromSvi = fresh.iv != null ? fresh.ivFromSvi === true : cached?.ivFromSvi === true;
  const merged: MarkContext = {
    underlyingPriceUsd: fresh.underlyingPriceUsd ?? cached?.underlyingPriceUsd ?? null,
    forwardPriceUsd: fresh.forwardPriceUsd ?? cached?.forwardPriceUsd ?? null,
    markPriceUsd: fresh.markPriceUsd ?? cached?.markPriceUsd ?? null,
    iv: fresh.iv ?? cached?.iv ?? null,
    delta: fresh.delta ?? cached?.delta ?? null,
    gamma: fresh.gamma ?? cached?.gamma ?? null,
    vega: fresh.vega ?? cached?.vega ?? null,
    theta: fresh.theta ?? cached?.theta ?? null,
    yearsToExpiry: fresh.yearsToExpiry,
    ...(ivFromSvi ? { ivFromSvi: true } : {}),
  };

  if (merged.markPriceUsd != null || merged.iv != null || merged.delta != null) {
    lastSeenMark.set(leg.legId, merged);
  }

  return merged;
};

const portfolioChainSurface: ChainSurfaceProvider = {
  getAtmStrike(underlying: string, expiry: string): number | null {
    return chainRefs.get(chainKey(underlying, expiry))?.snapshot?.stats.atmStrike ?? null;
  },
  subscribeChainTicks(listener: () => void): () => void {
    chainTickListeners.add(listener);
    return () => {
      chainTickListeners.delete(listener);
    };
  },
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

interface RuntimeEntry {
  runtime: PortfolioRuntime;
  unsubscribe: () => void;
}

const portfolioRuntimes = new Map<string, RuntimeEntry>();

function runtimeKey(
  accountId: string,
  source: PortfolioSource,
  underlying: string | undefined,
): string {
  return `${source}|${accountId}|${underlying ?? 'all'}`;
}

function storeFor(source: PortfolioSource): PositionStore {
  if (source === 'paper') return paperPositionStore;
  if (source === 'derive') return derivePositionStore;
  if (source === 'thalex') return thalexPositionStore;
  return portfolioStore;
}

function isVenueSource(source: PortfolioSource): boolean {
  return source === 'paper' || source === 'derive' || source === 'thalex';
}

export function getOrCreatePortfolioRuntime(
  accountId: string,
  source: PortfolioSource = 'manual',
  underlying?: string,
): PortfolioRuntime {
  const key = runtimeKey(accountId, source, underlying);
  const existing = portfolioRuntimes.get(key);
  if (existing != null) return existing.runtime;

  const store = storeFor(source);
  const runtime = new PortfolioRuntime({
    accountId,
    store,
    markProvider: portfolioMarkProvider,
    chainSurface: portfolioChainSurface,
    ...(underlying != null ? { underlyingFilter: underlying } : {}),
  });

  const unsubscribe = store.subscribe((event) => {
    if (event.accountId !== accountId) return;
    for (const legId of event.changedLegIds) {
      const leg = store.get(accountId, legId);
      if (leg != null) {
        void ensureChainForLeg(leg);
      }
    }
  });

  if (isVenueSource(source)) {
    void ensureChainsForBook(store.list(accountId));
  }

  runtime.start();
  portfolioRuntimes.set(key, { runtime, unsubscribe });
  return runtime;
}

export async function bootstrapPortfolioForAccount(
  accountId: string,
  source: PortfolioSource = 'manual',
  underlying?: string,
): Promise<void> {
  const store = storeFor(source);
  const legs = store.list(accountId);
  await ensureChainsForBook(legs);
  getOrCreatePortfolioRuntime(accountId, source, underlying);
}

export function listPositions(accountId: string, source: PortfolioSource): PositionLeg[] {
  return storeFor(source).list(accountId);
}

export async function disposePortfolioServices(): Promise<void> {
  for (const entry of portfolioRuntimes.values()) {
    entry.unsubscribe();
    entry.runtime.dispose();
  }
  portfolioRuntimes.clear();
  paperPositionStore.dispose();
  await derivePositionStore.dispose();
  await thalexPositionStore.dispose();
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
  for (const entry of portfolioRuntimes.values()) {
    const snap = entry.runtime.getSnapshot();
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
