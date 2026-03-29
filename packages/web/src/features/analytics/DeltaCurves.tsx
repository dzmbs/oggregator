import { useRef, useEffect, useMemo, useState } from 'react';
import { createChart, LineSeries, type IChartApi, ColorType } from 'lightweight-charts';

import type { EnrichedChainResponse } from '@shared/enriched';
import { formatExpiry } from '@lib/format';
import styles from './AnalyticsView.module.css';

const COLORS = [
  '#00E997',
  '#CB3855',
  '#50D2C1',
  '#F0B90B',
  '#0052FF',
  '#F7A600',
  '#25FAAF',
  '#8B5CF6',
  '#EC4899',
  '#6366F1',
  '#A855F7',
  '#14B8A6',
];

interface DeltaPoint {
  strike: number;
  delta: number;
}

function extractDeltas(chain: EnrichedChainResponse, spotPrice: number | null): DeltaPoint[] {
  const points: DeltaPoint[] = [];
  const band = spotPrice ? spotPrice * 0.4 : Infinity;

  for (const strike of chain.strikes) {
    if (spotPrice && Math.abs(strike.strike - spotPrice) > band) continue;

    const deltas: number[] = [];
    for (const quote of Object.values(strike.call.venues)) {
      if (quote?.delta != null) deltas.push(quote.delta);
    }
    if (deltas.length === 0) continue;

    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    points.push({ strike: strike.strike, delta: avg * 100 });
  }

  return points.sort((a, b) => a.strike - b.strike);
}

interface DeltaCurvesProps {
  chains: EnrichedChainResponse[];
  spotPrice: number | null;
}

export default function DeltaCurves({ chains, spotPrice }: DeltaCurvesProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApi = useRef<IChartApi | null>(null);
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(new Set());

  const curves = useMemo(
    () =>
      chains
        .filter((chain) => chain.strikes.length > 5)
        .map((chain, i) => ({
          expiry: chain.expiry,
          label: formatExpiry(chain.expiry),
          dte: chain.dte,
          color: COLORS[i % COLORS.length]!,
          points: extractDeltas(chain, spotPrice),
        }))
        .filter((curve) => curve.points.length > 3),
    [chains, spotPrice],
  );

  const visibleCurves = useMemo(
    () => curves.filter((curve) => !hiddenExpiries.has(curve.expiry)),
    [curves, hiddenExpiries],
  );

  useEffect(() => {
    const container = chartRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#555B5E',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: '#1A1A1A' }, horzLines: { color: '#1A1A1A' } },
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.05, bottom: 0.05 } },
      timeScale: {
        borderColor: '#1F2937',
        tickMarkFormatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)),
      },
      crosshair: {
        horzLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
        vertLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333', labelVisible: false },
      },
      handleScale: { mouseWheel: true, pinch: true },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    });

    for (const curve of visibleCurves) {
      const series = chart.addSeries(LineSeries, {
        color: curve.color,
        lineWidth: 2,
        title: curve.label,
        priceFormat: { type: 'custom', formatter: (p: number) => `${p.toFixed(0)}%` },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      series.setData(
        curve.points.map((point) => ({
          time: point.strike as unknown as number,
          value: point.delta,
        })) as never,
      );
    }

    chart.timeScale().fitContent();
    chartApi.current = chart;

    return () => {
      chart.remove();
      chartApi.current = null;
    };
  }, [visibleCurves]);

  if (curves.length === 0) return null;

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>Probability of Expiring Above Strike</div>
      <div className={styles.cardSubtitle}>
        Call delta (≈ ITM probability) per strike, all expiries
      </div>
      <div className={styles.curveLegend}>
        {curves.map((curve) => {
          const active = !hiddenExpiries.has(curve.expiry);
          return (
            <button
              key={curve.expiry}
              type="button"
              className={styles.curveLegendItem}
              data-active={active || undefined}
              onClick={() => {
                setHiddenExpiries((prev) => {
                  const next = new Set(prev);
                  if (next.has(curve.expiry)) next.delete(curve.expiry);
                  else next.add(curve.expiry);
                  return next;
                });
              }}
            >
              <span className={styles.curveLegendDot} style={{ background: curve.color }} />
              {curve.label}
            </button>
          );
        })}
      </div>
      <div className={styles.curveChartArea}>
        <div className={styles.curveChartWrap} ref={chartRef} />
      </div>
    </div>
  );
}
