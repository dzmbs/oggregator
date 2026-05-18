import type { BreakEvenIvRow, PositionLeg } from '@oggregator/protocol';

import styles from './MobilePositionCard.module.css';

interface Props {
  leg: PositionLeg;
  be: BreakEvenIvRow | undefined;
  readOnly: boolean;
  onRemove: () => void;
  removing: boolean;
}

function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtIv(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function beNoteLabel(note: BreakEvenIvRow['beNote']): string | null {
  if (note === 'capped') return '>300%';
  if (note === 'below_intrinsic') return '< intrinsic';
  if (note === 'above_upper') return '> upper';
  return null;
}

function beNoteTitle(note: BreakEvenIvRow['beNote']): string | undefined {
  if (note === 'capped')
    return 'position needs unrealistic vol to recover entry — time decay dominated';
  if (note === 'below_intrinsic')
    return 'entry below current no-arb floor (intrinsic); recovery requires spot move, not vol';
  if (note === 'above_upper')
    return 'entry above option upper bound; cannot be priced at any positive vol';
  return undefined;
}

export default function MobilePositionCard({ leg, be, readOnly, onRemove, removing }: Props) {
  const isLong = leg.size > 0;
  const noteLabel = beNoteLabel(be?.beNote);
  const noteTitle = beNoteTitle(be?.beNote);
  const cushion = noteLabel != null ? null : be?.ivCushionPct ?? null;
  const cushionTone =
    cushion == null ? 'neutral' : cushion >= 0 ? 'positive' : 'negative';

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <div className={styles.title}>
          <span className={styles.underlying}>{leg.underlying}</span>
          <span className={styles.strike}>{leg.strike.toLocaleString()}</span>
          <span className={styles.right} data-type={leg.optionRight}>
            {leg.optionRight === 'call' ? 'C' : 'P'}
          </span>
          <span className={styles.expiry}>{leg.expiry}</span>
        </div>
        <div className={styles.headRight}>
          <span className={styles.size} data-long={isLong}>
            {isLong ? '+' : ''}
            {leg.size}
          </span>
          {!readOnly && (
            <button
              type="button"
              className={styles.remove}
              onClick={onRemove}
              disabled={removing}
              aria-label={`remove ${leg.legId}`}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.cell}>
          <span className={styles.label}>Entry {isLong ? 'Dr' : 'Cr'}</span>
          <span className={styles.value}>{fmtUsd(leg.entryPriceUsd)}</span>
          <span
            className={`${styles.sub} ${leg.entryIvIsModel === true ? styles.ivModel : ''}`}
            title={
              leg.entryIvIsModel === true
                ? 'Entry IV back-solved from entry price + forward'
                : undefined
            }
          >
            {fmtIv(leg.entryIv)}
            {leg.entryIvIsModel === true ? '*' : ''}
          </span>
        </div>
        <div className={styles.cell}>
          <span className={styles.label}>Mark</span>
          <span className={styles.value}>{fmtUsd(be?.currentMarkUsd)}</span>
          <span
            className={`${styles.sub} ${be?.currentIvIsModel === true ? styles.ivModel : ''}`}
            title={be?.currentIvIsModel === true ? 'fair value from smile fit' : undefined}
          >
            {fmtIv(be?.currentIv)}
          </span>
        </div>
        <div className={styles.cell}>
          <span className={styles.label}>BE IV</span>
          <span
            className={`${styles.value} ${noteLabel != null ? styles.beNote : ''}`}
            title={noteTitle}
          >
            {noteLabel ?? fmtIv(be?.breakEvenIv)}
          </span>
          <span className={styles.sub} data-tone={cushionTone} title={noteTitle}>
            {noteLabel != null ? '—' : fmtPct(cushion)}
          </span>
        </div>
      </div>
    </div>
  );
}
