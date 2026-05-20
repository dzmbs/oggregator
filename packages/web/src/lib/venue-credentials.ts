import type { VenueCredentials, VenueId } from '@oggregator/protocol';

const STORAGE_PREFIX = 'venueCreds_';

function storageKey(venue: VenueId): string {
  return `${STORAGE_PREFIX}${venue}`;
}

export function loadVenueCreds(venue: VenueId): VenueCredentials | null {
  try {
    const raw = localStorage.getItem(storageKey(venue));
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as VenueCredentials;
    return parsed.venue === venue ? parsed : null;
  } catch {
    return null;
  }
}

export function loadAllVenueCreds(venues: readonly VenueId[]): Partial<Record<VenueId, VenueCredentials>> {
  const out: Partial<Record<VenueId, VenueCredentials>> = {};
  for (const venue of venues) {
    const creds = loadVenueCreds(venue);
    if (creds != null) out[venue] = creds;
  }
  return out;
}

export function saveVenueCreds(creds: VenueCredentials): void {
  try {
    localStorage.setItem(storageKey(creds.venue), JSON.stringify(creds));
  } catch {}
}

export function removeVenueCreds(venue: VenueId): void {
  try {
    localStorage.removeItem(storageKey(venue));
  } catch {}
}
