import { create } from 'zustand';

import type { WsConnectionState } from '@oggregator/protocol';
import { VENUE_IDS } from '@lib/venue-meta';

export interface FeedStatus {
  connectionState: WsConnectionState;
  failedVenueCount: number;
  /** Age of the most recent snapshot in ms — proxy for data freshness. */
  staleMs: number | null;
}

interface AppState {
  // Asset / expiry selection
  underlying: string;
  expiry: string;
  // Active tab
  activeTab: 'chain' | 'surface' | 'gex' | 'flow' | 'analytics' | 'architect';
  // Venue filter
  activeVenues: string[];
  // User's custom IV for edge column
  myIv: string; // string so input is controlled cleanly; parse to float on use
  feedStatus: FeedStatus;

  setUnderlying: (u: string) => void;
  setExpiry: (e: string) => void;
  setActiveTab: (t: 'chain' | 'surface' | 'gex' | 'flow' | 'analytics' | 'architect') => void;
  toggleVenue: (venueId: string) => void;
  setActiveVenues: (venues: string[]) => void;
  setMyIv: (iv: string) => void;
  setFeedStatus: (s: Partial<FeedStatus>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  underlying: 'BTC',
  expiry: '',
  activeTab: 'chain',
  activeVenues: [...VENUE_IDS],
  myIv: '',
  feedStatus: { connectionState: 'closed', failedVenueCount: 0, staleMs: null },

  // Changing underlying invalidates the current expiry — force re-selection
  setUnderlying: (underlying) => set({ underlying, expiry: '' }),
  setExpiry: (expiry) => set({ expiry }),
  setActiveTab: (activeTab) => set({ activeTab }),
  toggleVenue: (venueId) =>
    set((s) => {
      const active = s.activeVenues.includes(venueId)
        ? s.activeVenues.filter((v) => v !== venueId)
        : [...s.activeVenues, venueId];
      // Always keep at least one venue active
      return { activeVenues: active.length > 0 ? active : s.activeVenues };
    }),
  setActiveVenues: (venues) =>
    set({ activeVenues: venues.length > 0 ? venues : VENUE_IDS.slice() }),
  setMyIv: (myIv) => set({ myIv }),
  setFeedStatus: (s) => set((prev) => ({ feedStatus: { ...prev.feedStatus, ...s } })),
}));
