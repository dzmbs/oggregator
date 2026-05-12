import { useMemo, useState } from 'react';

import type { VegaByStrikeRow } from '@oggregator/protocol';

import styles from './PortfolioVegaCurve.module.css';

type Mode = 'vega' | 'vanna' | 'volga';

interface Props {
  byStrike: VegaByStrikeRow[];
}

const COLORS: Record<Mode, string> = {
  vega: '#a78bfa',
  vanna: '#60a5fa',
  volga: '#fbbf24',
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

export default function PortfolioVegaCurve({ byStrike }: Props) {
  const [mode, setMode] = useState<Mode>('vega');
  const [expiry, setExpiry] = useState<string | null>(null);

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

  const path = useMemo(() => {
    if (points.length === 0) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys, 0);
    const yMax = Math.max(...ys, 0);
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;
    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;

    const toX = (x: number) => PADDING.left + ((x - xMin) / xSpan) * innerW;
    const toY = (y: number) => PADDING.top + (1 - (y - yMin) / ySpan) * innerH;

    const d = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.x).toFixed(2)},${toY(p.y).toFixed(2)}`)
      .join(' ');
    const zeroY = toY(0);
    const xTicks = [xMin, xMin + xSpan / 2, xMax];
    const yTicks = [yMin, (yMin + yMax) / 2, yMax];

    return { d, zeroY, xTicks, yTicks, toX, toY };
  }, [points]);

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
      <div className={styles.chartWrap}>
        {path == null ? (
          <div className={styles.empty}>No data</div>
        ) : (
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={path.zeroY}
              y2={path.zeroY}
              stroke="#1f2937"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            {path.yTicks.map((t) => {
              const y = path.toY(t);
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
            {path.xTicks.map((t) => {
              const x = path.toX(t);
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
            <path d={path.d} stroke={COLORS[mode]} strokeWidth={2} fill="none" />
            {points.map((p) => (
              <circle
                key={`p-${p.x}`}
                cx={path.toX(p.x)}
                cy={path.toY(p.y)}
                r={2.5}
                fill={COLORS[mode]}
              />
            ))}
          </svg>
        )}
      </div>
      <div className={styles.hint}>x-axis: strike • y-axis: portfolio {mode} (size-weighted)</div>
    </div>
  );
}
