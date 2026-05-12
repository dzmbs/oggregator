import type { BreakEvenIvRow, PositionLeg } from '@oggregator/protocol';

import { useRemovePosition } from './hooks/queries';
import styles from './PositionsTable.module.css';

interface Props {
  positions: PositionLeg[];
  breakEven: BreakEvenIvRow[];
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

export default function PositionsTable({ positions, breakEven }: Props) {
  const removePosition = useRemovePosition();
  const breakEvenByLegId = new Map(breakEven.map((row) => [row.legId, row]));

  if (positions.length === 0) {
    return <div className={styles.empty}>No positions yet — add a leg below.</div>;
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
          <th>Entry IV</th>
          <th>Mark $</th>
          <th>Cur IV</th>
          <th>BE IV</th>
          <th>Cushion</th>
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
          return (
            <tr key={leg.legId}>
              <td>{leg.underlying}</td>
              <td>{leg.expiry}</td>
              <td>{leg.strike.toLocaleString()}</td>
              <td>{leg.optionRight === 'call' ? 'C' : 'P'}</td>
              <td className={leg.size > 0 ? styles.long : styles.short}>{leg.size}</td>
              <td>{fmtUsd(leg.entryPriceUsd)}</td>
              <td>{fmtIv(leg.entryIv)}</td>
              <td>{fmtUsd(be?.currentMarkUsd)}</td>
              <td>{fmtIv(be?.currentIv)}</td>
              <td>{fmtIv(be?.breakEvenIv)}</td>
              <td className={cushionClass}>{fmtPct(be?.ivCushionPct)}</td>
              <td>
                <button
                  type="button"
                  className={styles.remove}
                  onClick={() => removePosition.mutate(leg.legId)}
                  disabled={removePosition.isPending}
                  aria-label={`remove ${leg.legId}`}
                >
                  ×
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
