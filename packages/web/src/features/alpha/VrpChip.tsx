import InfoTip from '@components/ui/InfoTip';
import { fmtIv } from '@lib/format';

import styles from './VrpChip.module.css';

interface VrpChipProps {
  atmIv30d: number | null;
  rv30d: number | null;
  vrp30d: number | null;
}

type Tone = 'rich' | 'neutral' | 'cheap' | 'unknown';

const STRONG_THRESHOLD = 0.05;

function vrpTone(vrp: number | null): Tone {
  if (vrp == null) return 'unknown';
  if (vrp >= STRONG_THRESHOLD) return 'rich';
  if (vrp <= 0) return 'cheap';
  return 'neutral';
}

export default function VrpChip({ atmIv30d, rv30d, vrp30d }: VrpChipProps) {
  const tone = vrpTone(vrp30d);
  const vrpDisplay = vrp30d == null ? '—' : `${(vrp30d * 100).toFixed(1)}pp`;

  return (
    <div className={styles.chip} data-tone={tone}>
      <span className={styles.label}>VRP30d</span>
      <span className={styles.value}>{vrpDisplay}</span>
      <InfoTip
        label="What is VRP?"
        title="Variance Risk Premium (30d)"
        align="end"
      >
        <p>
          <strong>VRP30d = ATM IV30d − RV30d</strong>. The premium option
          sellers earn for taking on tail risk vs. realized volatility.
        </p>
        <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
          <li>
            <strong>ATM IV30d:</strong> {fmtIv(atmIv30d)} — what the market is pricing.
          </li>
          <li>
            <strong>RV30d:</strong> {fmtIv(rv30d)} — what spot has actually realized.
          </li>
          <li>
            <strong>VRP30d:</strong> {vrpDisplay}.
          </li>
        </ul>
        <p style={{ marginTop: 6 }}>
          Crypto VRP is structurally positive (~85% of observations). When VRP
          flips negative, IV is cheap relative to realized — selling premium
          here is paying you less than the underlying actually moves. Treat
          credit-spread setups with a healthy skepticism in that regime.
        </p>
      </InfoTip>
    </div>
  );
}
