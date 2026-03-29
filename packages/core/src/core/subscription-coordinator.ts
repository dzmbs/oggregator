import type { OptionVenueAdapter, StreamHandlers } from '../feeds/shared/types.js';
import { getAdapter } from './registry.js';
import type { ChainRequest, VenueDelta, VenueStatus } from './types.js';
import type { VenueId } from '../types/common.js';

export interface VenueSubscriptionListener {
  onDelta?: (deltas: VenueDelta[]) => void;
  onStatus?: (status: VenueStatus) => void;
}

export interface VenueSubscriptionHandle {
  release(): Promise<void>;
}

interface CoordinatedRequestEntry {
  request: ChainRequest;
  refCount: number;
  listeners: Set<VenueSubscriptionListener>;
  upstreamRelease: () => Promise<void>;
}

interface CoordinatedVenueEntry {
  handlers: StreamHandlers;
  requestEntries: Map<string, CoordinatedRequestEntry>;
}

interface SubscriptionCoordinatorOptions {
  getAdapter?: (venue: VenueId) => OptionVenueAdapter;
}

function requestKey(request: ChainRequest): string {
  return `${request.underlying}:${request.expiry}`;
}

/** Extracts "BASE:YYYY-MM-DD" from canonical symbol format "BASE/QUOTE:CONTRACT-YYMMDD-..." */
function symbolRequestKey(symbol: string): string | null {
  const slashIndex = symbol.indexOf('/');
  const colonIndex = symbol.indexOf(':');
  if (slashIndex <= 0 || colonIndex <= slashIndex + 1) return null;

  const base = symbol.slice(0, slashIndex);
  const contract = symbol.slice(colonIndex + 1);
  const firstDash = contract.indexOf('-');
  const EXPIRY_CODE_LENGTH = 6; // YYMMDD
  if (firstDash <= 0 || contract.length < firstDash + 1 + EXPIRY_CODE_LENGTH) return null;

  const expiryCode = contract.slice(firstDash + 1, firstDash + 1 + EXPIRY_CODE_LENGTH);
  for (const char of expiryCode) {
    if (char < '0' || char > '9') return null;
  }

  // YYMMDD → 20YY-MM-DD
  const yy = expiryCode.slice(0, 2);
  const mm = expiryCode.slice(2, 4);
  const dd = expiryCode.slice(4, 6);
  return `${base}:20${yy}-${mm}-${dd}`;
}

export class VenueSubscriptionCoordinator {
  private readonly venueEntries = new Map<VenueId, CoordinatedVenueEntry>();
  private readonly pendingVenueOperations = new Map<VenueId, Promise<void>>();
  private readonly resolveAdapter: (venue: VenueId) => OptionVenueAdapter;

  constructor(options: SubscriptionCoordinatorOptions = {}) {
    this.resolveAdapter = options.getAdapter ?? getAdapter;
  }

  async acquire(
    venue: VenueId,
    request: ChainRequest,
    listener?: VenueSubscriptionListener,
  ): Promise<VenueSubscriptionHandle> {
    await this.runVenueOperation(venue, async () => {
      const entry = this.getOrCreateVenueEntry(venue);
      const key = requestKey(request);
      const requestEntry = entry.requestEntries.get(key);

      if (requestEntry != null) {
        requestEntry.refCount += 1;
        if (listener != null) requestEntry.listeners.add(listener);
        return;
      }

      const adapter = this.resolveAdapter(venue);
      const upstreamRelease =
        adapter.subscribe != null
          ? await adapter.subscribe(request, entry.handlers)
          : async () => {};

      entry.requestEntries.set(key, {
        request,
        refCount: 1,
        listeners: listener != null ? new Set([listener]) : new Set(),
        upstreamRelease,
      });
    });

    let released = false;

    return {
      release: async () => {
        if (released) return;
        released = true;
        await this.release(venue, request, listener);
      },
    };
  }

  async dispose(): Promise<void> {
    for (const venue of this.venueEntries.keys()) {
      await this.runVenueOperation(venue, async () => {
        const entry = this.venueEntries.get(venue);
        if (entry == null) return;

        this.venueEntries.delete(venue);
        const requestEntries = [...entry.requestEntries.values()];
        entry.requestEntries.clear();

        await Promise.allSettled(
          requestEntries.map(async (requestEntry) => requestEntry.upstreamRelease()),
        );
      });
    }
  }

  private async release(
    venue: VenueId,
    request: ChainRequest,
    listener?: VenueSubscriptionListener,
  ): Promise<void> {
    await this.runVenueOperation(venue, async () => {
      const entry = this.venueEntries.get(venue);
      if (entry == null) return;

      const key = requestKey(request);
      const requestEntry = entry.requestEntries.get(key);
      if (requestEntry == null) return;

      if (listener != null) requestEntry.listeners.delete(listener);
      requestEntry.refCount -= 1;

      if (requestEntry.refCount > 0) {
        return;
      }

      entry.requestEntries.delete(key);
      await requestEntry.upstreamRelease();

      if (entry.requestEntries.size === 0) {
        this.venueEntries.delete(venue);
      }
    });
  }

  private getOrCreateVenueEntry(venue: VenueId): CoordinatedVenueEntry {
    const existing = this.venueEntries.get(venue);
    if (existing != null) return existing;

    const entry: CoordinatedVenueEntry = {
      requestEntries: new Map(),
      handlers: {
        onDelta: (deltas: VenueDelta[]) => {
          const currentEntry = this.venueEntries.get(venue);
          if (currentEntry == null) return;

          const grouped = new Map<string, VenueDelta[]>();
          for (const delta of deltas) {
            const key = symbolRequestKey(delta.symbol);
            if (key == null) continue;
            const group = grouped.get(key);
            if (group != null) {
              group.push(delta);
            } else {
              grouped.set(key, [delta]);
            }
          }

          for (const [key, matchedDeltas] of grouped) {
            const requestEntry = currentEntry.requestEntries.get(key);
            if (requestEntry == null) continue;
            for (const currentListener of requestEntry.listeners) {
              try {
                currentListener.onDelta?.(matchedDeltas);
              } catch {}
            }
          }
        },
        onStatus: (status: VenueStatus) => {
          const currentEntry = this.venueEntries.get(venue);
          if (currentEntry == null) return;

          for (const requestEntry of currentEntry.requestEntries.values()) {
            for (const currentListener of requestEntry.listeners) {
              try {
                currentListener.onStatus?.(status);
              } catch {}
            }
          }
        },
      },
    };

    this.venueEntries.set(venue, entry);
    return entry;
  }

  private async runVenueOperation(venue: VenueId, operation: () => Promise<void>): Promise<void> {
    const previous = this.pendingVenueOperations.get(venue) ?? Promise.resolve();
    const next = previous.then(operation);
    const guarded = next.finally(() => {
      if (this.pendingVenueOperations.get(venue) === guarded) {
        this.pendingVenueOperations.delete(venue);
      }
    });

    this.pendingVenueOperations.set(venue, guarded);
    await guarded;
  }
}
