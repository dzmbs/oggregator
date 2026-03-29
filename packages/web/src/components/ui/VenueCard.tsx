import { VENUES } from '@lib/venue-meta';
import { fmtUsd, fmtIv } from '@lib/format';
import styles from './VenueCard.module.css';

export interface VenueCardDetail {
  label: string;
  strike: number;
  type: 'call' | 'put';
  direction: 'buy' | 'sell';
  price: number;
  spreadPct: number | null;
  iv: number | null;
  size: number | null;
  spreadCost: number | null;
}

interface VenueCardProps {
  venueId: string;
  total: number | null;
  totalLabel?: string;
  isBest: boolean;
  available: boolean;
  details: VenueCardDetail[];
  action?: { label: string; onClick: () => void };
  savings?: string;
  tags?: string[];
}

export default function VenueCard({
  venueId,
  total,
  totalLabel,
  isBest,
  available,
  details,
  action,
  savings,
  tags,
}: VenueCardProps) {
  const meta = VENUES[venueId];
  const allTags = tags ?? (isBest ? ['BEST'] : []);

  return (
    <div
      className={styles.card}
      data-best={isBest || undefined}
      data-unavailable={!available || undefined}
    >
      {/* Top: venue identity + price */}
      <div className={styles.header}>
        <div className={styles.venueId}>
          {meta?.logo && <img src={meta.logo} className={styles.logo} alt="" />}
          <span className={styles.name}>{meta?.label ?? venueId}</span>
          {allTags.map((tag) => (
            <span key={tag} className={styles.bestTag} data-tag={tag}>
              {tag}
            </span>
          ))}
        </div>
        <span className={styles.total} data-positive={total != null && total > 0}>
          {available && total != null && Number.isFinite(total)
            ? `${total > 0 ? '+' : ''}${fmtUsd(total)}`
            : 'N/A'}
        </span>
      </div>

      {/* Leg details */}
      {available && details.length > 0 && (
        <div className={styles.details}>
          {details.map((d, i) => (
            <div key={i} className={styles.legRow}>
              <div className={styles.legLeft}>
                <span className={styles.dir} data-direction={d.direction}>
                  {d.direction === 'buy' ? 'BUY' : 'SELL'}
                </span>
                <span className={styles.strike}>{d.strike.toLocaleString()}</span>
                <span className={styles.type} data-type={d.type}>
                  {d.type === 'call' ? 'CALL' : 'PUT'}
                </span>
              </div>
              <span className={styles.legPrice}>{fmtUsd(d.price)}</span>
            </div>
          ))}

          {/* Stats grid: IV, spread, size, spread cost — only for single-leg */}
          {details.length === 1 && details[0] && (
            <div className={styles.statsGrid}>
              {details[0].iv != null && (
                <div className={styles.stat}>
                  <span className={styles.statLabel}>IV</span>
                  <span className={styles.statVal} data-kind="iv">
                    {fmtIv(details[0].iv)}
                  </span>
                </div>
              )}
              {details[0].spreadPct != null && (
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Spread</span>
                  <span className={styles.statVal}>{details[0].spreadPct.toFixed(1)}%</span>
                </div>
              )}
              {details[0].size != null && (
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Size</span>
                  <span className={styles.statVal}>{details[0].size.toFixed(1)}</span>
                </div>
              )}
              {details[0].spreadCost != null && (
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Spread Cost</span>
                  <span className={styles.statVal}>{fmtUsd(details[0].spreadCost)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer: total label + savings */}
      {available && (totalLabel || savings) && (
        <div className={styles.footer}>
          {totalLabel && <span className={styles.footerLabel}>{totalLabel}</span>}
          {savings && <span className={styles.footerSavings}>{savings}</span>}
        </div>
      )}

      {/* Action button — subtle, secondary */}
      {available && action && (
        <button className={styles.actionBtn} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
