import { create } from 'zustand';

import {
  VENUE_IDS as PROTOCOL_VENUE_IDS,
  type VenueCredentials,
  type VenueFailure,
  type VenueId,
  type WsConnectionState,
} from '@oggregator/protocol';
import type { TabId } from '@lib/tabs';
import { VENUE_IDS } from '@lib/venue-meta';
import {
  loadAllVenueCreds,
  removeVenueCreds as storageRemoveVenueCreds,
  saveVenueCreds as storageSaveVenueCreds,
} from '@lib/venue-credentials';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export interface FeedStatus {
  connectionState: WsConnectionState;
  failedVenueCount: number;
  failedVenueIds: string[];
  failedVenues: VenueFailure[];
  /** Age of the most recent snapshot in ms — proxy for data freshness. */
  staleMs: number | null;
  /** Epoch ms when the last live snapshot/delta arrived. */
  lastUpdateMs: number | null;
}

export type SessionNoticeKind = 'server-updated' | 'idle-warning' | 'idle-logout';

export interface SessionNotice {
  kind: SessionNoticeKind;
  /** Only set for 'idle-warning' — epoch ms when hard logout will fire. */
  autoLogoutAtMs?: number;
}

interface AppState {
  underlying: string;
  expiry: string;
  activeTab: TabId;
  activeVenues: string[];
  myIv: string;
  feedStatus: FeedStatus;
  apiKey: string | null;
  userId: string | null;
  accountId: string | null;
  venueCreds: Partial<Record<VenueId, VenueCredentials>>;
  soundEnabled: boolean;
  sessionNotice: SessionNotice | null;
  /** Monotonic counter — incremented by the warning dialog's "Stay active" button
   * so the idle-timeout hook can observe the request and cancel pending timers. */
  sessionExtendToken: number;

  setUnderlying: (u: string) => void;
  setExpiry: (e: string) => void;
  setActiveTab: (t: TabId) => void;
  toggleVenue: (venueId: string) => void;
  setActiveVenues: (venues: string[]) => void;
  setMyIv: (iv: string) => void;
  setFeedStatus: (s: Partial<FeedStatus>) => void;
  setAuth: (apiKey: string, userId: string, accountId: string) => void;
  clearAuth: () => void;
  setVenueCreds: (creds: VenueCredentials) => void;
  removeVenueCreds: (venue: VenueId) => void;
  setSessionNotice: (notice: SessionNotice | null) => void;
  extendSession: () => void;
  setSoundEnabled: (enabled: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  underlying: 'BTC',
  expiry: '',
  activeTab: 'chain',
  activeVenues: [...VENUE_IDS],
  myIv: '',
  feedStatus: {
    connectionState: 'closed',
    failedVenueCount: 0,
    failedVenueIds: [],
    failedVenues: [],
    staleMs: null,
    lastUpdateMs: null,
  },
  apiKey: readStorage('paperApiKey'),
  userId: readStorage('paperUserId'),
  accountId: readStorage('paperAccountId'),
  venueCreds: loadAllVenueCreds(PROTOCOL_VENUE_IDS),
  soundEnabled: readStorage('tapeSoundEnabled') === '1',
  sessionNotice: null,
  sessionExtendToken: 0,

  setUnderlying: (underlying) => set({ underlying, expiry: '' }),
  setExpiry: (expiry) => set({ expiry }),
  setActiveTab: (activeTab) => set({ activeTab }),
  toggleVenue: (venueId) =>
    set((s) => {
      const active = s.activeVenues.includes(venueId)
        ? s.activeVenues.filter((v) => v !== venueId)
        : [...s.activeVenues, venueId];
      return { activeVenues: active.length > 0 ? active : s.activeVenues };
    }),
  setActiveVenues: (venues) =>
    set({ activeVenues: venues.length > 0 ? venues : VENUE_IDS.slice() }),
  setMyIv: (myIv) => set({ myIv }),
  setFeedStatus: (s) => set((prev) => ({ feedStatus: { ...prev.feedStatus, ...s } })),
  setAuth: (apiKey, userId, accountId) => {
    localStorage.setItem('paperApiKey', apiKey);
    localStorage.setItem('paperUserId', userId);
    localStorage.setItem('paperAccountId', accountId);
    set({ apiKey, userId, accountId });
  },
  clearAuth: () => {
    localStorage.removeItem('paperApiKey');
    localStorage.removeItem('paperUserId');
    localStorage.removeItem('paperAccountId');
    set({ apiKey: null, userId: null, accountId: null });
  },
  setVenueCreds: (creds) => {
    storageSaveVenueCreds(creds);
    set((s) => ({ venueCreds: { ...s.venueCreds, [creds.venue]: creds } }));
  },
  removeVenueCreds: (venue) => {
    storageRemoveVenueCreds(venue);
    set((s) => {
      const next = { ...s.venueCreds };
      delete next[venue];
      return { venueCreds: next };
    });
  },
  setSessionNotice: (sessionNotice) => set({ sessionNotice }),
  extendSession: () => set((s) => ({ sessionExtendToken: s.sessionExtendToken + 1 })),
  setSoundEnabled: (enabled) => {
    if (enabled) localStorage.setItem('tapeSoundEnabled', '1');
    else localStorage.removeItem('tapeSoundEnabled');
    set({ soundEnabled: enabled });
  },
}));
