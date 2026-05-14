import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveGateioHealth, type GateioHealthInput } from './health.js';

describe('Gate.io health', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
  });

  it('is connected when REST probe succeeds and no WS errors are open', () => {
    const input: GateioHealthInput = {
      restOk: true,
      restLatencyMs: 320,
      lastWsError: null,
      lastUpdateAt: Date.now(),
    };
    expect(deriveGateioHealth(input).state).toBe('connected');
  });

  it('is degraded when REST is ok but a recent WS error is present', () => {
    const input: GateioHealthInput = {
      restOk: true,
      restLatencyMs: 320,
      lastWsError: { code: 2, message: 'invalid argument', at: Date.now() },
      lastUpdateAt: Date.now() - 60_000,
    };
    expect(deriveGateioHealth(input).state).toBe('degraded');
  });

  it('clears degraded state after the 30s grace window passes', () => {
    const input: GateioHealthInput = {
      restOk: true,
      restLatencyMs: 320,
      lastWsError: { code: 2, message: 'invalid argument', at: Date.now() - 31_000 },
      lastUpdateAt: Date.now(),
    };
    expect(deriveGateioHealth(input).state).toBe('connected');
  });

  it('is down when REST is failing', () => {
    const input: GateioHealthInput = {
      restOk: false,
      restLatencyMs: 0,
      lastWsError: null,
      lastUpdateAt: 0,
    };
    expect(deriveGateioHealth(input).state).toBe('down');
  });
});
