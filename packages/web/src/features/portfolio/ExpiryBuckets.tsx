import type { ExpiryBucketRow } from '@oggregator/protocol';

import styles from './ExpiryBuckets.module.css';

interface Props {
  rows: ExpiryBucketRow[];
}

function fmtSigned(value: number, digits = 2): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

export default function ExpiryBuckets({ rows }: Props) {
  if (rows.length === 0) {
    return <div className={styles.empty}>Add positions to see risk by expiry.</div>;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.title}>Risk by expiry</div>
      <div className={styles.list}>
        {rows.map((row) => (
          <div key={row.expiry} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.expiry}>{row.expiry}</span>
              <span className={styles.dte}>{row.dte}d</span>
            </div>
            <div className={styles.stats}>
              <span className={styles.stat}>contracts {fmtSigned(row.contracts, 0)}</span>
              <span className={styles.stat}>vega {fmtSigned(row.vega, 3)}</span>
              <span className={styles.stat}>gamma {fmtSigned(row.gamma, 4)}</span>
              <span className={styles.stat}>theta {fmtSigned(row.theta, 2)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
