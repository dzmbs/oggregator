import { useEffect, useRef, useState } from "react";

import { VENUE_LIST } from "@lib/venue-meta";
import { useAppStore } from "@stores/app-store";
import styles from "./VenuePickerButton.module.css";

interface VenuePickerButtonProps {
  compact?: boolean;
}

export default function VenuePickerButton({ compact = false }: VenuePickerButtonProps) {
  const activeVenues = useAppStore((s) => s.activeVenues);
  const toggleVenue  = useAppStore((s) => s.toggleVenue);
  const allActive    = activeVenues.length === VENUE_LIST.length;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div className={styles.picker} data-open={open || undefined} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        data-compact={compact || undefined}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.label}>Venues</span>
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
        <span className={styles.count}>{allActive ? "All" : `${activeVenues.length}/${VENUE_LIST.length}`}</span>
      </button>

      {open ? (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Venue filter</span>
            <span className={styles.panelMeta}>Applies across Chain, Surface, Flow, Analytics, and GEX</span>
          </div>

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
                  <span className={styles.optionShort}>{venue.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
