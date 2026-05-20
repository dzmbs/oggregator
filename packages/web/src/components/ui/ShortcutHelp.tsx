import { useEffect } from 'react';

import styles from './ShortcutHelp.module.css';

interface ShortcutHelpProps {
  onClose: () => void;
}

interface Row {
  label: string;
  keys: string[];
}

const NAVIGATION: Row[] = [
  { label: 'Chain', keys: ['g', 'c'] },
  { label: 'Alpha', keys: ['g', 'a'] },
  { label: 'Builder', keys: ['g', 'b'] },
  { label: 'Paper', keys: ['g', 'p'] },
  { label: 'Volatility', keys: ['g', 'v'] },
  { label: 'Flow', keys: ['g', 'f'] },
  { label: 'Analytics', keys: ['g', 'y'] },
  { label: 'GEX', keys: ['g', 'x'] },
];

const ACTIONS: Row[] = [
  { label: 'Asset picker', keys: ['⌘', 'K'] },
  { label: 'Asset picker', keys: ['/'] },
  { label: 'Show shortcuts', keys: ['?'] },
  { label: 'Close overlay', keys: ['Esc'] },
];

export default function ShortcutHelp({ onClose }: ShortcutHelpProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-label="Keyboard shortcuts">
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Keyboard shortcuts</span>
          <span className={styles.hint}>Esc to close</span>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Navigation</div>
          {NAVIGATION.map((row) => (
            <div key={row.label + row.keys.join('')} className={styles.row}>
              <span className={styles.label}>{row.label}</span>
              <span className={styles.keys}>
                {row.keys.map((k, i) => (
                  <kbd key={i} className={styles.kbd}>
                    {k}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Actions</div>
          {ACTIONS.map((row) => (
            <div key={row.label + row.keys.join('')} className={styles.row}>
              <span className={styles.label}>{row.label}</span>
              <span className={styles.keys}>
                {row.keys.map((k, i) => (
                  <kbd key={i} className={styles.kbd}>
                    {k}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
