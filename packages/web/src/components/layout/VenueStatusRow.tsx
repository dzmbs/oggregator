import { VENUE_LIST } from '@lib/venue-meta';
import { useAppStore } from '@stores/app-store';

import styles from './VenueStatusRow.module.css';

type DotState = 'live' | 'failed' | 'inactive';

export default function VenueStatusRow() {
  const activeVenues = useAppStore((s) => s.activeVenues);
  const failedVenueIds = useAppStore((s) => s.feedStatus.failedVenueIds);
  const connectionState = useAppStore((s) => s.feedStatus.connectionState);

  const activeSet = new Set(activeVenues);
  const failedSet = new Set(failedVenueIds);
  const feedIsLive = connectionState === 'live';

  return (
    <div className={styles.row} role="status" aria-label="Venue feed status">
      {VENUE_LIST.map((venue) => {
        const isActive = activeSet.has(venue.id);
        const isFailed = failedSet.has(venue.id);
        const state: DotState = !isActive
          ? 'inactive'
          : isFailed || !feedIsLive
            ? 'failed'
            : 'live';
        const title = !isActive
          ? `${venue.label} · off`
          : state === 'live'
            ? `${venue.label} · live`
            : `${venue.label} · disconnected`;
        return <span key={venue.id} className={styles.dot} data-state={state} title={title} />;
      })}
    </div>
  );
}
