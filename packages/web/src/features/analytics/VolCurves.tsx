import { useRef, useEffect, useMemo } from "react";
import { createChart, LineSeries, type IChartApi, ColorType } from "lightweight-charts";

import type { EnrichedChainResponse } from "@shared/enriched";
import { formatExpiry } from "@lib/format";
import styles from "./AnalyticsView.module.css";

const COLORS = [
  "#00E997", "#CB3855", "#50D2C1", "#F0B90B", "#0052FF",
  "#F7A600", "#25FAAF", "#8B5CF6", "#EC4899", "#6366F1",
  "#A855F7", "#14B8A6",
];

interface CurvePoint {
  strike: number;
  iv: number;
}

function extractCurve(chain: EnrichedChainResponse, spotPrice: number | null): CurvePoint[] {
  const points: CurvePoint[] = [];
  const band = spotPrice ? spotPrice * 0.3 : Infinity;

  for (const s of chain.strikes) {
    if (spotPrice && Math.abs(s.strike - spotPrice) > band) continue;

    const ivs: number[] = [];
    for (const q of Object.values(s.call.venues)) {
      if (q?.markIv != null) ivs.push(q.markIv);
    }
    for (const q of Object.values(s.put.venues)) {
      if (q?.markIv != null) ivs.push(q.markIv);
    }
    if (ivs.length === 0) continue;

    const avg = ivs.reduce((a, b) => a + b, 0) / ivs.length;
    points.push({ strike: s.strike, iv: avg * 100 });
  }

  return points.sort((a, b) => a.strike - b.strike);
}

interface VolCurvesProps {
  chains: EnrichedChainResponse[];
  spotPrice: number | null;
}

export default function VolCurves({ chains, spotPrice }: VolCurvesProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApi = useRef<IChartApi | null>(null);

  const curves = useMemo(() =>
    chains
      .filter((c) => c.strikes.length > 5)
      .map((c, i) => ({
        expiry: c.expiry,
        label: formatExpiry(c.expiry),
        dte: c.dte,
        color: COLORS[i % COLORS.length]!,
        points: extractCurve(c, spotPrice),
      }))
      .filter((c) => c.points.length > 3),
    [chains, spotPrice],
  );

  useEffect(() => {
    const container = chartRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#555B5E",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: "#1A1A1A" }, horzLines: { color: "#1A1A1A" } },
      rightPriceScale: { borderColor: "#1F2937", scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: "#1F2937",
        tickMarkFormatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
      },
      crosshair: {
        horzLine: { color: "#50D2C1", labelBackgroundColor: "#0E3333" },
        vertLine: { color: "#50D2C1", labelBackgroundColor: "#0E3333" },
      },
      handleScale: { mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });

    for (const curve of curves) {
      const series = chart.addSeries(LineSeries, {
        color: curve.color,
        lineWidth: 2,
        title: curve.label,
        priceFormat: { type: "custom", formatter: (p: number) => `${p.toFixed(1)}%` },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      series.setData(
        curve.points.map((p) => ({ time: p.strike as unknown as number, value: p.iv })) as never,
      );
    }

    chart.timeScale().fitContent();
    chartApi.current = chart;

    return () => { chart.remove(); chartApi.current = null; };
  }, [curves]);

  if (curves.length === 0) return null;

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>Implied Volatility Curves</div>
      <div className={styles.cardSubtitle}>Average mark IV per strike, all expiries</div>
      <div className={styles.curveLegend}>
        {curves.map((c) => (
          <span key={c.expiry} className={styles.curveLegendItem}>
            <span className={styles.curveLegendDot} style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
      </div>
      <div className={styles.curveChartArea}>
        <div className={styles.curveChartWrap} ref={chartRef} />
      </div>
    </div>
  );
}
