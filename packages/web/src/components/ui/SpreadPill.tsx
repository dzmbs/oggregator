import { spreadLevel } from '@lib/colors';

import styles from './SpreadPill.module.css';

interface SpreadPillProps {
  spreadPct: number | null;
}

export default function SpreadPill({ spreadPct }: SpreadPillProps) {
  const level = spreadLevel(spreadPct);

  if (spreadPct == null) {
    return (
      <span className={styles.pill} data-level="muted">
        –
      </span>
    );
  }

  return (
    <span className={styles.pill} data-level={level} title={`Spread: ${spreadPct.toFixed(2)}%`}>
      {spreadPct.toFixed(1)}%
    </span>
  );
}
