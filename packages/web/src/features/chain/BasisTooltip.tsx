import styles from './BasisTooltip.module.css';

type Tone = 'bull' | 'bear' | 'mixed' | 'neutral';
type Bucket = 'flat' | 'tilt-up' | 'euphoric' | 'tilt-down' | 'stress';

interface BasisTooltipProps {
  basisPct: number | null;
  dte: number;
}

const FLAT_ANN = 3;
const TILT_ANN = 9;
const EUPHORIC_ANN = 27;

interface Row {
  bucket: Bucket;
  tone: Tone;
  range: string;
  ann: string;
  read: string;
}

function classify(annPct: number): Bucket {
  if (Math.abs(annPct) < FLAT_ANN) return 'flat';
  if (annPct >= EUPHORIC_ANN) return 'euphoric';
  if (annPct >= FLAT_ANN) return 'tilt-up';
  if (annPct <= -TILT_ANN) return 'stress';
  return 'tilt-down';
}

function fmtAnn(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function fmtRaw(v: number): string {
  // Three decimals so 4d bands like 0.033% don't collapse to 0.03%.
  return `${v.toFixed(3)}%`;
}

function buildRows(dte: number): Row[] {
  const k = dte / 365;
  const flatRaw = FLAT_ANN * k;
  const tiltRaw = TILT_ANN * k;
  const euphoricRaw = EUPHORIC_ANN * k;

  return [
    {
      bucket: 'flat',
      tone: 'neutral',
      range: `|basis| < ${fmtRaw(flatRaw)}`,
      ann: '|ann| < 3%',
      read: 'Flat — no directional conviction priced in',
    },
    {
      bucket: 'tilt-up',
      tone: 'bull',
      range: `+${fmtRaw(flatRaw)} … +${fmtRaw(euphoricRaw)}`,
      ann: '+3% … +27% ann',
      read: 'Meaningful contango — healthy long carry',
    },
    {
      bucket: 'euphoric',
      tone: 'bear',
      range: `> +${fmtRaw(euphoricRaw)}`,
      ann: '≥ +27% ann',
      read: 'Euphoric — crowded longs, mean-reversion risk',
    },
    {
      bucket: 'tilt-down',
      tone: 'mixed',
      range: `−${fmtRaw(tiltRaw)} … −${fmtRaw(flatRaw)}`,
      ann: '−9% … −3% ann',
      read: 'Mild backwardation — passive deleveraging',
    },
    {
      bucket: 'stress',
      tone: 'bear',
      range: `< −${fmtRaw(tiltRaw)}`,
      ann: '≤ −9% ann',
      read: 'Real stress — watch for liquidation cascade',
    },
  ];
}

export default function BasisTooltip({ basisPct, dte }: BasisTooltipProps) {
  const annPct = basisPct != null && dte > 0 ? basisPct * (365 / dte) : null;
  const current = annPct != null ? classify(annPct) : null;
  const rows = dte > 0 ? buildRows(dte) : [];

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>Annualized basis ({dte}d)</span>
        {annPct != null ? (
          <span className={styles.headerValue} data-tone={current ? toneOf(rows, current) : undefined}>
            {fmtAnn(annPct)}
          </span>
        ) : (
          <span className={styles.headerValue}>–</span>
        )}
      </div>
      <div className={styles.formula}>basis% × (365/{dte}d)</div>

      <div className={styles.divider} />

      <ul className={styles.list}>
        {rows.map((row) => (
          <li
            key={row.bucket}
            className={styles.row}
            data-active={current === row.bucket ? 'true' : undefined}
          >
            <span className={styles.badge} data-tone={row.tone} />
            <div className={styles.rowBody}>
              <div className={styles.rowHead}>
                <span className={styles.range}>{row.range}</span>
                <span className={styles.example}>{row.ann}</span>
              </div>
              <div className={styles.read}>{row.read}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function toneOf(rows: Row[], b: Bucket): Tone {
  return rows.find((r) => r.bucket === b)?.tone ?? 'neutral';
}
