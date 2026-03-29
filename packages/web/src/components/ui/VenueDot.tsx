import { VENUES } from '@lib/venue-meta';
import { venueColor } from '@lib/colors';

import styles from './VenueDot.module.css';

interface VenueDotProps {
  venueId: string;
  isBest?: boolean;
  title?: string;
}

export default function VenueDot({ venueId, isBest = false, title }: VenueDotProps) {
  const meta = VENUES[venueId];
  const color = venueColor(venueId);

  return (
    <span
      className={styles.dot}
      data-best={isBest}
      style={{ background: `${color}18`, borderColor: isBest ? color : `${color}44` }}
      title={title ?? meta?.label ?? venueId}
    >
      {meta?.logo ? (
        <img
          src={meta.logo}
          alt={meta.shortLabel}
          className={styles.logo}
          style={{ opacity: isBest ? 1 : 0.45 }}
        />
      ) : (
        <span className={styles.label} style={{ color: isBest ? color : undefined }}>
          {meta?.shortLabel ?? venueId.slice(0, 3).toUpperCase()}
        </span>
      )}
    </span>
  );
}
