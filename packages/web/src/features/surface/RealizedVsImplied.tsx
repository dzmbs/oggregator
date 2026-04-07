import { useState, useCallback, useMemo } from "react";

import { useAppStore } from "@stores/app-store";
import { Spinner, DropdownPicker } from "@components/ui";
import { getTokenLogo } from "@lib/token-meta";
import { VENUES } from "@lib/venue-meta";
import { useDvolHistory } from "@features/dvol";
import { Plot, PLOTLY_LAYOUT_BASE, PLOTLY_CONFIG } from "./plotly";
import styles from "./RealizedVsImplied.module.css";

const IV_COLOR = "#50D2C1";
const HV_COLOR = "#F7A600";
const CURRENCIES = ["BTC", "ETH"];

interface Props {
  defaultUnderlying?: string;
}

export default function RealizedVsImplied({ defaultUnderlying }: Props) {
  const globalUnderlying = useAppStore((s) => s.underlying);

  const initial = defaultUnderlying ?? globalUnderlying;
  const [localUnderlying, setLocalUnderlying] = useState(
    CURRENCIES.includes(initial) ? initial : "BTC",
  );

  const handleUnderlyingChange = useCallback((value: string) => {
    setLocalUnderlying(value);
  }, []);

  const { data, isLoading } = useDvolHistory(localUnderlying);

  const plotData = useMemo(() => {
    if (!data) return [];

    const traces: Partial<Plotly.PlotData>[] = [];

    // IV (DVOL) trace — deduplicate timestamps
    if (data.candles.length > 0) {
      const seen = new Set<number>();
      const x: string[] = [];
      const y: number[] = [];
      for (const c of data.candles) {
        const key = Math.floor(c.timestamp / 1000);
        if (seen.has(key)) continue;
        seen.add(key);
        x.push(new Date(c.timestamp).toISOString());
        y.push(c.close);
      }
      traces.push({
        type: "scatter",
        mode: "lines",
        x,
        y,
        name: "IV (DVOL)",
        line: { color: IV_COLOR, width: 2 },
        hovertemplate: "%{x|%b %d, %Y}<br>IV: %{y:.1f}%<extra></extra>",
      });
    }

    // HV (Realized) trace — deduplicate timestamps
    if (data.hv.length > 0) {
      const seen = new Set<number>();
      const x: string[] = [];
      const y: number[] = [];
      for (const p of data.hv) {
        const key = Math.floor(p.timestamp / 1000);
        if (seen.has(key)) continue;
        seen.add(key);
        x.push(new Date(p.timestamp).toISOString());
        y.push(p.value);
      }
      traces.push({
        type: "scatter",
        mode: "lines",
        x,
        y,
        name: "HV (Realized)",
        line: { color: HV_COLOR, width: 2 },
        hovertemplate: "%{x|%b %d, %Y}<br>HV: %{y:.1f}%<extra></extra>",
      });
    }

    return traces;
  }, [data]);

  const plotLayout = useMemo(
    (): Partial<Plotly.Layout> => ({
      ...PLOTLY_LAYOUT_BASE,
      xaxis: {
        ...PLOTLY_LAYOUT_BASE.xaxis,
        type: "date",
      },
      yaxis: {
        ...PLOTLY_LAYOUT_BASE.yaxis,
        title: { text: "Volatility", font: { size: 11 } },
      },
      showlegend: false,
    }),
    [],
  );

  if (isLoading && !data) {
    return (
      <div className={styles.wrap}>
        <Spinner size="md" label="Loading volatility history…" />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Realized vs Implied Volatility</span>
        <DropdownPicker
          size="sm"
          value={localUnderlying}
          onChange={handleUnderlyingChange}
          options={CURRENCIES.map((c) => ({ value: c, label: c, icon: getTokenLogo(c) }))}
        />
        <div className={styles.legend}>
          <span className={styles.legendSwatch} style={{ background: IV_COLOR }} />
          <span className={styles.legendLabel} data-tooltip="Deribit Volatility Index — 30-day implied volatility derived from options prices">
            IV (<img src={VENUES["deribit"]!.logo} alt="" className={styles.inlineLogo} />DVOL)
          </span>
          <span className={styles.legendSwatch} style={{ background: HV_COLOR }} />
          <span className={styles.legendLabel} data-tooltip="30-day rolling realized volatility computed from daily index closes">HV (Realized)</span>
        </div>
      </div>

      <div className={styles.chartArea}>
        <Plot
          data={plotData}
          layout={plotLayout}
          config={PLOTLY_CONFIG}
          style={{ width: "100%", height: "350px" }}
        />
      </div>
    </div>
  );
}
