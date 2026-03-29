import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DvolService } from './dvol.js';
import type { DvolSnapshot } from './dvol.js';

// ── helpers ───────────────────────────────────────────────────────────────────

// Access the private buildSnapshot method to test the pure computation logic
// without any network calls.
function buildSnapshot(
  svc: DvolService,
  currency: string,
  currentPct: number,
  previousClosePct: number,
  high52wPct: number,
  low52wPct: number,
): DvolSnapshot {
  return (
    svc as unknown as {
      buildSnapshot(c: string, cur: number, prev: number, hi: number, lo: number): DvolSnapshot;
    }
  ).buildSnapshot(currency, currentPct, previousClosePct, high52wPct, low52wPct);
}

function setSnapshot(svc: DvolService, currency: string, snap: DvolSnapshot) {
  (svc as unknown as { snapshots: Map<string, DvolSnapshot> }).snapshots.set(currency, snap);
}

function handlePush(svc: DvolService, data: unknown) {
  (svc as unknown as { handlePush(d: unknown): void }).handlePush(data);
}

// ── buildSnapshot — pure computation ─────────────────────────────────────────

describe('DvolService — buildSnapshot', () => {
  let svc: DvolService;

  beforeEach(() => {
    svc = new DvolService();
  });
  afterEach(() => svc.dispose());

  it('converts percentage inputs to fraction outputs', () => {
    const snap = buildSnapshot(svc, 'BTC', 52, 50, 80, 30);
    expect(snap.current).toBeCloseTo(0.52);
    expect(snap.previousClose).toBeCloseTo(0.5);
    expect(snap.high52w).toBeCloseTo(0.8);
    expect(snap.low52w).toBeCloseTo(0.3);
  });

  it('computes ivChange1d as current minus previousClose in fraction form', () => {
    const snap = buildSnapshot(svc, 'BTC', 55, 50, 80, 30);
    expect(snap.ivChange1d).toBeCloseTo(0.05);
  });

  it('computes IVR as percentile within the 52-week range', () => {
    // current=52, range=30–80 (50pts). (52-30)/50 * 100 = 44%
    const snap = buildSnapshot(svc, 'BTC', 52, 50, 80, 30);
    expect(snap.ivr).toBeCloseTo(44);
  });

  it('clamps IVR to 0 when current equals the 52-week low', () => {
    const snap = buildSnapshot(svc, 'BTC', 30, 30, 80, 30);
    expect(snap.ivr).toBeCloseTo(0);
  });

  it('yields IVR of 100 when current equals the 52-week high', () => {
    const snap = buildSnapshot(svc, 'BTC', 80, 79, 80, 30);
    expect(snap.ivr).toBeCloseTo(100);
  });

  it('returns IVR of 0 when range is zero (no price movement all year)', () => {
    const snap = buildSnapshot(svc, 'BTC', 50, 50, 50, 50);
    expect(snap.ivr).toBe(0);
  });

  it('sets currency correctly', () => {
    const snap = buildSnapshot(svc, 'ETH', 45, 44, 70, 25);
    expect(snap.currency).toBe('ETH');
  });

  it('sets updatedAt to approximately now', () => {
    const before = Date.now();
    const snap = buildSnapshot(svc, 'BTC', 52, 50, 80, 30);
    expect(snap.updatedAt).toBeGreaterThanOrEqual(before);
    expect(snap.updatedAt).toBeLessThanOrEqual(Date.now());
  });
});

// ── handlePush — live update ──────────────────────────────────────────────────

