import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, LineSeries } from 'lightweight-charts';

import type { VegaByStrikeRow } from '@oggregator/protocol';

import styles from './PortfolioVegaCurve.module.css';

type Mode = 'vega' | 'vanna' | 'volga';

interface Props {
  byStrike: VegaByStrikeRow[];
}

const CHART_OPTIONS = {
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid as const, color: 'transparent' },
    textColor: '#888',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
  },
  grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
  rightPriceScale: {
    borderColor: '#1f2937',
    scaleMargins: { top: 0.1, bottom: 0.1 },
  },
  crosshair: {
    horzLine: { color: '#a78bfa', labelBackgroundColor: '#2a1f4d' },
    vertLine: { color: '#a78bfa', labelBackgroundColor: '#2a1f4d', labelVisible: false },
  },
} as const;

const COLORS: Record<Mode, string> = {
  vega: '#a78bfa',
  vanna: '#60a5fa',
  volga: '#fbbf24',
};

export default function PortfolioVegaCurve({ byStrike }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('vega');
  const [expiry, setExpiry] = useState<string | null>(null);

  const expiries = Array.from(new Set(byStrike.map((row) => row.expiry))).sort();
  const activeExpiry = expiry ?? expiries[0] ?? null;
  const filteredRows = activeExpiry
    ? byStrike.filter((row) => row.expiry === activeExpiry)
    : byStrike;

  useEffect(() => {
    const container = containerRef.current;
    if (container == null || filteredRows.length === 0) return;

    const tickFmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v));

    const chart = createChart(container, {
      ...CHART_OPTIONS,
      timeScale: { borderColor: '#1f2937', tickMarkFormatter: tickFmt },
    });

    const series = chart.addSeries(LineSeries, {
      color: COLORS[mode],
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (v: number) => v.toFixed(3) },
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const points = filteredRows
      .map((row) => ({ time: row.strike as unknown as number, value: row[mode] }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    series.setData(points as never);
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [filteredRows, mode]);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Portfolio {mode}</span>
        <div className={styles.toggles}>
          {(['vega', 'vanna', 'volga'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={styles.toggle}
              data-active={mode === m || undefined}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
        {expiries.length > 1 && (
          <select
            value={activeExpiry ?? ''}
            onChange={(e) => setExpiry(e.target.value)}
            className={styles.select}
          >
            {expiries.map((exp) => (
              <option key={exp} value={exp}>
                {exp}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className={styles.chartWrap} ref={containerRef} />
      <div className={styles.hint}>x-axis: strike • y-axis: portfolio {mode} (size-weighted)</div>
    </div>
  );
}
