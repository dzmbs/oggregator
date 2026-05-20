import { forwardDriftLevel, type ForwardLevel } from '@lib/colors';
import { fmtDelta } from '@lib/format';

import styles from './ForwardDeltaPill.module.css';

interface ForwardDeltaPillProps {
  delta: number | null;
  atmStrike: number | null;
  withinConsensusBand: boolean | null;
}

const TOOLTIPS: Record<ForwardLevel, string> = {
  green: 'Clean forward — any price divergence on this venue is real MM skew',
  amber: 'Moderate forward drift — interpret skew with caveat',
  red: 'Forward drift dominates — cheap/expensive prices on this venue are likely fake skew',
  muted: 'Insufficient data to compute forward divergence',
};

const WITHIN_BAND_TOOLTIP =
  'Consensus forward lies inside this venue’s bid/ask no-arbitrage band — the apparent drift is explainable by spread, not a real dislocation';

export default function ForwardDeltaPill({
  delta,
  atmStrike,
  withinConsensusBand,
}: ForwardDeltaPillProps) {
  if (delta == null || atmStrike == null || atmStrike === 0) {
    return (
      <span className={styles.pill} data-level="muted" title={TOOLTIPS.muted}>
        –
      </span>
    );
  }

  const deltaBps = (delta / atmStrike) * 10_000;

  if (withinConsensusBand === true) {
    return (
      <span
        className={styles.pill}
        data-level="muted"
        data-explained="spread"
        title={`${WITHIN_BAND_TOOLTIP} (Δ=${fmtDelta(delta)}, ${deltaBps.toFixed(2)} bps)`}
      >
        {fmtDelta(delta)}
      </span>
    );
  }

  const level = forwardDriftLevel(deltaBps);

  return (
    <span
      className={styles.pill}
      data-level={level}
      title={`${TOOLTIPS[level]} (Δ=${fmtDelta(delta)}, ${deltaBps.toFixed(2)} bps)`}
    >
      {fmtDelta(delta)}
    </span>
  );
}
