import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { createChart, LineSeries, type IChartApi, type ISeriesApi, ColorType } from "lightweight-charts";

import { useAppStore } from "@stores/app-store";
import { useUnderlyings } from "@features/chain/queries";
import { Spinner, DropdownPicker } from "@components/ui";
import { VENUE_LIST } from "@lib/venue-meta";
import { formatExpiry } from "@lib/format";
import { getTokenLogo } from "@lib/token-meta";
import type { VenueAtmPoint } from "@shared/enriched";
import { useSurface } from "./queries";
import styles from "./AtmTermStructure.module.css";

const AVG_COLOR = "#50D2C1";

const VENUE_COLOR_OVERRIDES: Record<string, string> = {
  derive: "#E8622A",
};

function getVenueColor(venueId: string, defaultColor: string): string {
  return VENUE_COLOR_OVERRIDES[venueId] ?? defaultColor;
}

export default function AtmTermStructure() {
  const globalUnderlying = useAppStore((s) => s.underlying);

  const [localUnderlying, setLocalUnderlying] = useState(globalUnderlying);
  const underlying = localUnderlying || globalUnderlying;

  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];

  const [enabledVenues, setEnabledVenues] = useState<Set<string>>(() => new Set());
  const [showAverage, setShowAverage] = useState(true);

  // Fetch surface with all venues so we always have per-venue data
  const allVenueIds = VENUE_LIST.map((v) => v.id);
  const { data, isLoading } = useSurface(underlying, allVenueIds);
  const venueAtm = data?.venueAtm ?? {};
  const surface = data?.surface ?? [];

  // Build DTE → expiry lookup for crosshair labels
  const dteToExpiry = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of surface) {
      if (row.dte > 0) map.set(row.dte, row.expiry);
    }
    return map;
  }, [surface]);

  const handleUnderlyingChange = useCallback((value: string) => {
    setLocalUnderlying(value);
  }, []);

  const toggleVenue = useCallback((venueId: string) => {
    setEnabledVenues((prev) => {
      const next = new Set(prev);
      if (next.has(venueId)) {
        next.delete(venueId);
      } else {
        next.add(venueId);
      }
      return next;
    });
  }, []);

  const chartRef  = useRef<HTMLDivElement>(null);
  const chartApi  = useRef<IChartApi | null>(null);
  const seriesMap = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const dteToExpiryRef = useRef(dteToExpiry);
  dteToExpiryRef.current = dteToExpiry;

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
        tickMarkFormatter: (v: number) => `${v}d`,
      },
      crosshair: {
        horzLine: { color: "#50D2C1", labelBackgroundColor: "#0E3333" },
        vertLine: { color: "#50D2C1", labelBackgroundColor: "#0E3333" },
      },
      localization: {
        timeFormatter: (v: number) => {
          const expiry = dteToExpiryRef.current.get(v);
          if (expiry) return `${formatExpiry(expiry)} (${v}d)`;
          return `${v}d`;
        },
      },
      handleScale: { mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });

    const priceFmt = { type: "custom" as const, formatter: (p: number) => `${p.toFixed(1)}%` };

    // Create a series per venue
    for (const venue of VENUE_LIST) {
      const series = chart.addSeries(LineSeries, {
        color: getVenueColor(venue.id, venue.color),
        lineWidth: 2,
        title: venue.shortLabel,
        priceFormat: priceFmt,
        visible: false,
      });
      seriesMap.current.set(venue.id, series);
    }

    // Average series
    const avgSeries = chart.addSeries(LineSeries, {
      color: AVG_COLOR,
      lineWidth: 2,
      title: "AVG",
      priceFormat: priceFmt,
      visible: false,
    });
    seriesMap.current.set("__avg__", avgSeries);

    chartApi.current = chart;

    return () => {
      chart.remove();
      chartApi.current = null;
      seriesMap.current = new Map();
    };
  }, []);

  useEffect(() => {
    if (!chartApi.current) return;

    const toPoints = (points: VenueAtmPoint[]) =>
      points
        .filter((p) => p.atm != null && p.dte > 0)
        .sort((a, b) => a.dte - b.dte)
        .map((p) => ({ time: p.dte as unknown as number, value: p.atm! * 100 })) as never;

    // Update each venue series
    for (const venue of VENUE_LIST) {
      const series = seriesMap.current.get(venue.id);
      if (!series) continue;
      const visible = enabledVenues.has(venue.id);
      const points = venueAtm[venue.id] ?? [];
      series.setData(visible ? toPoints(points) : []);
      series.applyOptions({ visible });
    }

    // Update average series
    const avgSeries = seriesMap.current.get("__avg__");
    if (avgSeries) {
      const avgPoints = surface
        .filter((r) => r.atm != null && r.dte > 0)
        .sort((a, b) => a.dte - b.dte)
        .map((r) => ({ time: r.dte as unknown as number, value: r.atm! * 100 })) as never;
      avgSeries.setData(showAverage ? avgPoints : []);
      avgSeries.applyOptions({ visible: showAverage });
    }

    chartApi.current.timeScale().fitContent();
  }, [venueAtm, surface, enabledVenues, showAverage]);

  if (isLoading && surface.length === 0) {
    return (
      <div className={styles.wrap}>
        <Spinner size="md" label="Loading term structure…" />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>ATM Volatility Term Structure</span>
        <DropdownPicker
          size="sm"
          value={underlying}
          onChange={handleUnderlyingChange}
          options={underlyings.map((u) => ({ value: u, label: u, icon: getTokenLogo(u) }))}
        />
      </div>

      <div className={styles.venues}>
        <label className={styles.venueCheck}>
          <input
            type="checkbox"
            checked={showAverage}
            onChange={() => setShowAverage((v) => !v)}
          />
          <span className={styles.venueColor} style={{ background: AVG_COLOR }} />
          <span className={styles.venueLabel}>Average</span>
        </label>

        {VENUE_LIST.map((venue) => {
          const color = getVenueColor(venue.id, venue.color);
          return (
            <label key={venue.id} className={styles.venueCheck}>
              <input
                type="checkbox"
                checked={enabledVenues.has(venue.id)}
                onChange={() => toggleVenue(venue.id)}
              />
              <span className={styles.venueColor} style={{ background: color }} />
              <img src={venue.logo} alt={venue.shortLabel} className={styles.venueLogo} />
              <span className={styles.venueLabel}>{venue.label}</span>
            </label>
          );
        })}
      </div>

      <div className={styles.chartArea}>
        <div className={styles.chartWrap} ref={chartRef} />
      </div>
    </div>
  );
}
