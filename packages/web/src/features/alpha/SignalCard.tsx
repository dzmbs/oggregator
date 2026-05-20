import { memo } from 'react';

import InfoTip from '@components/ui/InfoTip';
import { fmtUsd } from '@lib/format';
import type { SpreadSignal } from '@lib/analytics/verticalSpread';

import type { RegimeResponse } from './useRegimeQuery';
import styles from './SignalCard.module.css';

interface Props {
  signal: SpreadSignal | null;
  label?: string;
  regime?: RegimeResponse | null;
}

const REGIME_GATE_PCT: Record<string, string> = {
  bull: '7%',
  neutral: '10%',
  stress: '20%',
};

function SignalCard({ signal, label = 'Executable (best routing)', regime }: Props) {
  if (!signal) {
    return (
      <div className={styles.card} data-empty="true">
        <div className={styles.emptyText}>Select short and long strikes to analyze.</div>
      </div>
    );
  }

  const dominant = regime?.dominant ?? null;
  const confidencePct =
    regime?.confidence != null ? Math.round(regime.confidence * 100) : null;
  const gatePct = dominant ? REGIME_GATE_PCT[dominant] : null;

  const probPct = Math.round(signal.successProbability * 100);
  const probMethodHint =
    signal.probabilityMethod === 'real-world'
      ? 'Real-world: physical drift μ + realized σ_RV.'
      : signal.probabilityMethod === 'risk-neutral'
        ? 'Risk-neutral: N(±d₂) using IV at the breakeven strike.'
        : 'Heuristic: bucketed spot/breakeven ratio.';
  const probMethodSuffix =
    signal.probabilityMethod === 'real-world'
      ? '· P-measure'
      : signal.probabilityMethod === 'risk-neutral'
        ? '· N(d₂)'
        : '· heuristic';

  return (
    <div className={styles.card} data-signal={signal.signal}>
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        <InfoTip label="How to read the signal" title="Reading the signal" align="end">
          <p>
            <strong>Traffic light</strong> on this card is a gating decision, not a
            recommendation. It only fires <strong>SELL</strong> when all three
            execution conditions hold simultaneously:
          </p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
            <li><strong>Net credit &gt; 0</strong> — you actually get paid to put it on.</li>
            <li><strong>EV &gt; 0</strong> — expected value at expiry: pop × credit − (1 − pop) × maxLoss.</li>
            <li><strong>ROC ≥ 10%</strong> — return on capital (EV ÷ maxLoss). Below this even a winning trade isn&apos;t worth the buying-power tie-up.</li>
          </ul>
          <p style={{ marginTop: 6 }}>
            <strong>AVOID</strong> = credit but EV is negative or ROC is too low.
            Usually means the credit is too small for the risk, or the smile makes
            the trade fair-value. <strong>HOLD</strong> = the structure debits net
            — flip the legs or the strategy kind.
          </p>
          <p style={{ marginTop: 6 }}>
            <strong>POP source:</strong> when realized vol and your directional
            view are available, the gate uses real-world probability (P-measure).
            Otherwise it falls back to risk-neutral N(±d₂) at breakeven IV.
            Real-world POP is what actually pays you over a sample of trades —
            risk-neutral POP is fair-value pricing only.
          </p>
        </InfoTip>
      </div>

      <div className={styles.pillRow}>
        <span className={styles.pill} data-signal={signal.signal}>
          {signal.signal}
        </span>
        <span className={styles.reasoning}>{signal.reasoning}</span>
      </div>

      {dominant && (
        <div className={styles.regimeRow} data-regime={dominant}>
          <span className={styles.regimeLabel}>Regime</span>
          <span className={styles.regimePill} data-regime={dominant}>
            {dominant.toUpperCase()}
          </span>
          {confidencePct != null && (
            <span className={styles.regimeMeta}>{confidencePct}% confidence</span>
          )}
          {gatePct && (
            <span className={styles.regimeMeta}>· ROC gate {gatePct}</span>
          )}
        </div>
      )}

      <div className={styles.stats}>
        <div
          className={styles.stat}
          title="Premium received minus premium paid, after taker fees on best venue per leg. Your max profit if held to expiry and short stays OTM."
        >
          <div className={styles.statLabel}>Net credit</div>
          <div className={styles.statValue} data-kind="credit">{fmtUsd(signal.netCredit)}</div>
        </div>
        <div
          className={styles.stat}
          title="Worst-case loss = strike width − net credit. Realized if spot finishes beyond the LONG strike (fully in-the-money) at expiry."
        >
          <div className={styles.statLabel}>Max loss</div>
          <div className={styles.statValue} data-kind="loss">{fmtUsd(signal.maxLoss)}</div>
        </div>
        <div
          className={styles.stat}
          title="Expected value at expiry = pop × credit − (1 − pop) × maxLoss. Positive EV = the trade is +∑ over a large sample at the current pop estimate."
        >
          <div className={styles.statLabel}>EV</div>
          <div
            className={styles.statValue}
            data-kind={signal.expectedValue >= 0 ? 'credit' : 'loss'}
          >
            {fmtUsd(signal.expectedValue)}
          </div>
        </div>
        <div
          className={styles.stat}
          title="Return on capital = EV ÷ maxLoss. Gate requires ≥ 10%. R/R is shown for reference: maxLoss ÷ maxProfit."
        >
          <div className={styles.statLabel}>ROC</div>
          <div className={styles.statValue}>{`${(signal.roc * 100).toFixed(1)}%`}</div>
        </div>
        <div
          className={styles.stat}
          title="Spot price at expiry where P&L = 0. Call credit: short strike + credit. Put credit: short strike − credit. Anything past this point starts losing."
        >
          <div className={styles.statLabel}>Breakeven</div>
          <div className={styles.statValue}>{fmtUsd(signal.breakeven)}</div>
        </div>
        <div
          className={styles.stat}
          title="R/R = max loss ÷ max profit. Reference metric only — the gate uses ROC."
        >
          <div className={styles.statLabel}>R/R</div>
          <div className={styles.statValue}>
            {signal.riskReward >= 999 ? '∞' : `${signal.riskReward.toFixed(2)}:1`}
          </div>
        </div>
      </div>

      <div className={styles.probBlock}>
        <div className={styles.probLabelRow}>
          <span className={styles.probLabel} title={probMethodHint}>
            Success probability {probMethodSuffix}
          </span>
          <span className={styles.probPct}>{probPct}%</span>
        </div>
        <div className={styles.probBar}>
          <div
            className={styles.probFill}
            style={{ width: `${Math.min(100, Math.max(0, probPct))}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default memo(SignalCard);
