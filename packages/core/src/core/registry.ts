import type { OptionVenueAdapter } from '../feeds/shared/types.js';
import type { VenueId } from '../types/common.js';

const adapters = new Map<VenueId, OptionVenueAdapter>();

export function registerAdapter(adapter: OptionVenueAdapter): void {
  adapters.set(adapter.venue, adapter);
}

export function getAdapter(venue: VenueId): OptionVenueAdapter {
  const adapter = adapters.get(venue);
  if (!adapter) throw new Error(`No adapter registered for venue: ${venue}`);
  return adapter;
}

export function getAllAdapters(): OptionVenueAdapter[] {
  return Array.from(adapters.values());
}

export function getRegisteredVenues(): VenueId[] {
  return Array.from(adapters.keys());
}
