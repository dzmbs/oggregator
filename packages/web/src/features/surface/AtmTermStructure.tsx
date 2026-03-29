import { useState, useCallback, useMemo } from "react";

import { useAppStore } from "@stores/app-store";
import { useUnderlyings } from "@features/chain/queries";
import { Spinner, DropdownPicker } from "@components/ui";
import { VENUE_LIST } from "@lib/venue-meta";
import { formatExpiry } from "@lib/format";
import { getTokenLogo } from "@lib/token-meta";
import type { VenueAtmPoint } from "@shared/enriched";
import { useSurface } from "./queries";
import { Plot, PLOTLY_LAYOUT_BASE, PLOTLY_CONFIG } from "./plotly";
import styles from "./AtmTermStructure.module.css";

const AVG_COLOR = "#50D2C1";

const VENUE_COLOR_OVERRIDES: Record<string, string> = {
  derive: "#E8622A",
};

function getVenueColor(venueId: string, defaultColor: string): string {
  return VENUE_COLOR_OVERRIDES[venueId] ?? defaultColor;
}

interface Props {
  defaultUnderlying?: string;
}

export default function AtmTermStructure({ defaultUnderlying }: Props) {
  const globalUnderlying = useAppStore((s) => s.underlying);

  const [localUnderlying, setLocalUnderlying] = useState(defaultUnderlying ?? globalUnderlying);
  const underlying = localUnderlying || globalUnderlying;

  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];

  const [enabledVenues, setEnabledVenues] = useState<Set<string>>(() => new Set());
  const [showAverage, setShowAverage] = useState(true);

  const allVenueIds = VENUE_LIST.map((v) => v.id);
  const { data, isLoading } = useSurface(underlying, allVenueIds);
  const venueAtm = data?.venueAtm ?? {};
  const surface = data?.surface ?? [];

  const handleUnderlyingChange = useCallback((value: string) => {
    setLocalUnderlying(value);
  }, []);

  const toggleVenue = useCallback((venueId: string) => {
    setEnabledVenues((prev) => {
      const next = new Set(prev);
      if (next.has(venueId)) next.delete(venueId);
      else next.add(venueId);
      return next;
    });
  }, []);

  // Build Plotly traces
  const plotData = useMemo(() => {
    const traces: Partial<Plotly.PlotData>[] = [];

    const toXY = (points: VenueAtmPoint[]) => {
      const seen = new Set<number>();
      const x: number[] = [];
      const y: number[] = [];
      for (const p of points) {
        if (p.atm == null || p.dte <= 0 || !Number.isFinite(p.atm)) continue;
        if (seen.has(p.dte)) continue;
        seen.add(p.dte);
        x.push(p.dte);
        y.push(p.atm * 100);
      }
      // Sort by DTE
      const indices = x.map((_, i) => i).sort((a, b) => x[a]! - x[b]!);
      return { x: indices.map((i) => x[i]!), y: indices.map((i) => y[i]!) };
    };

    if (showAverage) {
      const { x, y } = toXY(
        surface.map((r) => ({ expiry: r.expiry, dte: r.dte, atm: r.atm })),
      );
      if (x.length > 0) {
        // Build custom text for hover with expiry labels
        const dteToExpiry = new Map<number, string>();
        for (const r of surface) { if (r.dte > 0) dteToExpiry.set(r.dte, r.expiry); }

        traces.push({
          type: "scatter",
          mode: "lines",
          x,
          y,
          name: "Average",
          line: { color: AVG_COLOR, width: 2 },
          text: x.map((dte) => {
            const exp = dteToExpiry.get(dte);
            return exp ? `${formatExpiry(exp)} (${dte}d)` : `${dte}d`;
          }),
          hovertemplate: "%{text}<br>IV: %{y:.1f}%<extra>AVG</extra>",
        });
      }
    }

    for (const venue of VENUE_LIST) {
      if (!enabledVenues.has(venue.id)) continue;
      const { x, y } = toXY(venueAtm[venue.id] ?? []);
      if (x.length === 0) continue;

      traces.push({
        type: "scatter",
        mode: "lines",
        x,
        y,
        name: venue.label,
        line: { color: getVenueColor(venue.id, venue.color), width: 2 },
        hovertemplate: `%{x}d<br>IV: %{y:.1f}%<extra>${venue.shortLabel}</extra>`,
      });
    }

    return traces;
  }, [surface, venueAtm, enabledVenues, showAverage]);

  const plotLayout = useMemo((): Partial<Plotly.Layout> => ({
    ...PLOTLY_LAYOUT_BASE,
    xaxis: {
      ...PLOTLY_LAYOUT_BASE.xaxis,
      type: "log",
      ticksuffix: "d",
      tickvals: [1, 2, 3, 5, 7, 14, 30, 60, 90, 180, 365],
      dtick: undefined,
    },
    yaxis: {
      ...PLOTLY_LAYOUT_BASE.yaxis,
      title: { text: "IV", font: { size: 11 } },
    },
  }), []);

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
