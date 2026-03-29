import styles from './Tabs.module.css';

interface Tab {
  id: string;
  label: string;
  badge?: string;
}

interface TabsProps {
  tabs: readonly Tab[];
  active: string;
  onChange: (id: string) => void;
}

export default function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className={styles.tabBar} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={styles.tab}
          role="tab"
          aria-selected={tab.id === active}
          data-active={tab.id === active}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.badge && <span className={styles.badge}>{tab.badge}</span>}
        </button>
      ))}
    </div>
  );
}
