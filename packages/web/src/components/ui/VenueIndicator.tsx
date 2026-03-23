import { useAppStore } from "@stores/app-store";
import { VENUES } from "@lib/venue-meta";
import styles from "./VenueIndicator.module.css";

export default function VenueIndicator() {
  const activeVenues = useAppStore((s) => s.activeVenues);
  const allActive = activeVenues.length >= 5;

  return (
    <span className={styles.wrap}>
      {activeVenues.map((v) => {
        const meta = VENUES[v];
        return meta?.logo ? (
          <img key={v} src={meta.logo} alt={meta.shortLabel} className={styles.logo} title={meta.label} />
        ) : (
          <span key={v} className={styles.tag}>{meta?.shortLabel ?? v}</span>
        );
      })}
      <span className={styles.label}>{allActive ? "All venues" : `${activeVenues.length} venues`}</span>
    </span>
  );
}
