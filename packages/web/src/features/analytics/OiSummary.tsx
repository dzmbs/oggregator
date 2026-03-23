import type { EnrichedChainResponse } from "@shared/enriched";
import { fmtUsdCompact } from "@lib/format";
import styles from "./AnalyticsView.module.css";

interface OiStats {
  callCount: number;
  putCount: number;
  callNotional: number;
  putNotional: number;
  callVolume: number;
  putVolume: number;
  callVolNotional: number;
  putVolNotional: number;
}

function computeOiStats(chains: EnrichedChainResponse[]): OiStats {
  let callCount = 0, putCount = 0;
  let callNotional = 0, putNotional = 0;
  let callVolume = 0, putVolume = 0;
  let callVolNotional = 0, putVolNotional = 0;

  for (const chain of chains) {
    for (const s of chain.strikes) {
      for (const q of Object.values(s.call.venues)) {
        if (!q) continue;
        callCount += q.openInterest ?? 0;
        callNotional += q.openInterestUsd ?? 0;
        callVolume += q.volume24h ?? 0;
        callVolNotional += q.volume24hUsd ?? 0;
      }
      for (const q of Object.values(s.put.venues)) {
        if (!q) continue;
        putCount += q.openInterest ?? 0;
        putNotional += q.openInterestUsd ?? 0;
        putVolume += q.volume24h ?? 0;
        putVolNotional += q.volume24hUsd ?? 0;
      }
    }
  }

  return { callCount, putCount, callNotional, putNotional, callVolume, putVolume, callVolNotional, putVolNotional };
}

interface OiSummaryProps {
  chains: EnrichedChainResponse[];
}

export default function OiSummary({ chains }: OiSummaryProps) {
  const stats = computeOiStats(chains);
  const totalCount = stats.callCount + stats.putCount;
  const totalNotional = stats.callNotional + stats.putNotional;
  const pcRatio = stats.callCount > 0 ? stats.putCount / stats.callCount : 0;
  const totalVol = stats.callVolNotional + stats.putVolNotional;
  const volPcRatio = stats.callVolume > 0 ? stats.putVolume / stats.callVolume : 0;

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>Open Interest & Volume Summary</div>
      <div className={styles.summaryGrid}>
        <div className={styles.summarySection}>
          <div className={styles.summarySectionTitle}>Open Interest</div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel} data-type="call">Calls</span>
            <span className={styles.summaryValue}>{fmtUsdCompact(stats.callCount)}</span>
            <span className={styles.summaryMeta}>{fmtUsdCompact(stats.callNotional)}</span>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel} data-type="put">Puts</span>
            <span className={styles.summaryValue}>{fmtUsdCompact(stats.putCount)}</span>
            <span className={styles.summaryMeta}>{fmtUsdCompact(stats.putNotional)}</span>
          </div>
          <div className={styles.summaryRow} data-total>
            <span className={styles.summaryLabel}>Total</span>
            <span className={styles.summaryValue}>{fmtUsdCompact(totalCount)}</span>
            <span className={styles.summaryMeta}>{fmtUsdCompact(totalNotional)}</span>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>P/C Ratio</span>
            <span className={styles.summaryValue}>{pcRatio.toFixed(2)}</span>
          </div>
        </div>

        <div className={styles.summarySection}>
          <div className={styles.summarySectionTitle}>24h Volume</div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel} data-type="call">Calls</span>
            <span className={styles.summaryValue}>{fmtUsdCompact(stats.callVolume)}</span>
            <span className={styles.summaryMeta}>{fmtUsdCompact(stats.callVolNotional)}</span>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel} data-type="put">Puts</span>
            <span className={styles.summaryValue}>{fmtUsdCompact(stats.putVolume)}</span>
            <span className={styles.summaryMeta}>{fmtUsdCompact(stats.putVolNotional)}</span>
          </div>
          <div className={styles.summaryRow} data-total>
            <span className={styles.summaryLabel}>Total</span>
            <span className={styles.summaryValue}>{fmtUsdCompact(stats.callVolume + stats.putVolume)}</span>
            <span className={styles.summaryMeta}>{fmtUsdCompact(totalVol)}</span>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>P/C Ratio</span>
            <span className={styles.summaryValue}>{volPcRatio.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
