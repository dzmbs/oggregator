import { describe, expect, it, vi } from 'vitest';
import { interpTenor, type IvSurfaceRow } from '../core/enrichment.js';
import {
  IvHistoryService,
  type IvHistoryPersistence,
  type PersistedIvHistoryPoint,
} from './iv-history.js';
import type { DvolService } from './dvol.js';

function makeRow(expiry: string, dte: number, atm: number, skew: number, fly: number): IvSurfaceRow {
  // skew = c25 − p25, fly = (c25+p25)/2 − atm → solve for c25, p25
  // c25 = atm + fly + skew/2; p25 = atm + fly − skew/2.
  const c25 = atm + fly + skew / 2;
  const p25 = atm + fly - skew / 2;
  return {
    expiry,
    dte,
    delta10p: null,
    delta25p: p25,
    atm,
    delta25c: c25,
    delta10c: null,
  };
}

function mockDvol(opts: {
  history?: { BTC?: Array<[number, number]>; ETH?: Array<[number, number]> };
  liveBtc?: number | null;
  liveEth?: number | null;
} = {}) {
  const history = opts.history ?? {};
  const getHistory = (currency: string) => {
    const rows = history[currency as 'BTC' | 'ETH'] ?? [];
    return rows.map(([timestamp, close]) => ({
      timestamp,
      open: close,
      high: close,
      low: close,
      close,
    }));
  };
  const getSnapshot = (currency: string) => {
    if (currency === 'BTC' && opts.liveBtc != null) return { current: opts.liveBtc };
    if (currency === 'ETH' && opts.liveEth != null) return { current: opts.liveEth };
    return null;
  };
  return { getHistory, getSnapshot } as unknown as DvolService;
}

function mockStore(opts: {
  load?: PersistedIvHistoryPoint[];
  writeRejects?: boolean;
} = {}) {
  const written: PersistedIvHistoryPoint[] = [];
  const store: IvHistoryPersistence = {
    enabled: true,
    loadSince: vi.fn(() => Promise.resolve(opts.load ?? [])),
    writeMany: vi.fn((points: PersistedIvHistoryPoint[]) => {
      if (opts.writeRejects) return Promise.reject(new Error('store boom'));
      written.push(...points);
      return Promise.resolve();
    }),
  };
  return { store, written };
}

describe('interpTenor', () => {
  it('variance-time interpolates ATM between two expiries', () => {
    const surfaces: IvSurfaceRow[] = [
      makeRow('near', 14, 0.5, 0, 0),
      makeRow('far', 60, 0.6, 0, 0),
    ];
    const at30 = interpTenor(surfaces, 30, 'atm');
    expect(at30).not.toBeNull();
    // Manually: vLo = 0.25 * 14 = 3.5; vHi = 0.36 * 60 = 21.6; t = 16/46.
    const t = 16 / 46;
    const vInterp = 3.5 + t * (21.6 - 3.5);
    const expected = Math.sqrt(vInterp / 30);
    expect(at30!).toBeCloseTo(expected, 6);
  });

  it('clamps to nearest endpoint outside observed DTE range', () => {
    const surfaces: IvSurfaceRow[] = [
      makeRow('near', 7, 0.5, 0, 0),
      makeRow('far', 30, 0.6, 0, 0),
    ];
    expect(interpTenor(surfaces, 3, 'atm')).toBe(0.5);
    expect(interpTenor(surfaces, 60, 'atm')).toBe(0.6);
  });

  it('returns null when no surface rows have the requested field', () => {
    const surfaces: IvSurfaceRow[] = [
      { expiry: 'x', dte: 10, delta10p: null, delta25p: null, atm: null, delta25c: null, delta10c: null },
    ];
    expect(interpTenor(surfaces, 30, 'atm')).toBeNull();
  });
});

