import { useMemo, useState } from "react";

import { useAppStore } from "@stores/app-store";
import { AssetPickerButton, VenuePickerButton, EmptyState } from "@components/ui";
import { useChainQuery, useExpiries } from "@features/chain/queries";
import { fmtUsd, formatExpiry } from "@lib/format";
import { useStrategyStore } from "./strategy-store";
import { computePayoff, computeMetrics, detectStrategy, type Leg } from "./payoff";
import PayoffChart from "./PayoffChart";
import VenueSlideover from "./VenueSlideover";
import StrategyTemplates from "./StrategyTemplates";
import LegInput from "./LegInput";
import styles from "./Architect.module.css";

function LegRow({ leg, onRemove }: { leg: Leg; onRemove: () => void }) {
  return (
    <div className={styles.legRow} data-direction={leg.direction}>
      <span className={styles.legDirection} data-direction={leg.direction}>
        {leg.direction === "buy" ? "BUY" : "SELL"}
      </span>
      <span className={styles.legQty}>{leg.quantity}×</span>
      <span className={styles.legStrike}>{leg.strike.toLocaleString()}</span>
      <span className={styles.legType} data-type={leg.type}>
        {leg.type === "call" ? "C" : "P"}
      </span>
      <span className={styles.legExpiry}>{formatExpiry(leg.expiry)}</span>
      <span className={styles.legPrice}>{fmtUsd(leg.entryPrice)}</span>
      <button className={styles.legRemove} onClick={onRemove} title="Remove leg">×</button>
    </div>
  );
}

export default function ArchitectView() {
  const underlying   = useAppStore((s) => s.underlying);
  const expiry       = useAppStore((s) => s.expiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const { data: expiriesData } = useExpiries(underlying);
  const defaultExpiry = expiry || expiriesData?.expiries?.[1] || expiriesData?.expiries?.[0] || "";
  const { data: chain } = useChainQuery(underlying, defaultExpiry, activeVenues);

  const legs      = useStrategyStore((s) => s.legs);
  const clearLegs = useStrategyStore((s) => s.clearLegs);
  const removeLeg = useStrategyStore((s) => s.removeLeg);
  const [showVenues, setShowVenues] = useState(false);

  const spotPrice = chain?.stats.spotIndexUsd ?? chain?.stats.forwardPriceUsd ?? 0;

  const payoffPoints = useMemo(() => computePayoff(legs, spotPrice), [legs, spotPrice]);
  const metrics = useMemo(() => legs.length > 0 ? computeMetrics(legs, spotPrice) : null, [legs, spotPrice]);
  const strategyName = useMemo(() => detectStrategy(legs), [legs]);

  return (
    <div className={styles.view}>
      <div className={styles.mainArea}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.title}>Architect</span>
            <AssetPickerButton />
            <VenuePickerButton />
          </div>
        </div>

        {/* Template strip */}
        <StrategyTemplates chain={chain ?? null} expiry={defaultExpiry} />

        {/* Leg input */}
        <LegInput />

        {/* Legs list + metrics */}
        {legs.length > 0 && (
          <div className={styles.legsSection}>
            <div className={styles.legsSectionHeader}>
              <span className={styles.strategyName}>{strategyName}</span>
              <button className={styles.clearBtn} onClick={clearLegs}>Clear</button>
            </div>

            <div className={styles.legsList}>
              {legs.map((leg) => (
                <LegRow key={leg.id} leg={leg} onRemove={() => removeLeg(leg.id)} />
              ))}
            </div>

            {metrics && (
              <div className={styles.metricsRow}>
                <span className={styles.metric}>
                  <span className={styles.metricLabel}>Net</span>
                  <span className={styles.metricVal} data-positive={metrics.netDebit > 0}>
                    {metrics.netDebit > 0 ? "+" : ""}{fmtUsd(metrics.netDebit)}
                  </span>
                </span>
                <span className={styles.metric}>
                  <span className={styles.metricLabel}>Max ↑</span>
                  <span className={styles.metricVal} data-positive>
                    {metrics.maxProfit != null ? fmtUsd(metrics.maxProfit) : "∞"}
                  </span>
                </span>
                <span className={styles.metric}>
                  <span className={styles.metricLabel}>Max ↓</span>
                  <span className={styles.metricVal} data-negative>
                    {metrics.maxLoss != null ? fmtUsd(metrics.maxLoss) : "∞"}
                  </span>
                </span>
                {metrics.breakevens.length > 0 && (
                  <span className={styles.metric}>
                    <span className={styles.metricLabel}>BE</span>
                    <span className={styles.metricVal}>
                      {metrics.breakevens.map((b) => `$${b.toLocaleString()}`).join(", ")}
                    </span>
                  </span>
                )}
                <span className={styles.greeks}>
                  Δ {metrics.netDelta?.toFixed(3) ?? "–"}
                  &nbsp; Γ {metrics.netGamma?.toFixed(5) ?? "–"}
                  &nbsp; Θ {metrics.netTheta != null ? fmtUsd(metrics.netTheta) : "–"}
                  &nbsp; V {metrics.netVega != null ? fmtUsd(metrics.netVega) : "–"}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Payoff chart */}
        <div className={styles.chartPanel}>
          {legs.length === 0 ? (
            <EmptyState
              icon="⚙"
              title="Build a strategy"
              detail="Pick a template above, add custom legs, or click BID/ASK on the Chain tab."
            />
          ) : (
            <>
              <div className={styles.chartTitle}>P&L at Expiry</div>
              <PayoffChart
                points={payoffPoints}
                breakevens={metrics?.breakevens ?? []}
                spotPrice={spotPrice}
                legs={legs}
                maxProfit={metrics?.maxProfit ?? null}
                maxLoss={metrics?.maxLoss ?? null}
              />
            </>
          )}
        </div>
        {legs.length > 0 && (
          <button className={styles.compareBtn} onClick={() => setShowVenues(true)}>
            Compare Venues
          </button>
        )}
      </div>

      {showVenues && (
        <>
          <div className={styles.backdrop} onClick={() => setShowVenues(false)} />
          <VenueSlideover
            legs={legs}
            chain={chain ?? null}
            activeVenues={activeVenues}
            onClose={() => setShowVenues(false)}
          />
        </>
      )}
    </div>
  );
}
