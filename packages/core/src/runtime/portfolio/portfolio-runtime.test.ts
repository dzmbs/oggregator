import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryPositionStore } from '../../portfolio/in-memory-store.js';
import type { MarkContext, MarkProvider } from '../../portfolio/types.js';
import {
  PortfolioRuntime,
  type PortfolioRuntimeEvent,
} from './portfolio-runtime.js';
import { price76, vega76 } from '../../feeds/thalex/bs-solver.js';
import type { PositionLeg } from '@oggregator/protocol';

const F = 70_000;
const SIGMA = 0.6;
const T_YEARS = 0.25;
const ACCOUNT = 'acct-1';
const NOW = Date.UTC(2026, 4, 12);

function makeLeg(strike: number, size: number, legId = `leg-${strike}-${size}`): PositionLeg {
  return {
    legId,
    underlying: 'BTC',
    expiry: '2026-08-12',
    strike,
    optionRight: 'call',
    size,
    entryPriceUsd: 1_000,
    entryIv: SIGMA,
    entryTs: NOW,
    venueHint: null,
    source: 'manual',
    realizedPnlUsd: 0,
  };
}

const markProvider: MarkProvider = (leg) => {
  const mark: MarkContext = {
    underlyingPriceUsd: F,
    forwardPriceUsd: F,
    markPriceUsd: price76(F, leg.strike, SIGMA, T_YEARS, leg.optionRight),
    iv: SIGMA,
    delta: 0.5,
    gamma: 0.0001,
    vega: vega76(F, leg.strike, SIGMA, T_YEARS),
    theta: -50,
    yearsToExpiry: T_YEARS,
  };
  return mark;
};

describe('PortfolioRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a snapshot event on start', () => {
    const store = new InMemoryPositionStore();
    store.upsert(ACCOUNT, makeLeg(70_000, 1));
    const runtime = new PortfolioRuntime({
      accountId: ACCOUNT,
      store,
      markProvider,
      now: () => NOW,
    });
    const events: PortfolioRuntimeEvent[] = [];
    runtime.subscribe({ onEvent: (e) => events.push(e) });
    runtime.start();

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('snapshot');
    if (events[0]?.type === 'snapshot') {
      expect(events[0].positions).toHaveLength(1);
      expect(events[0].metrics.totals.netVegaUsd).toBeGreaterThan(0);
    }
    runtime.dispose();
  });

  it('emits delta on position upsert after push interval', () => {
    const store = new InMemoryPositionStore();
    const runtime = new PortfolioRuntime({
      accountId: ACCOUNT,
      store,
      markProvider,
      now: () => NOW,
    });
    const events: PortfolioRuntimeEvent[] = [];
    runtime.subscribe({ onEvent: (e) => events.push(e) });
    runtime.start();
    expect(events.filter((e) => e.type === 'snapshot')).toHaveLength(1);

    store.upsert(ACCOUNT, makeLeg(80_000, 2, 'new-leg'));
    vi.advanceTimersByTime(250);

    const deltas = events.filter((e) => e.type === 'delta');
    expect(deltas.length).toBeGreaterThanOrEqual(1);
    if (deltas[0]?.type === 'delta') {
      expect(deltas[0].changedLegIds).toContain('new-leg');
      expect(deltas[0].metrics.byStrike.length).toBeGreaterThan(0);
    }
    runtime.dispose();
  });

  it('does not emit delta when no changes', () => {
    const store = new InMemoryPositionStore();
    store.upsert(ACCOUNT, makeLeg(70_000, 1));
    const runtime = new PortfolioRuntime({
      accountId: ACCOUNT,
      store,
      markProvider,
      now: () => NOW,
    });
    const events: PortfolioRuntimeEvent[] = [];
    runtime.subscribe({ onEvent: (e) => events.push(e) });
    runtime.start();
    const baseline = events.length;
    vi.advanceTimersByTime(1_000);
    expect(events.length).toBe(baseline);
    runtime.dispose();
  });

  it('emits delta when forwardDays changes', () => {
    const store = new InMemoryPositionStore();
    store.upsert(ACCOUNT, makeLeg(70_000, 1));
    const runtime = new PortfolioRuntime({
      accountId: ACCOUNT,
      store,
      markProvider,
      now: () => NOW,
    });
    const events: PortfolioRuntimeEvent[] = [];
    runtime.subscribe({ onEvent: (e) => events.push(e) });
    runtime.start();
    const before = events.length;
    runtime.setForwardDays(3);
    vi.advanceTimersByTime(250);
    expect(events.length).toBeGreaterThan(before);
    const last = events[events.length - 1];
    if (last?.type === 'delta') {
      expect(last.metrics.forwardDays).toBe(3);
    }
    runtime.dispose();
  });

  it('dispose stops emission', () => {
    const store = new InMemoryPositionStore();
    const runtime = new PortfolioRuntime({
      accountId: ACCOUNT,
      store,
      markProvider,
      now: () => NOW,
    });
    const events: PortfolioRuntimeEvent[] = [];
    runtime.subscribe({ onEvent: (e) => events.push(e) });
    runtime.start();
    runtime.dispose();
    const afterDispose = events.length;
    store.upsert(ACCOUNT, makeLeg(70_000, 1));
    vi.advanceTimersByTime(500);
    expect(events.length).toBe(afterDispose);
  });

  it('falls back to raw positions when metrics build fails', () => {
    const store = new InMemoryPositionStore();
    store.upsert(ACCOUNT, makeLeg(70_000, 1));
    const runtime = new PortfolioRuntime({
      accountId: ACCOUNT,
      store,
      markProvider: () => {
        throw new Error('mark provider boom');
      },
      now: () => NOW,
    });
    const events: PortfolioRuntimeEvent[] = [];
    runtime.subscribe({ onEvent: (e) => events.push(e) });

    runtime.start();

    expect(events[0]?.type).toBe('snapshot');
    if (events[0]?.type === 'snapshot') {
      expect(events[0].positions).toHaveLength(1);
      expect(events[0].metrics.totals.netVegaUsd).toBe(0);
      expect(events[0].metrics.byStrike).toEqual([]);
    }
    expect(events[1]).toEqual({
      type: 'error',
      code: 'portfolio_metrics_failed',
      message: 'mark provider boom',
    });
    runtime.dispose();
  });
});
