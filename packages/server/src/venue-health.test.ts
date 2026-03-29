import { describe, expect, it, vi } from 'vitest';
import { VenueHealthManager } from './venue-health.js';

describe('VenueHealthManager', () => {
  it('keeps reconnecting transport above healthy probes', () => {
    const manager = new VenueHealthManager();

    manager.ingest({ venue: 'deribit', state: 'connected', ts: 1 });
    manager.ingest({ venue: 'deribit', state: 'connected', ts: 2, message: 'platform healthy' });
    const status = manager.ingest({ venue: 'deribit', state: 'reconnecting', ts: 3, message: 'transport closed' });

    expect(status?.state).toBe('reconnecting');
    expect(manager.get('deribit')?.state).toBe('reconnecting');
  });

  it('keeps degraded health above connected transport', () => {
    const manager = new VenueHealthManager();

    manager.ingest({ venue: 'okx', state: 'connected', ts: 1 });
    const status = manager.ingest({ venue: 'okx', state: 'degraded', ts: 2, message: 'maintenance' });

    expect(status?.state).toBe('degraded');
    expect(manager.get('okx')?.message).toBe('maintenance');
  });

  it('suppresses duplicate effective states', () => {
    const manager = new VenueHealthManager();
    const now = Date.now();

    const first = manager.ingest({ venue: 'binance', state: 'connected', ts: now, message: 'rest health ok' });
    const second = manager.ingest({ venue: 'binance', state: 'connected', ts: now + 1, message: 'rest health ok' });

    expect(first?.state).toBe('connected');
    expect(second).toBeNull();
  });

  it('degrades stale venues when no status or activity arrives for too long', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const manager = new VenueHealthManager();
    manager.ingest({ venue: 'derive', state: 'connected', ts: 0 });

    vi.setSystemTime(3 * 60 * 1000 + 1);
    const status = manager.get('derive');

    expect(status?.state).toBe('degraded');
    expect(status?.message).toBe('stale for 180001ms');

    vi.useRealTimers();
  });

  it('does not let health probes hide a stale data feed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const manager = new VenueHealthManager();
    manager.ingest({ venue: 'deribit', state: 'connected', ts: 0 });
    manager.touch('deribit', 0);

    vi.setSystemTime(60_000);
    manager.ingest({ venue: 'deribit', state: 'connected', ts: 60_000, message: 'probe healthy' });

    vi.setSystemTime(3 * 60 * 1000 + 1);
    const status = manager.get('deribit');

    expect(status?.state).toBe('degraded');
    expect(status?.message).toBe('stale for 180001ms');

    vi.useRealTimers();
  });

  it('keeps active venues healthy when deltas continue arriving', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const manager = new VenueHealthManager();
    manager.ingest({ venue: 'okx', state: 'connected', ts: 0 });

    vi.setSystemTime(2 * 60 * 1000);
    manager.touch('okx', Date.now());

    vi.setSystemTime(3 * 60 * 1000 + 1);
    expect(manager.get('okx')?.state).toBe('connected');

    vi.useRealTimers();
  });
});
