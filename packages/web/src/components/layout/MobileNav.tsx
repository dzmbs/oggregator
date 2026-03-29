import { useAppStore } from '@stores/app-store';
import styles from './MobileNav.module.css';

interface Tab {
  id: string;
  label: string;
  icon: string;
  badge?: string;
}

const MOBILE_TABS: Tab[] = [
  { id: 'chain', label: 'Chain', icon: '⟐' },
  { id: 'architect', label: 'Builder', icon: '⚙' },
  { id: 'surface', label: 'Surface', icon: '◈' },
  { id: 'flow', label: 'Flow', icon: '⚡', badge: 'LIVE' },
  { id: 'analytics', label: 'Analytics', icon: '◎' },
  { id: 'gex', label: 'GEX', icon: '▧' },
];

export default function MobileNav() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  return (
    <nav className={styles.nav}>
      {MOBILE_TABS.map((tab) => (
        <button
          key={tab.id}
          className={styles.tab}
          data-active={tab.id === activeTab}
          onClick={() => setActiveTab(tab.id as typeof activeTab)}
        >
          <span className={styles.icon}>{tab.icon}</span>
          <span className={styles.label}>{tab.label}</span>
          {tab.badge && tab.id === activeTab && <span className={styles.badge}>{tab.badge}</span>}
        </button>
      ))}
    </nav>
  );
}