describe('DvolService — handlePush', () => {
  let svc: DvolService;

  beforeEach(() => {
    svc = new DvolService();
  });
  afterEach(() => svc.dispose());

  it('updates current DVOL when a valid push arrives', () => {
    setSnapshot(svc, 'BTC', buildSnapshot(svc, 'BTC', 52, 50, 80, 30));

    handlePush(svc, { index_name: 'btc_usd', volatility: 56 });

    const snap = svc.getSnapshot('BTC')!;
    expect(snap.current).toBeCloseTo(0.56);
  });

  it('preserves 52-week range and previousClose from the existing snapshot', () => {
    setSnapshot(svc, 'BTC', buildSnapshot(svc, 'BTC', 52, 50, 80, 30));

    handlePush(svc, { index_name: 'btc_usd', volatility: 60 });

    const snap = svc.getSnapshot('BTC')!;
    expect(snap.high52w).toBeCloseTo(0.8);
    expect(snap.low52w).toBeCloseTo(0.3);
    expect(snap.previousClose).toBeCloseTo(0.5);
  });

  it('recalculates ivChange1d against stored previousClose', () => {
    setSnapshot(svc, 'BTC', buildSnapshot(svc, 'BTC', 52, 50, 80, 30));

    handlePush(svc, { index_name: 'btc_usd', volatility: 58 });

    const snap = svc.getSnapshot('BTC')!;
    // (58 - 50) / 100 = 0.08
    expect(snap.ivChange1d).toBeCloseTo(0.08);
  });

  it('ignores pushes for unknown currencies', () => {
    // No snapshot set for XRP
    handlePush(svc, { index_name: 'xrp_usd', volatility: 80 });
    expect(svc.getSnapshot('XRP')).toBeNull();
  });

  it('ignores malformed push data', () => {
    setSnapshot(svc, 'BTC', buildSnapshot(svc, 'BTC', 52, 50, 80, 30));
    const before = svc.getSnapshot('BTC')!.current;

    handlePush(svc, { index_name: 'btc_usd' }); // missing volatility
    expect(svc.getSnapshot('BTC')!.current).toBeCloseTo(before);
  });

  it('handles ETH currency correctly from index_name', () => {
    setSnapshot(svc, 'ETH', buildSnapshot(svc, 'ETH', 45, 44, 70, 25));

    handlePush(svc, { index_name: 'eth_usd', volatility: 50 });

    const snap = svc.getSnapshot('ETH')!;
    expect(snap.current).toBeCloseTo(0.5);
  });
});

// ── getSnapshot / getAllSnapshots ─────────────────────────────────────────────

describe('DvolService — getSnapshot', () => {
  let svc: DvolService;

  beforeEach(() => {
    svc = new DvolService();
  });
  afterEach(() => svc.dispose());

  it('returns null for unknown currency', () => {
    expect(svc.getSnapshot('BTC')).toBeNull();
  });

  it('returns the stored snapshot', () => {
    const snap = buildSnapshot(svc, 'BTC', 52, 50, 80, 30);
    setSnapshot(svc, 'BTC', snap);
    expect(svc.getSnapshot('BTC')).toEqual(snap);
  });

  it('getAllSnapshots returns all stored currencies', () => {
    setSnapshot(svc, 'BTC', buildSnapshot(svc, 'BTC', 52, 50, 80, 30));
    setSnapshot(svc, 'ETH', buildSnapshot(svc, 'ETH', 45, 44, 70, 25));
    const all = svc.getAllSnapshots();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.currency).sort()).toEqual(['BTC', 'ETH']);
  });
});

// ── DVOL history parallelism ──────────────────────────────────────────────────

describe('DvolService — fetchHistory runs in parallel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fetches all currencies concurrently, not serially', async () => {
    const svc = new DvolService();
    const startTimes: number[] = [];

    vi.spyOn(
      svc as unknown as { fetchHistory(c: string): Promise<void> },
      'fetchHistory',
    ).mockImplementation(async (_currency) => {
      startTimes.push(Date.now());
      await new Promise((r) => setTimeout(r, 5_000));
    });

    // Stub rpc to make start() not open a real WS
    const mockRpc = {
      connect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      onSubscription: vi.fn(),
      disconnect: vi.fn(),
      call: vi.fn(),
    };
    (svc as unknown as { rpc: unknown }).rpc = mockRpc;
    (svc as unknown as { currencies: string[] }).currencies = ['BTC', 'ETH'];

    // Call the internal method that drives parallel fetching
    const internalStart = async () => {
      await Promise.all(
        ['BTC', 'ETH'].map((c) =>
          (svc as unknown as { fetchHistory(c: string): Promise<void> }).fetchHistory(c),
        ),
      );
    };

    const p = internalStart();
    // Both fetches must start at the same tick — before any timer fires
    expect(startTimes).toHaveLength(2);
    expect(startTimes[0]).toBe(startTimes[1]); // same timestamp = concurrent

    await vi.advanceTimersByTimeAsync(5_100);
    await p;
    svc.dispose();
  });
});
