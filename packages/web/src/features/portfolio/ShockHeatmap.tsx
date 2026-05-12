import type { ShockGridCell } from '@oggregator/protocol';

import styles from './ShockHeatmap.module.css';

interface Props {
  grid: ShockGridCell[][];
}

function fmtUsdShort(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? '+' : '-';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function colorFor(pnl: number, maxAbs: number): string {
  if (maxAbs <= 0) return '#181c24';
  const ratio = Math.max(-1, Math.min(1, pnl / maxAbs));
  if (ratio === 0) return '#181c24';
  if (ratio > 0) {
    const alpha = 0.15 + 0.6 * ratio;
    return `rgba(74, 222, 128, ${alpha})`;
  }
  const alpha = 0.15 + 0.6 * Math.abs(ratio);
  return `rgba(248, 113, 113, ${alpha})`;
}

export default function ShockHeatmap({ grid }: Props) {
  if (grid.length === 0 || grid[0] == null || grid[0].length === 0) {
    return <div className={styles.empty}>Add positions to see vol-shock P&amp;L.</div>;
  }
  const allCells = grid.flat();
  let maxAbs = 0;
  for (const c of allCells) {
    const v = Math.abs(c.totalPnlUsd);
    if (v > maxAbs) maxAbs = v;
  }
  const colLabels = grid[0].map((c) => c.skewShiftPerLogK);

  return (
    <div className={styles.wrap}>
      <div className={styles.title}>Vol-shock P&amp;L (ATM vs skew)</div>
      <table className={styles.grid}>
        <thead>
          <tr>
            <th></th>
            {colLabels.map((skew) => (
              <th key={`col-${skew}`}>{skew.toFixed(2)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row) => {
            const atmShift = row[0]?.atmShiftVolPts ?? 0;
            return (
              <tr key={`row-${atmShift}`}>
                <th>{atmShift > 0 ? `+${atmShift}` : atmShift}</th>
                {row.map((cell) => (
                  <td
                    key={`${cell.atmShiftVolPts}-${cell.skewShiftPerLogK}`}
                    style={{ background: colorFor(cell.totalPnlUsd, maxAbs) }}
                    title={`ATM ${cell.atmShiftVolPts} skew ${cell.skewShiftPerLogK} → ${fmtUsdShort(cell.totalPnlUsd)}`}
                  >
                    {fmtUsdShort(cell.totalPnlUsd)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={styles.legend}>
        Rows: ATM vol-pt shift • Cols: skew (per log-K) • Hover for exact P&amp;L
      </div>
    </div>
  );
}
