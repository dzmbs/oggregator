import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

// Mutated per-test to control which services succeed or fail.
// Declared before vi.mock because the factory closes over this object;
// Vitest evaluates the factory lazily on re-import, after the variable exists.
const startResolves = { dvol: true, spot: true, flow: true, ivHistory: true };

vi.mock('@oggregator/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@oggregator/core')>();
  return {
    ...real,
    // Arrow functions are not `new`-compatible — use class syntax so services.ts
    // can call `new DvolService()` etc. without a "not a constructor" error.
    DvolService: class {
      start() {
        return startResolves.dvol ? Promise.resolve() : Promise.reject(new Error('dvol boom'));
      }
      dispose() {}
      getSnapshot() {
        return null;
      }
      getAllSnapshots() {
        return [];
      }
    },
    SpotRuntime: class {
      start() {
        return startResolves.spot ? Promise.resolve() : Promise.reject(new Error('spot boom'));
      }
      dispose() {}
      getSnapshot() {
        return null;
      }
    },
    TradeRuntime: class {
      start() {
        return startResolves.flow ? Promise.resolve() : Promise.reject(new Error('flow boom'));
      }
      dispose() {}
      getTrades() {
        return [];
      }
    },
    BlockTradeRuntime: class {
      start() {
        return Promise.resolve();
      }
      dispose() {}
      getTrades() {
        return [];
      }
      getHealth() {
        return [];
      }
    },
    IvHistoryService: class {
      start() {
        return startResolves.ivHistory
          ? Promise.resolve()
          : Promise.reject(new Error('iv history boom'));
      }
      dispose() {}
    },
    buildIvSurfaceGrid: vi.fn(() => Promise.resolve([])),
  };
});

describe('bootstrapServices — readiness transitions', () => {
  // vi.resetModules() gives each test a fresh serviceHealth={false,false,false}.
  // The vi.mock registration persists across resets, so re-importing services.js
  // still uses the mocked classes with the current startResolves values.
  beforeEach(() => {
    startResolves.dvol = true;
    startResolves.spot = true;
    startResolves.flow = true;
    startResolves.ivHistory = true;
    vi.resetModules();
  });

  it('marks all services ready after all start() calls resolve', async () => {
    const { bootstrapServices, isDvolReady, isSpotReady, isFlowReady, isIvHistoryReady } =
      await import('./services.js');

    await bootstrapServices({ info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger);

    expect(isDvolReady()).toBe(true);
    expect(isSpotReady()).toBe(true);
    expect(isFlowReady()).toBe(true);
    expect(isIvHistoryReady()).toBe(true);
  });

  it('all services are not ready before bootstrapServices is called', async () => {
    const { isDvolReady, isSpotReady, isFlowReady, isIvHistoryReady } = await import(
      './services.js'
    );
    expect(isDvolReady()).toBe(false);
    expect(isSpotReady()).toBe(false);
    expect(isFlowReady()).toBe(false);
    expect(isIvHistoryReady()).toBe(false);
  });

  it('leaves flow as not ready when flow start() rejects', async () => {
    startResolves.flow = false;
    const { bootstrapServices, isDvolReady, isSpotReady, isFlowReady } = await import(
      './services.js'
    );

    await bootstrapServices({ info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger);

    expect(isDvolReady()).toBe(true);
    expect(isSpotReady()).toBe(true);
    expect(isFlowReady()).toBe(false);
  });

  it('logs a warning (not throws) when a service fails', async () => {
    startResolves.dvol = false;
    const { bootstrapServices } = await import('./services.js');
    const infoFn = vi.fn();
    const warnFn = vi.fn();
    const log = { info: infoFn, warn: warnFn } as unknown as FastifyBaseLogger;

    await expect(bootstrapServices(log)).resolves.toBeUndefined();
    expect(warnFn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.stringContaining('dvol boom') }),
      expect.any(String),
    );
  });

  it('logs a summary including elapsed time', async () => {
    const { bootstrapServices } = await import('./services.js');
    const infoFn = vi.fn();
    const log = { info: infoFn, warn: vi.fn() } as unknown as FastifyBaseLogger;
    await bootstrapServices(log);

    const summaryCall = infoFn.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === 'object' && args[0] !== null && 'ms' in (args[0] as object),
    );
    expect(summaryCall).toBeDefined();
    expect((summaryCall![0] as { ms: number }).ms).toBeGreaterThanOrEqual(0);
  });
});
