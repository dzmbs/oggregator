import { useState, useCallback, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Plot, PLOTLY_CONFIG } from "./plotly";

import { useAppStore } from "@stores/app-store";
import { chainKeys, useExpiries, useUnderlyings } from "@features/chain/queries";
import { fetchJson } from "@lib/http";
import { Spinner, DropdownPicker } from "@components/ui";
import { VENUE_LIST } from "@lib/venue-meta";
import { formatExpiry, dteDays } from "@lib/format";
import { getTokenLogo } from "@lib/token-meta";
import type { EnrichedChainResponse } from "@shared/enriched";
import { extractSmile, deltaTickLabel } from "./smile-utils";
import styles from "./VolSurface3D.module.css";

const ALL_VENUES = ["deribit", "okx", "bybit", "binance", "derive"];

const DELTA_TICKS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95];
const DELTA_TICK_LABELS = DELTA_TICKS.map(deltaTickLabel);

interface SurfaceGrid {
  x: number[];
  y: number[];
  z: (number | null)[][];
  yLabels: string[];
}

function buildSurfaceGrid(
  expiries: string[],
  chainMap: Map<string, EnrichedChainResponse>,
  activeVenues: string[],
): SurfaceGrid {
  const x = DELTA_TICKS;
  const y: number[] = [];
  const yLabels: string[] = [];
  const z: (number | null)[][] = [];

  // Sort expiries by DTE
  const sorted = [...expiries]
    .map((e) => ({ expiry: e, dte: dteDays(e) }))
    .filter((e) => e.dte > 0)
    .sort((a, b) => a.dte - b.dte);

  for (const { expiry, dte } of sorted) {
    const chain = chainMap.get(expiry);
    if (!chain) continue;

    const spot = chain.stats.spotIndexUsd;
    const smile = extractSmile(chain.strikes, activeVenues, spot, "delta");

    // Build a lookup from delta bucket → IV
    const ivByDelta = new Map<number, number>();
    for (const p of smile) {
      const key = Math.round(p.strike * 100) / 100;
      ivByDelta.set(key, p.iv);
    }

    // Create row aligned to DELTA_TICKS
    const row = x.map((d) => ivByDelta.get(d) ?? null);

    // Only include if we have at least some data
    if (row.some((v) => v != null)) {
      y.push(dte);
      yLabels.push(formatExpiry(expiry));
      z.push(row);
    }
  }

  return { x, y, z, yLabels };
}

interface Props {
  defaultUnderlying?: string;
}