describe('IvHistoryService', () => {
  it('evicts oldest when exceeding capacity', async () => {
    const surfaces = [makeRow('e', 30, 0.5, 0.02, 0.01)];
    const svc = new IvHistoryService(
      {
        getSurfaceGrid: () => Promise.resolve(surfaces),
        dvol: mockDvol(),
      },
      { underlyings: ['BTC'], intervalMs: 10_000, capacity: 3 },
    );
    for (let i = 0; i < 5; i++) {
      await svc.snapshotOnce(1000 + i);
    }
    const buf = svc.getBuffer('BTC', '30d');
    expect(buf).toHaveLength(3);
    expect(buf[0]!.ts).toBe(1002);
    expect(buf[2]!.ts).toBe(1004);
    svc.dispose();
  });

  it('computes rank and percentile from a fixed fixture', async () => {
    // ATM IV values: 0.40, 0.50, 0.60, 0.70 — latest is 0.70 (richest).
    const svc = new IvHistoryService(
      {
        getSurfaceGrid: vi.fn(),
        dvol: mockDvol(),
      },
      { underlyings: ['BTC'], capacity: 100 },
    );
    const now = Date.now();
    const days = 24 * 3600 * 1000;
    for (let i = 0; i < 4; i++) {
      // snapshotOnce uses the interp on surfaces; we bypass by directly pushing via public API
      // using snapshotOnce with custom surfaces. Simpler: craft surfaces per iv step.
    }
    // Push by calling snapshotOnce with varying surfaces.
    const vols = [0.4, 0.5, 0.6, 0.7];
    for (let i = 0; i < vols.length; i++) {
      (svc as unknown as { deps: { getSurfaceGrid: (u: string) => Promise<IvSurfaceRow[]> } }).deps.getSurfaceGrid =
        () => Promise.resolve([makeRow('e', 30, vols[i]!, 0, 0)]);
      await svc.snapshotOnce(now - (vols.length - 1 - i) * days);
    }
    const res = svc.query('BTC', 30);
    const t30 = res.tenors['30d'];
    expect(t30.current.atmIv).toBeCloseTo(0.7, 6);
    expect(t30.min.atmIv).toBeCloseTo(0.4, 6);
    expect(t30.max.atmIv).toBeCloseTo(0.7, 6);
    // rank = (0.7 − 0.4) / (0.7 − 0.4) × 100 = 100.
    expect(t30.atmRank).toBeCloseTo(100, 6);
    // percentile = 4/4 × 100 = 100 (current is the max and counts itself).
    expect(t30.atmPercentile).toBeCloseTo(100, 6);
    svc.dispose();
  });

  it('seeds the 30d buffer from DvolService on start', async () => {
    const now = Date.now();
    const svc = new IvHistoryService(
      {
        getSurfaceGrid: () => Promise.resolve([]), // no live surface → snapshotOnce is a no-op
        dvol: mockDvol({
          history: {
            BTC: [
              [now - 2 * 24 * 3600 * 1000, 50],
              [now - 24 * 3600 * 1000, 55],
              [now, 60],
            ],
          },
        }),
      },
      { underlyings: ['BTC', 'ETH'], intervalMs: 60_000 },
    );
    await svc.start();
    const btc30 = svc.getBuffer('BTC', '30d');
    expect(btc30).toHaveLength(3);
    expect(btc30[0]!.atmIv).toBeCloseTo(0.5, 6);
    expect(btc30[2]!.atmIv).toBeCloseTo(0.6, 6);
    expect(btc30[0]!.rr25d).toBeNull();
    expect(btc30[0]!.bfly25d).toBeNull();

    expect(svc.getBuffer('BTC', '7d')).toHaveLength(0);
    expect(svc.getBuffer('BTC', '60d')).toHaveLength(0);
    expect(svc.getBuffer('BTC', '90d')).toHaveLength(0);
    expect(svc.getBuffer('ETH', '30d')).toHaveLength(0);
    svc.dispose();
  });

  it('loads persisted history before querying and before DVOL fallback', async () => {
    const now = Date.now();
    const { store } = mockStore({
      load: [
        {
          underlying: 'BTC',
          tenorDays: 30,
          ts: new Date(now - 60_000),
          atmIv: 0.41,
          rr25d: -0.03,
          bfly25d: 0.01,
          source: 'live_surface',
        },
      ],
    });
    const svc = new IvHistoryService(
      {
        getSurfaceGrid: () => Promise.resolve([]),
        dvol: mockDvol({
          history: {
            BTC: [[now - 2 * 60_000, 55]],
          },
        }),
        store,
      },
      { underlyings: ['BTC'], intervalMs: 60_000 },
    );

    await svc.start();

    expect(store.loadSince).toHaveBeenCalledWith({
      underlyings: ['BTC'],
      since: expect.any(Date),
    });
    const btc30 = svc.getBuffer('BTC', '30d');
    expect(btc30).toHaveLength(1);
    expect(btc30[0]!.atmIv).toBeCloseTo(0.41, 6);
    expect(btc30[0]!.rr25d).toBeCloseTo(-0.03, 6);
    svc.dispose();
  });

  it('persists DVOL seed when persisted BTC 30d history is absent', async () => {
    const now = Date.now();
    const { store, written } = mockStore();
    const svc = new IvHistoryService(
      {
        getSurfaceGrid: () => Promise.resolve([]),
        dvol: mockDvol({
          history: {
            BTC: [
              [now - 60_000, 50],
              [now, 51],
            ],
          },
        }),
        store,
      },
      { underlyings: ['BTC'], intervalMs: 60_000 },
    );

    await svc.start();

    expect(written).toHaveLength(2);
    expect(written.every((p) => p.source === 'deribit_dvol')).toBe(true);
    expect(written.every((p) => p.tenorDays === 30)).toBe(true);
    expect(written[0]!.atmIv).toBeCloseTo(0.5, 6);
    svc.dispose();
  });

  it('returns null rank/percentile when the window has < 2 samples', async () => {
    const surfaces = [makeRow('e', 30, 0.5, 0.02, 0.01)];
    const svc = new IvHistoryService(
      {
        getSurfaceGrid: () => Promise.resolve(surfaces),
        dvol: mockDvol(),
      },
      { underlyings: ['BTC'] },
    );
    await svc.snapshotOnce(Date.now());
    const res = svc.query('BTC', 30);
    const t30 = res.tenors['30d'];
    expect(t30.current.atmIv).toBeCloseTo(0.5, 6);
    expect(t30.atmRank).toBeNull();
    expect(t30.atmPercentile).toBeNull();
    expect(t30.rrRank).toBeNull();
    expect(t30.rrPercentile).toBeNull();
    svc.dispose();
  });

  it('returns null rank/percentile when all samples in the window are identical', async () => {
    const surfaces = [makeRow('e', 30, 0.5, 0.02, 0.01)];
    const svc = new IvHistoryService(
      {
        getSurfaceGrid: () => Promise.resolve(surfaces),
        dvol: mockDvol(),
      },
      { underlyings: ['BTC'] },
    );
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await svc.snapshotOnce(now - (4 - i) * 60_000);
    }
    const res = svc.query('BTC', 30);
    const t30 = res.tenors['30d'];
    expect(t30.series.length).toBe(5);
    expect(t30.atmRank).toBeNull();
    expect(t30.atmPercentile).toBeNull();
    svc.dispose();
  });

  it('overrides 30d ATM with DVOL live value for BTC/ETH (methodology alignment)', async () => {
    // Our surface interp would give 0.42; DVOL live says 0.44. The 30d buffer
    // should store 0.44 (matching the DVOL seed); 7d/60d/90d still use interp.
    const surfaces = [makeRow('e', 30, 0.42, 0.02, 0.01)];
    const svc = new IvHistoryService(
      {
        getSurfaceGrid: () => Promise.resolve(surfaces),
        dvol: mockDvol({ liveBtc: 0.44 }),
      },
      { underlyings: ['BTC'] },
    );
    await svc.snapshotOnce(Date.now());
    expect(svc.getBuffer('BTC', '30d')[0]!.atmIv).toBeCloseTo(0.44, 6);
    expect(svc.getBuffer('BTC', '7d')[0]!.atmIv).toBeCloseTo(0.42, 6);
    expect(svc.getBuffer('BTC', '60d')[0]!.atmIv).toBeCloseTo(0.42, 6);
    expect(svc.getBuffer('BTC', '90d')[0]!.atmIv).toBeCloseTo(0.42, 6);
    svc.dispose();
  });

  it('falls back to interp for 30d ATM when DVOL snapshot is unavailable', async () => {
    const surfaces = [makeRow('e', 30, 0.42, 0, 0)];
    const svc = new IvHistoryService(
      {
        getSurfaceGrid: () => Promise.resolve(surfaces),
        dvol: mockDvol(), // no live snapshot
      },
      { underlyings: ['BTC'] },
    );
    await svc.snapshotOnce(Date.now());
    expect(svc.getBuffer('BTC', '30d')[0]!.atmIv).toBeCloseTo(0.42, 6);
    svc.dispose();
  });

  it('computes RR and butterfly from per-tenor snapshots', async () => {
    // skew = +0.04 → RR at 30d should be +0.04; fly = +0.01.
    const surfaces = [makeRow('e', 30, 0.5, 0.04, 0.01)];
    const svc = new IvHistoryService(
      {
        getSurfaceGrid: () => Promise.resolve(surfaces),
        dvol: mockDvol(),
      },
      { underlyings: ['BTC'] },
    );
    await svc.snapshotOnce(Date.now());
    const buf = svc.getBuffer('BTC', '30d');
    expect(buf).toHaveLength(1);
    expect(buf[0]!.rr25d).toBeCloseTo(0.04, 6);
    expect(buf[0]!.bfly25d).toBeCloseTo(0.01, 6);
    svc.dispose();
  });

  it('persists live surface snapshots without blocking in-memory history on write failure', async () => {
    const surfaces = [makeRow('e', 30, 0.5, 0.04, 0.01)];
    const { store } = mockStore({ writeRejects: true });
    const svc = new IvHistoryService(
      {
        getSurfaceGrid: () => Promise.resolve(surfaces),
        dvol: mockDvol(),
        store,
      },
      { underlyings: ['BTC'] },
    );

    await expect(svc.snapshotOnce(Date.now())).resolves.toBeUndefined();

    expect(store.writeMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          underlying: 'BTC',
          tenorDays: 30,
          atmIv: 0.5,
          rr25d: expect.closeTo(0.04, 6),
          bfly25d: expect.closeTo(0.01, 6),
          source: 'live_surface',
        }),
      ]),
    );
    expect(svc.getBuffer('BTC', '30d')[0]!.rr25d).toBeCloseTo(0.04, 6);
    svc.dispose();
  });
});
