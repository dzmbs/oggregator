import type { BreakEvenIvRow, PositionLeg } from '@oggregator/protocol';

import { useIsMobile } from '@hooks/useIsMobile';

import MobilePositionCard from './MobilePositionCard';
import { useRemovePosition } from './hooks/queries';
import styles from './PositionsTable.module.css';

interface Props {
  positions: PositionLeg[];
  breakEven: BreakEvenIvRow[];
  readOnly?: boolean;
  emptyMessage?: string;
}

function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 100) return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(4)}`;
  if (abs === 0) return '$0.00';
  return `${sign}$${abs.toFixed(6)}`;
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

export default function PositionsTable({
  positions,
  breakEven,
  readOnly = false,
  emptyMessage,
}: Props) {
  const removePosition = useRemovePosition();
  const isMobile = useIsMobile();
  const breakEvenByLegId = new Map(breakEven.map((row) => [row.legId, row]));

  if (positions.length === 0) {
    const fallback = readOnly ? 'No open positions.' : 'No positions yet — add a leg below.';
    return <div className={styles.empty}>{emptyMessage ?? fallback}</div>;
  }

  if (isMobile) {
    return (
      <div className={styles.cardList}>
        {positions.map((leg) => (
          <MobilePositionCard
            key={leg.legId}
            leg={leg}
            be={breakEvenByLegId.get(leg.legId)}
            readOnly={readOnly}
            onRemove={() => removePosition.mutate(leg.legId)}
            removing={removePosition.isPending}
          />
        ))}
      </div>
    );
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Underlying</th>
          <th>Expiry</th>
          <th>Strike</th>
          <th>R</th>
          <th>Size</th>
          <th>Entry $</th>
          <th>D/C</th>
          <th>Entry IV</th>
          <th>Mark $</th>
          <th>Live IV</th>
          <th>Break-even IV</th>
          <th>IV Cushion</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {positions.map((leg) => {
          const be = breakEvenByLegId.get(leg.legId);
          const cushionClass =
            be?.ivCushionPct == null
              ? styles.cushionNeutral
              : be.ivCushionPct >= 0
                ? styles.cushionPos
                : styles.cushionNeg;
          const noteLabel = beNoteLabel(be?.beNote);
          const noteTitle = beNoteTitle(be?.beNote);
          const debitOrCredit = leg.size > 0 ? 'Dr' : 'Cr';
          const debitOrCreditTitle =
            leg.size > 0
              ? `Long leg: $${leg.entryPriceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} paid per contract.`
              : `Short leg: $${leg.entryPriceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} received per contract.`;
          return (
            <tr key={leg.legId}>
              <td>{leg.underlying}</td>
              <td>{leg.expiry}</td>
              <td>{leg.strike.toLocaleString()}</td>
              <td>{leg.optionRight === 'call' ? 'C' : 'P'}</td>
              <td className={leg.size > 0 ? styles.long : styles.short}>{leg.size}</td>
              <td>{fmtUsd(leg.entryPriceUsd)}</td>
              <td
                className={leg.size > 0 ? styles.debit : styles.credit}
                title={debitOrCreditTitle}
              >
                {debitOrCredit}
              </td>
              <td
                className={leg.entryIvIsModel === true ? styles.ivModel : undefined}
                title={
                  leg.entryIvIsModel === true
                    ? 'Entry IV back-solved from entry price + forward at upsert time'
                    : undefined
                }
              >
                {fmtIv(leg.entryIv)}
                {leg.entryIvIsModel === true ? '*' : ''}
              </td>
              <td>{fmtUsd(be?.currentMarkUsd)}</td>
              <td
                className={be?.currentIvIsModel === true ? styles.ivModel : undefined}
                title={
                  be?.currentIvIsModel === true ? 'fair value from smile fit' : undefined
                }
              >
                {fmtIv(be?.currentIv)}
              </td>
              <td
                className={noteLabel != null ? styles.beNote : undefined}
                title={noteTitle}
              >
                {noteLabel ?? fmtIv(be?.breakEvenIv)}
              </td>
              <td className={cushionClass} title={noteTitle}>
                {noteLabel != null ? '—' : fmtPct(be?.ivCushionPct)}
              </td>
              <td>
                {readOnly ? null : (
                  <button
                    type="button"
                    className={styles.remove}
                    onClick={() => removePosition.mutate(leg.legId)}
                    disabled={removePosition.isPending}
                    aria-label={`remove ${leg.legId}`}
                  >
                    ×
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
