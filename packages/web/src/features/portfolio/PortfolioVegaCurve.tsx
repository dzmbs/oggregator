import { useMemo, useState } from 'react';

import type { VegaByStrikeRow } from '@oggregator/protocol';

import styles from './PortfolioVegaCurve.module.css';

type Mode = 'vega' | 'vanna' | 'volga';

interface ModeMeta {
  label: string;
  title: string;
  explanation: string;
  positiveHint: string;
}

interface Props {
  byStrike: VegaByStrikeRow[];
}

const COLORS: Record<Mode, string> = {
  vega: '#a78bfa',
  vanna: '#60a5fa',
  volga: '#fbbf24',
};
const NEGATIVE_BAR_COLOR = '#f87171';
const NEUTRAL_BAR_COLOR = '#334155';

const MODE_META: Record<Mode, ModeMeta> = {
  vega: {
    label: 'Vega',
    title: 'Vol sensitivity',
    explanation: 'How much this strike bucket should gain or lose from a 1-point rise in implied vol.',
    positiveHint: 'Positive vega benefits from higher vol; negative vega is short vol.',
  },
  vanna: {
    label: 'Vanna',
    title: 'Spot-vol coupling',
    explanation: 'How much this strike bucket changes when spot and implied vol move together.',
    positiveHint: 'Positive vanna benefits when spot and vol rise together; negative vanna leans the other way.',
  },
  volga: {
    label: 'Volga',
    title: 'Smile convexity',
    explanation: 'How curved your vol exposure is. Large magnitude means the book is sensitive to smile reshaping.',
    positiveHint: 'Positive volga benefits from bigger vol swings; negative volga is short smile convexity.',
  },
};

const WIDTH = 640;
const HEIGHT = 240;
const PADDING = { top: 12, right: 16, bottom: 28, left: 56 };

function fmtStrike(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v);
}

function fmtValue(v: number): string {
  if (Math.abs(v) >= 1) return v.toFixed(2);
  if (Math.abs(v) >= 0.01) return v.toFixed(3);
  return v.toExponential(1);
}

function fmtSignedValue(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${fmtValue(v)}`;
}

export default function PortfolioVegaCurve({ byStrike }: Props) {
  const [mode, setMode] = useState<Mode>('vega');
  const [expiry, setExpiry] = useState<string | null>(null);
  const meta = MODE_META[mode];

  const expiries = useMemo(
    () => Array.from(new Set(byStrike.map((row) => row.expiry))).sort(),
    [byStrike],
  );
  const activeExpiry = expiry ?? expiries[0] ?? null;

  const points = useMemo(() => {
    const filtered = activeExpiry
      ? byStrike.filter((row) => row.expiry === activeExpiry)
      : byStrike;
    return filtered
      .map((row) => ({ x: Number(row.strike), y: row[mode] }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .sort((a, b) => a.x - b.x);
  }, [byStrike, activeExpiry, mode]);

  const chart = useMemo(() => {
    if (points.length === 0) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const maxAbsY = Math.max(...ys.map((value) => Math.abs(value)), 0.01);
    const yPadding = maxAbsY * 0.15;
    const yMin = -(maxAbsY + yPadding);
    const yMax = maxAbsY + yPadding;
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;
    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;
    const barWidth = Math.max(12, Math.min(56, innerW / Math.max(points.length, 1) - 10));

    const toX = (x: number) => PADDING.left + ((x - xMin) / xSpan) * innerW;
    const toY = (y: number) => PADDING.top + (1 - (y - yMin) / ySpan) * innerH;
    const zeroY = toY(0);
    const xTicks = [xMin, xMin + xSpan / 2, xMax];
    const yTicks = [yMin, -maxAbsY / 2, 0, maxAbsY / 2, yMax];
    const total = points.reduce((sum, point) => sum + point.y, 0);

    return { barWidth, total, zeroY, xTicks, yTicks, toX, toY };
  }, [points]);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.title}>Risk by strike</span>
          <span className={styles.subtitle}>
            {meta.label} • {meta.title}
          </span>
        </div>
        <div className={styles.controls}>
          <div className={styles.toggles}>
            {(['vega', 'vanna', 'volga'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={styles.toggle}
                data-active={mode === m || undefined}
                onClick={() => setMode(m)}
              >
                {MODE_META[m].label}
              </button>
            ))}
          </div>
          {expiries.length > 1 && (
            <select
              value={activeExpiry ?? ''}
              onChange={(e) => setExpiry(e.target.value)}
              className={styles.select}
              aria-label="Expiry"
            >
              {expiries.map((exp) => (
                <option key={exp} value={exp}>
                  {exp}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <div className={styles.metaRow}>
        <span className={styles.metricPill}>
          expiry {activeExpiry ?? 'all'}
        </span>
        <span className={styles.metricPill}>
          total {meta.label.toLowerCase()} {chart == null ? '—' : fmtSignedValue(chart.total)}
        </span>
      </div>
      <div className={styles.explainer}>
        <strong>{meta.label}:</strong> {meta.explanation} {meta.positiveHint}
      </div>
      <div className={styles.chartWrap}>
        {chart == null ? (
          <div className={styles.empty}>No data</div>
        ) : (
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={chart.zeroY}
              y2={chart.zeroY}
              stroke="#1f2937"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            {chart.yTicks.map((t) => {
              const y = chart.toY(t);
              return (
                <g key={`y-${t}`}>
                  <line
                    x1={PADDING.left}
                    x2={WIDTH - PADDING.right}
                    y1={y}
                    y2={y}
                    stroke="#1a1a1a"
                    strokeWidth={1}
                  />
                  <text
                    x={PADDING.left - 6}
                    y={y + 3}
                    fontSize={10}
                    fill="#888"
                    textAnchor="end"
                  >
                    {fmtValue(t)}
                  </text>
                </g>
              );
            })}
            {chart.xTicks.map((t) => {
              const x = chart.toX(t);
              return (
                <text
                  key={`x-${t}`}
                  x={x}
                  y={HEIGHT - PADDING.bottom + 16}
                  fontSize={10}
                  fill="#888"
                  textAnchor="middle"
                >
                  {fmtStrike(t)}
                </text>
              );
            })}
            {points.map((p) => (
              <g key={`p-${p.x}`}>
                <title>{`Strike ${p.x.toLocaleString()} • ${meta.label} ${fmtSignedValue(p.y)}`}</title>
                <rect
                  x={chart.toX(p.x) - chart.barWidth / 2}
                  y={Math.min(chart.zeroY, chart.toY(p.y))}
                  width={chart.barWidth}
                  height={Math.max(2, Math.abs(chart.toY(p.y) - chart.zeroY))}
                  rx={2}
                  fill={p.y > 0 ? COLORS[mode] : p.y < 0 ? NEGATIVE_BAR_COLOR : NEUTRAL_BAR_COLOR}
                  fillOpacity={0.92}
                />
                <circle
                  cx={chart.toX(p.x)}
                  cy={chart.toY(p.y)}
                  r={2.5}
                  fill="#f8fafc"
                />
              </g>
            ))}
          </svg>
        )}
      </div>
      <div className={styles.hint}>
        x-axis: strike • y-axis: size-weighted {meta.label.toLowerCase()} • bars above zero help that exposure, below zero hurt it.
      </div>
    </div>
  );
}
