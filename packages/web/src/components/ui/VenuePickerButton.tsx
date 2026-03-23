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

  return (
    <details className={styles.picker}>
      <summary className={styles.trigger} data-compact={compact || undefined}>
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
      </summary>

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
                onClick={(event) => {
                  event.preventDefault();
                  toggleVenue(venue.id);
                }}
              >
                <img src={venue.logo} alt="" className={styles.optionLogo} />
                <span className={styles.optionName}>{venue.label}</span>
                <span className={styles.optionShort}>{venue.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}
