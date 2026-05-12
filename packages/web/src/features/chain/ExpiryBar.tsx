import { useCallback, useEffect, useRef } from 'react';

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
  /** Fired on hover/intent (NOT click) so consumers can warm caches/runtimes
   * ahead of a click. Called once per sustained hover (~60ms debounce). */
  onPrefetch?: (expiry: string) => void;
}

const PREFETCH_HOVER_MS = 60;

export default function ExpiryBar({
  underlying,
  spotPrice,
  spotChange,
  expiries,
  selected,
  onSelect,
  onChangeAsset,
  onPrefetch,
}: ExpiryBarProps) {
  const logo = getTokenLogo(underlying);
  const tabsRef = useRef<HTMLDivElement>(null);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPrefetchTimer = useCallback(() => {
    if (prefetchTimerRef.current != null) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
  }, []);

  const schedulePrefetch = useCallback(
    (e: string) => {
      if (!onPrefetch) return;
      clearPrefetchTimer();
      prefetchTimerRef.current = setTimeout(() => {
        prefetchTimerRef.current = null;
        onPrefetch(e);
      }, PREFETCH_HOVER_MS);
    },
    [onPrefetch, clearPrefetchTimer],
  );

  useEffect(() => () => clearPrefetchTimer(), [clearPrefetchTimer]);

  // Translate vertical wheel input into horizontal scroll so a regular
  // mouse-wheel user can reach tabs past the right edge. Skip when the input
  // is already dominantly horizontal — the browser handles that natively, and
  // redirecting it would double-apply the delta.
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = tabsRef.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    el.scrollLeft += e.deltaY;
  }, []);

  // Keep the selected tab in view when it changes (e.g. asset switch lands on
  // an expiry that's offscreen). Manual scroll math avoids perturbing any
  // ancestor scroll positions the way scrollIntoView would.
  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const active = tabs.querySelector<HTMLButtonElement>('button[data-active="true"]');
    if (!active) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    const viewLeft = tabs.scrollLeft;
    const viewRight = viewLeft + tabs.clientWidth;
    if (left < viewLeft) {
      tabs.scrollLeft = left;
    } else if (right > viewRight) {
      tabs.scrollLeft = right - tabs.clientWidth;
    }
  }, [selected, expiries]);

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

      <div className={styles.tabs} ref={tabsRef} onWheel={handleWheel}>
        {expiries.map((e) => {
          const dte = dteDays(e);
          return (
            <button
              key={e}
              className={styles.tab}
              data-active={e === selected}
              onClick={() => onSelect(e)}
              onPointerEnter={() => e !== selected && schedulePrefetch(e)}
              onPointerLeave={clearPrefetchTimer}
              onPointerDown={() => e !== selected && onPrefetch?.(e)}
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
