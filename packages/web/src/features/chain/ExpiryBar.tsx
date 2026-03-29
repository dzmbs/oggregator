import { getTokenLogo } from '@lib/token-meta';
import { dteDays, formatExpiry, fmtUsdCompact } from '@lib/format';

import styles from './ExpiryBar.module.css';

interface ExpiryBarProps {
  underlying: string;
  spotPrice?: number | null;
  spotChange?: number | null;
  expiries: string[];
  selected: string;
  onSelect: (expiry: string) => void;
  onChangeAsset: () => void;
}

export default function ExpiryBar({
  underlying,
  spotPrice,
  spotChange,
  expiries,
  selected,
  onSelect,
  onChangeAsset,
}: ExpiryBarProps) {
  const logo = getTokenLogo(underlying);

  return (
    <div className={styles.strip}>
      <button className={styles.assetPicker} onClick={onChangeAsset}>
        {logo && <img src={logo} className={styles.assetIcon} alt={underlying} />}
        <div className={styles.assetText}>
          <span className={styles.assetLabel}>{underlying}</span>
          {spotPrice != null && (
            <span className={styles.assetPrice}>
              {fmtUsdCompact(spotPrice)}
              {spotChange != null && (
                <span className={styles.spotChange} data-positive={spotChange >= 0}>
                  {spotChange >= 0 ? '▲' : '▼'}
                  {Math.abs(spotChange * 100).toFixed(1)}%
                </span>
              )}
            </span>
          )}
        </div>
        <span className={styles.assetChevron}>▾</span>
      </button>

      <div className={styles.divider} />

      <div className={styles.tabs}>
        {expiries.map((e) => {
          const dte = dteDays(e);
          return (
            <button
              key={e}
              className={styles.tab}
              data-active={e === selected}
              onClick={() => onSelect(e)}
            >
              <span className={styles.tabLabel}>{formatExpiry(e)}</span>
              <span className={styles.dteBadge} data-urgent={dte <= 1}>
                {dte}d
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