export default function VolSurface3D({ defaultUnderlying }: Props) {
  const globalUnderlying = useAppStore((s) => s.underlying);

  const [localUnderlying, setLocalUnderlying] = useState(defaultUnderlying ?? globalUnderlying);
  const underlying = localUnderlying || globalUnderlying;

  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];
  const byVenue = underlyingsData?.byVenue ?? [];

  const availableVenues = useMemo(() => {
    const set = new Set<string>();
    for (const v of byVenue) {
      if (v.underlyings.includes(underlying)) set.add(v.venue);
    }
    return set;
  }, [byVenue, underlying]);

  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];

  const [selectedVenue, setSelectedVenue] = useState("deribit");
  const effectiveVenue = selectedVenue === "average" || availableVenues.has(selectedVenue)
    ? selectedVenue
    : availableVenues.has("deribit") ? "deribit" : "average";
  const activeVenues = useMemo(
    () => effectiveVenue === "average" ? ALL_VENUES : [effectiveVenue],
    [effectiveVenue],
  );

  const handleUnderlyingChange = useCallback((value: string) => {
    setLocalUnderlying(value);
  }, []);

  // Fetch chains for all expiries in parallel
  const venueParam = `&venues=${ALL_VENUES.join(",")}`;
  const chainQueries = useQueries({
    queries: expiries.map((exp) => ({
      queryKey: chainKeys.chain(underlying, exp, ALL_VENUES),
      queryFn: () => fetchJson<EnrichedChainResponse>(
        `/chains?underlying=${underlying}&expiry=${exp}${venueParam}`,
      ),
      enabled: Boolean(underlying && exp),
      staleTime: 15_000,
    })),
  });

  const chainDataKey = chainQueries.map((q) => q.dataUpdatedAt).join(",");
  const chainMap = useMemo(() => {
    const map = new Map<string, EnrichedChainResponse>();
    expiries.forEach((exp, i) => {
      const data = chainQueries[i]?.data;
      if (data) map.set(exp, data);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainDataKey, expiries.join(",")]);

  const grid = useMemo(
    () => buildSurfaceGrid(expiries, chainMap, activeVenues),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expiries.join(","), chainMap, activeVenues.join(",")],
  );

  const isAnyLoading = chainQueries.some((q) => q.isLoading && q.fetchStatus !== "idle");
  const hasData = grid.z.length > 0;

  const plotData = useMemo((): Partial<Plotly.PlotData>[] => {
    if (!hasData) return [];
    return [{
      type: "surface" as const,
      x: grid.x,
      y: grid.y,
      z: grid.z,
      colorscale: [
        [0, "#1e40af"],
        [0.35, "#60a5fa"],
        [0.5, "#f5f5f5"],
        [0.7, "#fb923c"],
        [1, "#ea580c"],
      ],
      showscale: true,
      colorbar: {
        title: { text: "IV %", font: { color: "#888", size: 11 } },
        tickfont: { color: "#888", size: 10, family: "'IBM Plex Mono', monospace" },
        bgcolor: "rgba(0,0,0,0)",
        thickness: 12,
        len: 0.6,
      },
      hovertemplate:
        "Delta: %{x}<br>Expiry: %{text}<br>IV: %{z:.1f}%<extra></extra>",
      text: grid.yLabels.map((label, i) => `${label} (${grid.y[i]}d)`),
      contours: {
        z: { show: true, usecolormap: true, highlightcolor: "#fff", project: { z: false } },
      } as never,
    }];
  }, [hasData, grid]);

  const plotLayout = useMemo((): Partial<Plotly.Layout> => ({
    autosize: true,
    paper_bgcolor: "#0A0A0A",
    plot_bgcolor: "#0A0A0A",
    font: { family: "'IBM Plex Mono', monospace", size: 11, color: "#555B5E" },
    scene: {
      xaxis: {
        title: "" as never,
        tickvals: DELTA_TICKS.filter((_, i) => i % 2 === 0),
        ticktext: DELTA_TICK_LABELS.filter((_, i) => i % 2 === 0),
        gridcolor: "#1A1A1A",
        color: "#555B5E",
        showbackground: false,
      },
      yaxis: {
        title: "" as never,
        tickvals: grid.y,
        ticktext: grid.yLabels,
        gridcolor: "#1A1A1A",
        color: "#555B5E",
        showbackground: false,
      },
      zaxis: {
        title: "" as never,
        ticksuffix: "%",
        gridcolor: "#1A1A1A",
        color: "#555B5E",
        showbackground: false,
      },
      bgcolor: "#0A0A0A",
      camera: { eye: { x: 1.5, y: -1.5, z: 0.7 } },
      aspectratio: { x: 1.4, y: 1.2, z: 0.8 },
    },
    margin: { l: 0, r: 0, t: 0, b: 0 },
  }), [grid.y, grid.yLabels]);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>IV Surface</span>
        <DropdownPicker
          size="sm"
          value={underlying}
          onChange={handleUnderlyingChange}
          options={underlyings.map((u) => ({ value: u, label: u, icon: getTokenLogo(u) }))}
        />
        <DropdownPicker
          size="sm"
          value={effectiveVenue}
          onChange={setSelectedVenue}
          options={[
            ...VENUE_LIST.map((v) => ({
              value: v.id,
              label: v.label,
              icon: v.logo,
              disabled: !availableVenues.has(v.id),
            })),
            { value: "average", label: "Average" },
          ]}
        />
        {isAnyLoading && <Spinner size="sm" />}
      </div>

      <div className={styles.chartArea}>
        {hasData ? (
          <Plot
            data={plotData}
            layout={plotLayout}
            config={PLOTLY_CONFIG}
            useResizeHandler
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <div className={styles.empty}>
            {isAnyLoading
              ? <Spinner size="md" label="Loading surface…" />
              : <span>No surface data available</span>
            }
          </div>
        )}
      </div>
    </div>
  );
}
