import { useEffect, useRef } from 'react';

import { DEFAULT_TAB, slugFromTabId, tabIdFromSlug } from '@lib/tabs';
import { useAppStore } from '@stores/app-store';

// Bidirectional sync between `location.hash` and `activeTab`.
// Hash → store on mount and on `hashchange` (back/forward, manual edits).
// Store → hash on tab change. Initial sync uses `replaceState` so the
// landing entry isn't duplicated; subsequent changes use `pushState` so
// the back button navigates between tabs.
export function useTabUrlSync(): void {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const initialMount = useRef(true);

  useEffect(() => {
    const apply = () => {
      const slug = window.location.hash.replace(/^#/, '');
      const next = tabIdFromSlug(slug) ?? DEFAULT_TAB;
      if (next !== useAppStore.getState().activeTab) {
        setActiveTab(next);
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [setActiveTab]);

  useEffect(() => {
    const desired = `#${slugFromTabId(activeTab)}`;
    if (window.location.hash === desired) {
      initialMount.current = false;
      return;
    }
    const url = `${window.location.pathname}${window.location.search}${desired}`;
    if (initialMount.current) {
      window.history.replaceState(null, '', url);
    } else {
      window.history.pushState(null, '', url);
    }
    initialMount.current = false;
  }, [activeTab]);
}
