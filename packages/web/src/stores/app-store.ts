import { create } from "zustand";

import { VENUE_IDS } from "@lib/venue-meta";

interface AppState {
  // Asset / expiry selection
  underlying:    string;
  expiry:        string;
  // Active tab
  activeTab:     "chain" | "surface" | "gex";
  // Venue filter
  activeVenues:  string[];
  // User's custom IV for edge column
  myIv:          string; // string so input is controlled cleanly; parse to float on use

  setUnderlying:   (u: string) => void;
  setExpiry:       (e: string) => void;
  setActiveTab:    (t: "chain" | "surface" | "gex") => void;
  toggleVenue:     (venueId: string) => void;
  setActiveVenues:  (venues: string[]) => void;
  setMyIv:         (iv: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  underlying:   "BTC",
  expiry:       "",
  activeTab:    "chain",
  activeVenues: [...VENUE_IDS],
  myIv:         "",

  // Changing underlying invalidates the current expiry — force re-selection
  setUnderlying: (underlying) => set({ underlying, expiry: "" }),
  setExpiry:     (expiry)     => set({ expiry }),
  setActiveTab:  (activeTab)  => set({ activeTab }),
  toggleVenue: (venueId) =>
    set((s) => {
      const active = s.activeVenues.includes(venueId)
        ? s.activeVenues.filter((v) => v !== venueId)
        : [...s.activeVenues, venueId];
      // Always keep at least one venue active
      return { activeVenues: active.length > 0 ? active : s.activeVenues };
    }),
  setActiveVenues: (venues) => set({ activeVenues: venues.length > 0 ? venues : VENUE_IDS.slice() }),
  setMyIv: (myIv) => set({ myIv }),
}));
