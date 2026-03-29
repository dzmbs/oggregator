import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import { VENUE_LIST } from '@lib/venue-meta';
import { useAppStore } from '@stores/app-store';
import styles from './VenuePickerButton.module.css';

// Open state lives outside React render cycle so parent re-renders (from
// query-key changes when venues toggle) don't reset the popover.
let _open = false;
const _listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
function getSnapshot() {
  return _open;
}
function setOpen(next: boolean | ((prev: boolean) => boolean)) {
  const value = typeof next === 'function' ? next(_open) : next;
  if (value === _open) return;
  _open = value;
  for (const cb of _listeners) cb();
}

export default function VenuePickerButton() {
  const activeVenues = useAppStore((s) => s.activeVenues);
  const toggleVenue = useAppStore((s) => s.toggleVenue);
  const allActive = activeVenues.length === VENUE_LIST.length;
  const open = useSyncExternalStore(subscribe, getSnapshot);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const handleToggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <div className={styles.picker} data-open={open || undefined} ref={rootRef}>
      <button type="button" className={styles.trigger} aria-expanded={open} onClick={handleToggle}>
        <span className={styles.logos}>
          {VENUE_LIST.map((venue) => (
            <img
              key={venue.id}
              src={venue.logo}
              alt={venue.shortLabel}
              title={venue.label}
              className={styles.logo}
              data-active={activeVenues.includes(venue.id)}
            />
          ))}
        </span>
        <span className={styles.count}>{allActive ? 'All' : activeVenues.length.toString()}</span>
        <span className={styles.chevron} data-open={open || undefined}>
          ▾
        </span>
      </button>

      {open ? (
        <div className={styles.panel}>
          <div className={styles.grid}>
            {VENUE_LIST.map((venue) => {
              const active = activeVenues.includes(venue.id);
              return (
                <button
                  key={venue.id}
                  type="button"
                  className={styles.option}
                  data-active={active || undefined}
                  onClick={() => toggleVenue(venue.id)}
                >
                  <img src={venue.logo} alt="" className={styles.optionLogo} />
                  <span className={styles.optionName}>{venue.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
