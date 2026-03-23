import type { IvSurfaceRow, TermStructure } from "@shared/enriched";

import { useAppStore } from "@stores/app-store";
import { Spinner, EmptyState, AssetPickerButton, VenueIndicator } from "@components/ui";
import { fmtIv, formatExpiry, dteDays } from "@lib/format";
import { heatmapColor } from "@lib/colors";
import { useSurface } from "./queries";
import VolSmile from "./VolSmile";
import styles from "./SurfaceView.module.css";

const DELTA_COLS = [
  { key: "delta10p" as const, label: "10Δp", title: "10-delta put (deep OTM put)" },
  { key: "delta25p" as const, label: "25Δp", title: "25-delta put" },
  { key: "atm"      as const, label: "ATM",  title: "At-the-money" },
  { key: "delta25c" as const, label: "25Δc", title: "25-delta call" },
  { key: "delta10c" as const, label: "10Δc", title: "10-delta call (deep OTM call)" },
];

function termStructureColor(ts: TermStructure): string {
  if (ts === "contango")     return "var(--color-profit)";
  if (ts === "backwardation") return "var(--color-loss)";
  return "var(--text-secondary)";
}

function termStructureDesc(ts: TermStructure): string {
  if (ts === "contango")     return "Far vol > near vol (normal)";
  if (ts === "backwardation") return "Near vol > far vol (stressed)";
  return "Near ≈ far vol";
}

interface HeatCellProps {
  iv:      number | null;
  minIv:   number;
  maxIv:   number;
}

function HeatCell({ iv, minIv, maxIv }: HeatCellProps) {
  if (iv == null) {
    return <td className={styles.cell} data-empty="true">–</td>;
  }
  const range = maxIv - minIv;
  const norm  = range > 0 ? (iv - minIv) / range : 0.5;
  const bg    = heatmapColor(Math.max(0, Math.min(1, norm)));

  return (
    <td
      className={styles.cell}
      style={{ background: `${bg}22`, color: bg }}
      title={`IV: ${(iv * 100).toFixed(2)}%`}
    >
      {fmtIv(iv)}
    </td>
  );
}

function computeMinMax(rows: IvSurfaceRow[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    for (const col of DELTA_COLS) {
      const v = row[col.key];
      if (v != null) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 1 : max };
}

export default function SurfaceView() {
  const underlying   = useAppStore((s) => s.underlying);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const { data, isLoading, error } = useSurface(underlying, activeVenues);

  if (isLoading) {
    return (
      <div className={styles.view}>
        <Spinner size="lg" label="Loading IV surface…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.view}>
        <EmptyState
          icon="⚠"
          title="Failed to load surface"
          detail={error instanceof Error ? error.message : "Check your connection and try again."}
        />
      </div>
    );
  }

  if (!data || data.surface.length === 0) {
    return (
      <div className={styles.view}>
        <EmptyState icon="∅" title="No surface data available" />
      </div>
    );
  }

  const { min: minIv, max: maxIv } = computeMinMax(data.surface);
  const tsColor = termStructureColor(data.termStructure);
  const tsDesc  = termStructureDesc(data.termStructure);

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <span className={styles.title}>IV Surface</span>
            <AssetPickerButton />
          </div>
          <span className={styles.subtitle}>
            Best IV (lowest mark) per delta level and expiry · <VenueIndicator />
          </span>
        </div>
        <div className={styles.termStructure}>
          <span className={styles.tsLabel}>Term Structure</span>
          <span className={styles.tsValue} style={{ color: tsColor }}>
            {data.termStructure.toUpperCase()}
          </span>
          <span className={styles.tsDesc}>{tsDesc}</span>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thExpiry}>Expiry</th>
              <th className={styles.thDte}>DTE</th>
              {DELTA_COLS.map((col) => (
                <th key={col.key} className={styles.th} title={col.title}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.surface.map((row) => {
              const dte = dteDays(row.expiry);
              return (
                <tr key={row.expiry} className={styles.row}>
                  <td className={styles.tdExpiry}>{formatExpiry(row.expiry)}</td>
                  <td className={styles.tdDte} data-urgent={dte <= 1}>
                    {dte}d
                  </td>
                  {DELTA_COLS.map((col) => (
                    <HeatCell key={col.key} iv={row[col.key]} minIv={minIv} maxIv={maxIv} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.legend}>
        <span className={styles.legendLabel}>IV Scale:</span>
        <div className={styles.legendBar} />
        <span className={styles.legendMin}>{fmtIv(minIv)} low</span>
        <span className={styles.legendMax}>high {fmtIv(maxIv)}</span>
      </div>

      <div className={styles.smileWrap}>
        <VolSmile />
      </div>
    </div>
  );
}
