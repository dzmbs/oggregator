import { useState, useCallback, useMemo, useEffect } from "react";
import { useQueries } from "@tanstack/react-query";

import { useAppStore } from "@stores/app-store";
import { chainKeys, useExpiries, useUnderlyings } from "@features/chain/queries";
import { fetchJson } from "@lib/http";
import { Spinner, DropdownPicker } from "@components/ui";
import { VENUE_LIST } from "@lib/venue-meta";
import { formatExpiry, dteDays } from "@lib/format";
import { getTokenLogo } from "@lib/token-meta";
import type { EnrichedChainResponse } from "@shared/enriched";
import { extractSmile, deltaTickLabel, type XAxisMode } from "./smile-utils";
import { Plot, PLOTLY_LAYOUT_BASE, PLOTLY_CONFIG } from "./plotly";
import styles from "./VolSmile.module.css";

const ALL_VENUES = ["deribit", "okx", "bybit", "binance", "derive"];

const EXPIRY_COLORS = [
  "#50D2C1", "#7B61FF", "#00E997", "#F7A600", "#CB3855",
  "#4A9EFF", "#FF6B8A", "#A3E635", "#F472B6", "#38BDF8",
  "#FACC15", "#E879F9", "#34D399", "#FB923C", "#818CF8",
  "#22D3EE",
];

interface Props {
  defaultUnderlying?: string;
}

export default function VolSmile({ defaultUnderlying }: Props) {
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

  const [xAxis, setXAxis] = useState<XAxisMode>("strike");
  const [selectedVenue, setSelectedVenue] = useState("deribit");

  const effectiveVenue = selectedVenue === "average" || availableVenues.has(selectedVenue)
    ? selectedVenue
    : availableVenues.has("deribit") ? "deribit" : "average";

  const activeVenues = useMemo(
    () => effectiveVenue === "average" ? ALL_VENUES : [effectiveVenue],
    [effectiveVenue],
  );

  const [selectedExpiries, setSelectedExpiries] = useState<Set<string>>(() => new Set());

  const handleUnderlyingChange = useCallback((value: string) => {
    setLocalUnderlying(value);
    setSelectedExpiries(new Set());
  }, []);

  useEffect(() => {
    if (expiries.length > 0 && selectedExpiries.size === 0) {
      setSelectedExpiries(new Set(expiries));
    }
  }, [expiries]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpiry = useCallback((exp: string) => {
    setSelectedExpiries((prev) => {
      const next = new Set(prev);
      if (next.has(exp)) next.delete(exp);
      else next.add(exp);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedExpiries((prev) => {
      if (prev.size === expiries.length) return new Set();
      return new Set(expiries);
    });
  }, [expiries]);

  const expiryColors = useMemo(() => {
    const map = new Map<string, string>();
    expiries.forEach((e, i) => map.set(e, EXPIRY_COLORS[i % EXPIRY_COLORS.length]!));
    return map;
  }, [expiries]);

  const venueParam = `&venues=${ALL_VENUES.join(",")}`;
  const chainQueries = useQueries({
    queries: expiries.map((exp) => ({
      queryKey: chainKeys.chain(underlying, exp, ALL_VENUES),
      queryFn: () => fetchJson<EnrichedChainResponse>(
        `/chains?underlying=${underlying}&expiry=${exp}${venueParam}`,
      ),
      enabled: Boolean(underlying && exp && selectedExpiries.has(exp)),
      placeholderData: (prev: EnrichedChainResponse | undefined) => prev,
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

  // Build Plotly traces — one line per selected expiry
  const plotData = useMemo(() => {
    const traces: Partial<Plotly.PlotData>[] = [];

    for (const exp of expiries) {
      if (!selectedExpiries.has(exp)) continue;
      const chain = chainMap.get(exp);
      if (!chain) continue;

      const spot = chain.stats.spotIndexUsd;
      const points = extractSmile(chain.strikes, activeVenues, spot, xAxis);
      if (points.length === 0) continue;

      // Deduplicate
      const seen = new Set<number>();
      const x: number[] = [];
      const y: number[] = [];
      for (const p of points) {
        if (!Number.isFinite(p.strike) || !Number.isFinite(p.iv)) continue;
        if (seen.has(p.strike)) continue;
        seen.add(p.strike);
        x.push(p.strike);
        y.push(p.iv);
      }

      traces.push({
        type: "scatter",
        mode: "lines",
        x,
        y,
        name: formatExpiry(exp),
        line: { color: expiryColors.get(exp) ?? "#555", width: 2 },
        hovertemplate: `${formatExpiry(exp)} (${dteDays(exp)}d)<br>%{x}<br>IV: %{y:.1f}%<extra></extra>`,
      });
    }

    return traces;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiries.join(","), selectedExpiries, chainMap, activeVenues.join(","), expiryColors, xAxis]);

  const plotLayout = useMemo((): Partial<Plotly.Layout> => {
    const tickvals = xAxis === "delta"
      ? [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95]
      : undefined;
    const ticktext = tickvals?.map(deltaTickLabel);

    return {
      ...PLOTLY_LAYOUT_BASE,
      xaxis: {
        ...PLOTLY_LAYOUT_BASE.xaxis,
        tickvals,
        ticktext,
        title: xAxis === "delta" ? undefined : { text: "Strike", font: { size: 11 } },
      },
      yaxis: {
        ...PLOTLY_LAYOUT_BASE.yaxis,
        title: { text: "IV", font: { size: 11 } },
      },
    };
  }, [xAxis]);

  const isAnyLoading = chainQueries.some((q) => q.isLoading && q.fetchStatus !== "idle");

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Volatility Smile</span>
        <DropdownPicker
          size="sm"
          value={underlying}
          onChange={handleUnderlyingChange}
          options={underlyings.map((u) => ({ value: u, label: u, icon: getTokenLogo(u) }))}
        />
        <div className={styles.modePicker}>
          {(["delta", "strike"] as const).map((m) => (
            <button
              key={m}
              className={styles.modeBtn}
              data-active={m === xAxis}
              onClick={() => setXAxis(m)}
            >
              {m === "delta" ? "Delta" : "Strike"}
            </button>
          ))}
        </div>
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

      <div className={styles.body}>
        <div className={styles.sidebar}>
          <button
            type="button"
            className={styles.allBtn}
            data-active={selectedExpiries.size === expiries.length || undefined}
            onClick={toggleAll}
          >
            All
          </button>

          {expiries.map((exp) => {
            const color = expiryColors.get(exp) ?? "#555";
            const dte = dteDays(exp);
            const selected = selectedExpiries.has(exp);
            return (
              <button
                key={exp}
                type="button"
                className={styles.expiryBtn}
                data-active={selected || undefined}
                onClick={() => toggleExpiry(exp)}
              >
                <span className={styles.expiryLabel} style={{ color: selected ? color : undefined }}>
                  {formatExpiry(exp)}
                </span>
                <span className={styles.expiryLine} style={{ background: color }} />
                <span className={styles.expiryDte}>{dte}d</span>
              </button>
            );
          })}
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
    </div>
  );
}
