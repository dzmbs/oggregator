import { useAppStore } from "@stores/app-store";

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
        <div className={styles.status}>
          <span className={styles.statusDot} />
          <span>5 feeds · 24ms</span>
        </div>
        <button className={styles.cmdk} onClick={onOpenPalette}>
          ⌘K
        </button>
      </div>
    </header>
  );
}
