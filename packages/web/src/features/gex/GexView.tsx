import type { GexStrike } from "@shared/enriched";

import { AssetPickerButton } from "@components/ui";
import { fmtUsd } from "@lib/format";
import styles from "./GexView.module.css";

interface GexViewProps {
  gex:      GexStrike[];
  spotPrice: number | null;
}

export default function GexView({ gex, spotPrice }: GexViewProps) {
  if (gex.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>◈</div>
        <div className={styles.emptyTitle}>Insufficient GEX data</div>
        <div className={styles.emptyDesc}>
          GEX requires open interest and gamma data. This expiry may not have
          enough data yet, or all venues returned null for OI.
        </div>
      </div>
    );
  }

  const maxMagnitude = Math.max(...gex.map((g) => Math.abs(g.gexUsdMillions)), 1);

  // Sort by strike descending (high → low) for vertical chart readability
  const sorted = [...gex].sort((a, b) => b.strike - a.strike);

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <span className={styles.title}>Gamma Exposure (GEX)</span>
            <AssetPickerButton />
          </div>
          <span className={styles.subtitle}>
            USD millions · positive = price magnet · negative = accelerator
          </span>
        </div>
        {spotPrice != null && (
          <div className={styles.spotBadge}>
            Spot: {fmtUsd(spotPrice)}
          </div>
        )}
      </div>

      <div className={styles.explain}>
        <span className={styles.explainItem} data-type="positive">
          <span className={styles.explainDot} data-type="positive" />
          Positive GEX — dealers are long gamma → they sell into rallies, buy dips → acts as a price magnet
        </span>
        <span className={styles.explainItem} data-type="negative">
          <span className={styles.explainDot} data-type="negative" />
          Negative GEX — dealers are short gamma → they buy into rallies, sell dips → accelerates moves
        </span>
      </div>

      <div className={styles.chart}>
        {/* Zero axis */}
        <div className={styles.axis}>
          <div className={styles.axisLeft}>
            <span className={styles.axisLabel}>← Negative (accelerator)</span>
          </div>
          <div className={styles.axisCenter}>0</div>
          <div className={styles.axisRight}>
            <span className={styles.axisLabel}>Positive (magnet) →</span>
          </div>
        </div>

        <div className={styles.bars}>
          {sorted.map((g) => {
            const pct      = (Math.abs(g.gexUsdMillions) / maxMagnitude) * 100;
            const positive = g.gexUsdMillions >= 0;
            const isNearSpot = spotPrice != null && Math.abs(g.strike - spotPrice) / spotPrice < 0.005;

            return (
              <div key={g.strike} className={styles.barRow} data-near-spot={isNearSpot}>
                <div className={styles.strikeLabel} data-near-spot={isNearSpot}>
                  {g.strike.toLocaleString()}
                  {isNearSpot && <span className={styles.spotMarker}>◄ SPOT</span>}
                </div>
                <div className={styles.barTrack}>
                  {/* Negative bar extends left from center */}
                  <div className={styles.leftHalf}>
                    {!positive && (
                      <div
                        className={styles.bar}
                        data-type="negative"
                        style={{ width: `${pct}%` }}
                        title={`${g.strike}: ${g.gexUsdMillions.toFixed(1)}M USD GEX`}
                      />
                    )}
                  </div>
                  {/* Center spine */}
                  <div className={styles.spine} />
                  {/* Positive bar extends right from center */}
                  <div className={styles.rightHalf}>
                    {positive && (
                      <div
                        className={styles.bar}
                        data-type="positive"
                        style={{ width: `${pct}%` }}
                        title={`${g.strike}: +${g.gexUsdMillions.toFixed(1)}M USD GEX`}
                      />
                    )}
                  </div>
                </div>
                <div className={styles.valueLabel}>
                  {positive ? "+" : ""}{g.gexUsdMillions.toFixed(1)}M
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
