import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { createChart, LineSeries, type IChartApi, type ISeriesApi, ColorType } from "lightweight-charts";

import { useAppStore } from "@stores/app-store";
import { chainKeys, useExpiries, useUnderlyings } from "@features/chain/queries";
import { fetchJson } from "@lib/http";
import { Spinner, DropdownPicker } from "@components/ui";
import { VENUE_LIST } from "@lib/venue-meta";
import { formatExpiry, dteDays } from "@lib/format";

import { getTokenLogo } from "@lib/token-meta";
import type { EnrichedChainResponse } from "@shared/enriched";
import styles from "./VolSmile.module.css";

type XAxisMode = "strike" | "delta";

const ALL_VENUES = ["deribit", "okx", "bybit", "binance", "derive"];

const EXPIRY_COLORS = [
  "#50D2C1", "#7B61FF", "#00E997", "#F7A600", "#CB3855",
  "#4A9EFF", "#FF6B8A", "#A3E635", "#F472B6", "#38BDF8",
  "#FACC15", "#E879F9", "#34D399", "#FB923C", "#818CF8",
  "#22D3EE",
];

interface SmilePoint {
  strike: number;
  iv:     number;
}

function averageIv(
  venues: Record<string, { markIv?: number | null } | undefined>,
  activeVenues: string[],
): number | null {
  let sum = 0;
  let count = 0;
  for (const [venueId, quote] of Object.entries(venues)) {
    if (!activeVenues.includes(venueId) || quote?.markIv == null) continue;
    sum += quote.markIv;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

function averageDelta(
  venues: Record<string, { delta?: number | null } | undefined>,
  activeVenues: string[],
): number | null {
  let sum = 0;
  let count = 0;
  for (const [venueId, quote] of Object.entries(venues)) {
    if (!activeVenues.includes(venueId) || quote?.delta == null) continue;
    sum += quote.delta;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

// Delta mode x-axis: put side 0.05→0.50 (OTM put→ATM), call side 0.50→0.95 (ATM→OTM call)
// Put:  x = |put_delta|        (5P=0.05, 25P=0.25, ATM=0.50)
// Call: x = 1 - call_delta     (ATM=0.50, 25C=0.75, 5C=0.95)
const DELTA_BUCKET_SIZE = 0.05; // 5-delta buckets

function deltaTickLabel(x: number): string {
  if (Math.abs(x - 0.5) < 0.01) return "ATM";
  if (x < 0.5) {
    const d = Math.round(x * 100);
    return `${d}Δp`;
  }
  const d = Math.round((1 - x) * 100);
  return `${d}Δc`;
}

function extractSmile(
  strikes: EnrichedChainResponse["strikes"],
  activeVenues: string[],
  spotPrice: number | null,
  xAxis: XAxisMode,
): SmilePoint[] {
  const points: SmilePoint[] = [];

  for (const s of strikes) {
    if (xAxis === "delta") {
      // Put side: map |put_delta| → x (left half, 0→0.50)
      const putIv = averageIv(s.put.venues, activeVenues);
      const putDelta = averageDelta(s.put.venues, activeVenues);
      if (putIv != null && putDelta != null && putDelta < -0.02) {
        const x = Math.abs(putDelta); // 0.05 (5P) → 0.50 (ATM)
        points.push({ strike: x, iv: putIv * 100 });
      }

      // Call side: map (1 - call_delta) → x (right half, 0.50→1.0)
      const callIv = averageIv(s.call.venues, activeVenues);
      const callDelta = averageDelta(s.call.venues, activeVenues);
      if (callIv != null && callDelta != null && callDelta > 0.02) {
        const x = 1 - callDelta; // 0.50 (ATM) → 0.95 (5C)
        points.push({ strike: x, iv: callIv * 100 });
      }
    } else {
      const callIv = averageIv(s.call.venues, activeVenues);
      const putIv = averageIv(s.put.venues, activeVenues);
      const iv = spotPrice && s.strike < spotPrice ? putIv : callIv;
      if (iv != null) points.push({ strike: s.strike, iv: iv * 100 });
    }
  }

  if (xAxis === "strike") {
    const band = spotPrice ? spotPrice * 0.3 : Infinity;
    return points
      .filter((p) => !spotPrice || Math.abs(p.strike - spotPrice) <= band)
      .sort((a, b) => a.strike - b.strike);
  }

  // Delta mode: bucket to DELTA_BUCKET_SIZE, average within each bucket
  const buckets = new Map<number, { sum: number; count: number }>();
  for (const p of points) {
    if (p.strike < 0.03 || p.strike > 0.97) continue; // trim extreme wings
    const key = Math.round(p.strike / DELTA_BUCKET_SIZE) * DELTA_BUCKET_SIZE;
    const rounded = Math.round(key * 100) / 100; // avoid float drift
    const b = buckets.get(rounded);
    if (b) { b.sum += p.iv; b.count += 1; }
    else buckets.set(rounded, { sum: p.iv, count: 1 });
  }

  return Array.from(buckets, ([k, v]) => ({ strike: k, iv: v.sum / v.count }))
    .sort((a, b) => a.strike - b.strike);
}

export default function VolSmile() {
  const globalUnderlying = useAppStore((s) => s.underlying);

  const [localUnderlying, setLocalUnderlying] = useState(globalUnderlying);
  const underlying = localUnderlying || globalUnderlying;

  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];
  const byVenue = underlyingsData?.byVenue ?? [];

  // Which venues support the current underlying
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

  // Fall back to deribit or average if selected venue doesn't support this asset
  const effectiveVenue = selectedVenue === "average" || availableVenues.has(selectedVenue)
    ? selectedVenue
    : availableVenues.has("deribit") ? "deribit" : "average";

  const activeVenues = useMemo(
    () => effectiveVenue === "average" ? ALL_VENUES : [effectiveVenue],
    [effectiveVenue],
  );

  // Default: first 3 expiries selected
  const [selectedExpiries, setSelectedExpiries] = useState<Set<string>>(() => new Set());

  // Reset selections when underlying changes
  const handleUnderlyingChange = useCallback((value: string) => {
    // Clear all chart series immediately to avoid stale data crash
    const chart = chartApi.current;
    if (chart) {
      for (const [, series] of seriesMap.current) {
        chart.removeSeries(series);
      }
      seriesMap.current.clear();
    }
    setLocalUnderlying(value);
    setSelectedExpiries(new Set());
  }, []);

  // Auto-select all expiries when data loads and nothing is selected
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

  // Color map: each expiry gets a stable color by index
  const expiryColors = useMemo(() => {
    const map = new Map<string, string>();
    expiries.forEach((e, i) => map.set(e, EXPIRY_COLORS[i % EXPIRY_COLORS.length]!));
    return map;
  }, [expiries]);

  // Fetch chains for all selected expiries in parallel
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

  // Build a map of expiry → chain data
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

  const chartRef  = useRef<HTMLDivElement>(null);
  const chartApi  = useRef<IChartApi | null>(null);
  const seriesMap = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const xAxisRef  = useRef(xAxis);
  xAxisRef.current = xAxis;

  // Create chart once
  useEffect(() => {
    const container = chartRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0A0A0A" },
        textColor: "#555B5E",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1A1A1A" },
        horzLines: { color: "#1A1A1A" },
      },
      rightPriceScale: {
        borderColor: "#1F2937",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "#1F2937",
        tickMarkFormatter: (v: number) =>
          xAxisRef.current === "delta" ? deltaTickLabel(v) : v.toLocaleString(),
      },
      localization: {
        timeFormatter: (v: number) =>
          xAxisRef.current === "delta" ? deltaTickLabel(v) : v.toLocaleString(),
      },
      crosshair: {
        horzLine: { color: "#50D2C1", labelBackgroundColor: "#0E3333" },
        vertLine: { color: "#50D2C1", labelBackgroundColor: "#0E3333", labelVisible: false },
      },
      handleScale: { mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });

    chartApi.current = chart;

    return () => {
      chart.remove();
      chartApi.current = null;
      seriesMap.current = new Map();
    };
  }, []);

  // Sync series — tear down and recreate to avoid lightweight-charts
  // internal state bugs when calling setData on existing series
  useEffect(() => {
    const chart = chartApi.current;
    if (!chart) return;

    // Remove all existing series
    for (const series of seriesMap.current.values()) {
      chart.removeSeries(series);
    }
    seriesMap.current.clear();

    const priceFmt = { type: "custom" as const, formatter: (p: number) => `${p.toFixed(1)}%` };

    // Create series only for selected expiries with data
    for (const exp of expiries) {
      const chain = chainMap.get(exp);
      if (!selectedExpiries.has(exp) || !chain) continue;

      const spot = chain.stats.spotIndexUsd;
      const points = extractSmile(chain.strikes, activeVenues, spot, xAxis);

      // Deduplicate and validate
      const seen = new Set<number>();
      const clean: Array<{ time: number; value: number }> = [];
      for (const p of points) {
        if (!Number.isFinite(p.strike) || !Number.isFinite(p.iv)) continue;
        const t = p.strike;
        if (seen.has(t)) continue;
        seen.add(t);
        clean.push({ time: t, value: p.iv });
      }
      clean.sort((a, b) => a.time - b.time);
      if (clean.length === 0) continue;

      const color = expiryColors.get(exp) ?? "#555";
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        title: "",
        priceFormat: priceFmt,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      series.setData(clean as never);
      seriesMap.current.set(exp, series);
    }

    chart.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiries.join(","), selectedExpiries, chainMap, activeVenues.join(","), expiryColors, xAxis]);

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
          <div className={styles.chartWrap} ref={chartRef} />
        </div>
      </div>
    </div>
  );
}
