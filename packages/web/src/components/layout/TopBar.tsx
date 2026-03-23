import { useAppStore } from "@stores/app-store";
import { VenueIndicator } from "@components/ui";
import VenueSidebar from "@features/chain/VenueSidebar";

import styles from "./TopBar.module.css";

interface Tab {
  id:     string;
  label:  string;
  badge?: string;
}

interface TopBarProps {
  tabs:          readonly Tab[];
  onOpenPalette: () => void;
}

export default function TopBar({ tabs, onOpenPalette }: TopBarProps) {
  const activeTab    = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const toggleVenue  = useAppStore((s) => s.toggleVenue);
  const feedStatus   = useAppStore((s) => s.feedStatus);

  const { connectionState, failedVenueCount, staleMs } = feedStatus;
  const activeFeeds = activeVenues.length - failedVenueCount;
  const isLive      = connectionState === "live";
  const isWarning   = connectionState === "reconnecting" || connectionState === "stale";
  const statusText  = isLive && staleMs != null
    ? `${activeFeeds} feeds · ${staleMs}ms`
    : `${activeFeeds} feeds`;

  return (
    <header className={styles.bar}>
      <a href="#" className={styles.logo}>oggregator</a>

      <div className={styles.pillGroup} role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={styles.pill}
            role="tab"
            aria-selected={tab.id === activeTab}
            data-active={tab.id === activeTab}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
          >
            {tab.label}
            {tab.badge && <span className={styles.badge}>{tab.badge}</span>}
          </button>
        ))}
      </div>

      <div className={styles.right}>
        <details className={styles.venuePicker}>
          <summary className={styles.venuePickerBtn}>
            <span className={styles.venuePickerLabel}>Venues</span>
            <VenueIndicator />
          </summary>
          <div className={styles.venuePickerPanel}>
            <VenueSidebar activeVenues={activeVenues} onToggle={toggleVenue} />
          </div>
        </details>

        <div className={styles.status}>
          <span
            className={styles.statusDot}
            data-state={connectionState}
            data-warning={isWarning}
            data-live={isLive}
          />
          <span>{statusText}</span>
        </div>
        <button className={styles.cmdk} onClick={onOpenPalette}>
          ⌘K
        </button>
      </div>
    </header>
  );
}
