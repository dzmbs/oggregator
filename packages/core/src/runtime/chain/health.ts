import type { VenueConnectionState, VenueStatus } from '../../core/types.js';
import type { VenueId } from '../../types/common.js';

interface VenueHealthSources {
  transport: VenueStatus | null;
  health: VenueStatus | null;
  effective: VenueStatus | null;
  lastActivityTs: number | null;
}

function classifySource(status: VenueStatus): 'transport' | 'health' {
  if (status.state === 'reconnecting' || status.state === 'down' || status.state === 'polling') {
    return 'transport';
  }

  if (status.state === 'degraded') {
    return 'health';
  }

  return status.message != null ? 'health' : 'transport';
}

function sameStatus(left: VenueStatus | null, right: VenueStatus): boolean {
  return left?.state === right.state && left?.message === right.message;
}

const STALE_AFTER_MS = 3 * 60 * 1000;

function staleStatus(venue: VenueId, ts: number, now: number): VenueStatus {
  return {
    venue,
    state: 'degraded',
    ts: now,
    message: `stale for ${now - ts}ms`,
  };
}

function effectiveStatus(
  sources: VenueHealthSources,
  venue: VenueId,
  now: number,
): VenueStatus | null {
  const transport = sources.transport;
  const health = sources.health;

  if (transport?.state === 'down') return transport;
  if (transport?.state === 'reconnecting') return transport;
  if (transport?.state === 'polling') return transport;
  if (health?.state === 'degraded') return health;

  const freshnessTs = [sources.lastActivityTs, transport?.ts ?? null].reduce<number | null>(
    (latest, value) => {
      if (value == null) return latest;
      return latest == null ? value : Math.max(latest, value);
    },
    null,
  );

  if (freshnessTs != null && now - freshnessTs > STALE_AFTER_MS) {
    return staleStatus(venue, freshnessTs, now);
  }

  const connected = [transport, health]
    .filter((status): status is VenueStatus => status != null)
    .sort((left, right) => right.ts - left.ts)[0];

  if (connected != null) return connected;
  return { venue, state: 'down', ts: now, message: 'no health signals' };
}

export class VenueHealthManager {
  private readonly venues = new Map<VenueId, VenueHealthSources>();

  ingest(status: VenueStatus): VenueStatus | null {
    const current = this.venues.get(status.venue) ?? {
      transport: null,
      health: null,
      effective: null,
      lastActivityTs: null,
    };

    const source = classifySource(status);
    current[source] = status;

    const next = effectiveStatus(current, status.venue, Date.now());
    this.venues.set(status.venue, {
      ...current,
      effective: next,
    });

    if (next == null || sameStatus(current.effective, next)) {
      return null;
    }

    return next;
  }

  touch(venue: VenueId, ts = Date.now()): VenueStatus | null {
    const current = this.venues.get(venue) ?? {
      transport: null,
      health: null,
      effective: null,
      lastActivityTs: null,
    };

    current.lastActivityTs = ts;
    const next = effectiveStatus(current, venue, Date.now());
    this.venues.set(venue, {
      ...current,
      effective: next,
    });

    if (next == null || sameStatus(current.effective, next)) {
      return null;
    }

    return next;
  }

  get(venue: VenueId): VenueStatus | null {
    const current = this.venues.get(venue);
    if (current == null) return null;

    const next = effectiveStatus(current, venue, Date.now());
    current.effective = next;
    this.venues.set(venue, current);
    return next;
  }

  list(): VenueStatus[] {
    return [...this.venues.entries()]
      .map(([venue, entry]) => {
        const next = effectiveStatus(entry, venue, Date.now());
        entry.effective = next;
        this.venues.set(venue, entry);
        return next;
      })
      .filter((status): status is VenueStatus => status != null);
  }

  reset(): void {
    this.venues.clear();
  }
}

export type { VenueConnectionState };
