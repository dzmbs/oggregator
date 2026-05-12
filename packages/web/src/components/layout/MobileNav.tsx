import { useEffect, useRef } from 'react';

import { useAppStore } from '@stores/app-store';
import { TABS } from '@lib/tabs';

import styles from './MobileNav.module.css';

export default function MobileNav() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [activeTab]);

  return (
    <nav className={styles.nav}>
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            ref={isActive ? activeRef : null}
            className={styles.tab}
            data-active={isActive}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className={styles.icon}>{tab.icon}</span>
            <span className={styles.label}>{tab.label}</span>
            {tab.badge && isActive && <span className={styles.badge}>{tab.badge}</span>}
          </button>
        );
      })}
    </nav>
  );
}
