import { useAppStore } from '@stores/app-store';
import { TABS } from '@lib/tabs';

import styles from './MobileNav.module.css';

export default function MobileNav() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  return (
    <nav className={styles.nav}>
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={styles.tab}
          data-active={tab.id === activeTab}
          onClick={() => setActiveTab(tab.id)}
        >
          <span className={styles.icon}>{tab.icon}</span>
          <span className={styles.label}>{tab.label}</span>
          {tab.badge && tab.id === activeTab && <span className={styles.badge}>{tab.badge}</span>}
        </button>
      ))}
    </nav>
  );
}
