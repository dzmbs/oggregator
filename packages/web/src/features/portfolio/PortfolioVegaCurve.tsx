import { useEffect, useMemo, useState } from 'react';

import type { BreakEvenIvRow, VegaByStrikeRow } from '@oggregator/protocol';

import styles from './PortfolioVegaCurve.module.css';

function hasUsefulGreeks(rows: VegaByStrikeRow[]): boolean {
  for (const row of rows) {
    if (row.delta !== 0 || row.vega !== 0 || row.gamma !== 0 || row.vanna !== 0 || row.volga !== 0) {
      return true;
    }
  }
  return false;
}

function hasUsefulBreakEven(rows: BreakEvenIvRow[]): boolean {
  for (const row of rows) {
    if (row.currentIv != null || row.breakEvenIv != null) return true;
  }
  return false;
}

function sameLegSignature(left: VegaByStrikeRow[], right: VegaByStrikeRow[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (a == null || b == null) return false;
    if (a.expiry !== b.expiry || a.strike !== b.strike || a.optionRight !== b.optionRight) {
      return false;
    }
  }
  return true;
}

// byStrike rows are now keyed by (expiry, strike, optionRight). For modes
// where call/put are mathematically equivalent at the same strike (vega,
// gamma, vanna, volga under Black-76 with r=0) we collapse them onto a
// single point so the chart isn't double-drawn. Delta is kept split so a
// straddle at one strike shows as two distinct contributions.
function mergeRowsForMode(rows: VegaByStrikeRow[], mode: Mode): VegaByStrikeRow[] {
  if (mode === 'delta') return rows;
  const acc = new Map<string, VegaByStrikeRow>();
  for (const row of rows) {
    const key = `${row.expiry}|${row.strike}`;
    const prior = acc.get(key);
    if (prior == null) {
      acc.set(key, { ...row });
      continue;
    }
    acc.set(key, {
      ...prior,
      delta: prior.delta + row.delta,
      vega: prior.vega + row.vega,
      gamma: prior.gamma + row.gamma,
      vanna: prior.vanna + row.vanna,
      volga: prior.volga + row.volga,
      contracts: prior.contracts + row.contracts,
    });
  }
  return [...acc.values()];
}

type Mode = 'delta' | 'vega' | 'gamma' | 'vanna' | 'volga';

interface ModeMeta {
  label: string;
  title: string;
  explanation: string;
  positiveHint: string;
}

interface Props {
  byStrike: VegaByStrikeRow[];
  breakEven: BreakEvenIvRow[];
}

const COLORS: Record<Mode, string> = {
  delta: '#34d399',
  vega: '#a78bfa',
  gamma: '#f97316',
  vanna: '#60a5fa',
  volga: '#fbbf24',
};
const NEGATIVE_BAR_COLOR = '#f87171';
const NEUTRAL_BAR_COLOR = '#334155';

const MODE_META: Record<Mode, ModeMeta> = {
  delta: {
    label: 'Delta',
    title: 'Directional exposure',
    explanation: 'How much this strike bucket should gain or lose from a small move in the underlying.',
    positiveHint: 'Positive delta benefits from spot rising; negative delta benefits from spot falling.',
  },
  vega: {
    label: 'Vega',
    title: 'Vol sensitivity',
    explanation: 'How much this strike bucket should gain or lose from a 1-point rise in implied vol.',
    positiveHint: 'Positive vega benefits from higher vol; negative vega is short vol.',
  },
  gamma: {
    label: 'Gamma',
    title: 'Curvature',
    explanation: 'How quickly this strike bucket delta changes when spot moves.',
    positiveHint: 'Positive gamma gains from bigger spot swings; negative gamma is short convexity.',
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
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(v) ? 0 : 2,
  });
}

function trimTrailingZeros(value: string): string {
  return value.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
}

function fmtValue(v: number): string {
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs >= 1_000) {
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (abs >= 1) return trimTrailingZeros(v.toFixed(2));
  if (abs >= 0.1) return trimTrailingZeros(v.toFixed(3));
  if (abs >= 0.01) return trimTrailingZeros(v.toFixed(4));
  if (abs >= 0.001) return trimTrailingZeros(v.toFixed(5));
  if (abs >= 0.0001) return trimTrailingZeros(v.toFixed(6));
  return v.toExponential(2);
}

function fmtSignedValue(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${fmtValue(v)}`;
}

function fmtIv(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(2)}%`;
}

function strikeTicks(points: Array<{ x: number }>): number[] {
  if (points.length <= 6) return points.map((point) => point.x);
  const lastIndex = points.length - 1;
  const indexes = new Set([0, Math.floor(lastIndex / 4), Math.floor(lastIndex / 2), Math.floor((lastIndex * 3) / 4), lastIndex]);
  return [...indexes].sort((left, right) => left - right).map((index) => points[index]!.x);
}

function linePath(points: Array<{ x: number; y: number }>, toX: (x: number) => number, toY: (y: number) => number): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${toX(point.x)} ${toY(point.y)}`)
    .join(' ');
}

function areaPath(
  points: Array<{ x: number; y: number }>,
  zeroY: number,
  toX: (x: number) => number,
  toY: (y: number) => number,
): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  if (first == null || last == null) return '';
  return [
    `M ${toX(first.x)} ${zeroY}`,
    ...points.map((point, index) => `${index === 0 ? 'L' : 'L'} ${toX(point.x)} ${toY(point.y)}`),
    `L ${toX(last.x)} ${zeroY}`,
    'Z',
  ].join(' ');
}

export default function PortfolioVegaCurve({ byStrike, breakEven }: Props) {
  const [mode, setMode] = useState<Mode>('vega');
  const [expiry, setExpiry] = useState<string | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [stickyByStrike, setStickyByStrike] = useState<VegaByStrikeRow[] | null>(null);
  const [stickyBreakEven, setStickyBreakEven] = useState<BreakEvenIvRow[] | null>(null);
  const meta = MODE_META[mode];

  useEffect(() => {
    if (byStrike.length === 0) {
      setStickyByStrike(null);
      return;
    }
    if (stickyByStrike != null && !sameLegSignature(byStrike, stickyByStrike)) {
      setStickyByStrike(null);
      return;
    }
    if (hasUsefulGreeks(byStrike)) {
      setStickyByStrike(byStrike);
    }
  }, [byStrike, stickyByStrike]);

  useEffect(() => {
    if (breakEven.length === 0) {
      setStickyBreakEven(null);
      return;
    }
    if (hasUsefulBreakEven(breakEven)) {
      setStickyBreakEven(breakEven);
    }
  }, [breakEven]);

  const displayByStrike =
    byStrike.length > 0 && (hasUsefulGreeks(byStrike) || stickyByStrike == null)
      ? byStrike
      : (stickyByStrike ?? byStrike);
  const displayBreakEven =
    breakEven.length > 0 && (hasUsefulBreakEven(breakEven) || stickyBreakEven == null)
      ? breakEven
      : (stickyBreakEven ?? breakEven);
  const isStale = displayByStrike !== byStrike || displayBreakEven !== breakEven;

  const expiries = useMemo(
    () => Array.from(new Set(displayByStrike.map((row) => row.expiry))).sort(),
    [displayByStrike],
  );
  const activeExpiry = expiry ?? expiries[0] ?? null;

  const points = useMemo(() => {
    const filtered = activeExpiry
      ? displayByStrike.filter((row) => row.expiry === activeExpiry)
      : displayByStrike;
    const merged = mergeRowsForMode(filtered, mode);
    return merged
      .map((row) => ({
        x: Number(row.strike),
        y: row[mode],
        optionRight: row.optionRight,
      }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .sort((a, b) => {
        if (a.x !== b.x) return a.x - b.x;
        return a.optionRight < b.optionRight ? -1 : 1;
      });
  }, [displayByStrike, activeExpiry, mode]);

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
    const toX = (x: number) => PADDING.left + ((x - xMin) / xSpan) * innerW;
    const toY = (y: number) => PADDING.top + (1 - (y - yMin) / ySpan) * innerH;
    const zeroY = toY(0);
    const xTicks = strikeTicks(points);
    const yTicks = [yMin, -maxAbsY / 2, 0, maxAbsY / 2, yMax];
    const total = points.reduce((sum, point) => sum + point.y, 0);

    return { total, zeroY, xTicks, yTicks, toX, toY };
  }, [points]);

  const activeStrike = points.some((point) => point.x === selectedStrike)
    ? selectedStrike
    : (points[0]?.x ?? null);

  const activeBreakEvenRows = useMemo(() => {
    if (activeExpiry == null || activeStrike == null) return [];
    return displayBreakEven
      .filter((row) => row.expiry === activeExpiry && row.strike === activeStrike)
      .sort((left, right) => left.optionRight.localeCompare(right.optionRight));
  }, [activeExpiry, activeStrike, displayBreakEven]);

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
            {(['delta', 'vega', 'gamma', 'vanna', 'volga'] as Mode[]).map((m) => (
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
        {isStale && <span className={styles.stalePill}>stale · waiting for live marks</span>}
      </div>
      <div className={styles.explainer}>
        <strong>{meta.label}:</strong> {meta.explanation} {meta.positiveHint}
      </div>
      <div className={styles.chartWrap}>
        {chart == null ? (
          <div className={styles.empty}>No data</div>
        ) : (
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={`${styles.svg} ${isStale ? styles.svgStale : ''}`}>
            <path
              d={areaPath(points, chart.zeroY, chart.toX, chart.toY)}
              fill={COLORS[mode]}
              fillOpacity={0.14}
            />
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
                <g key={`x-${t}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1={PADDING.top}
                    y2={HEIGHT - PADDING.bottom}
                    stroke="#131a25"
                    strokeWidth={1}
                  />
                  <text
                    x={x}
                    y={HEIGHT - PADDING.bottom + 16}
                    fontSize={10}
                    fill="#888"
                    textAnchor="middle"
                  >
                    {fmtStrike(t)}
                  </text>
                </g>
              );
            })}
            {activeStrike != null && (
              <line
                x1={chart.toX(activeStrike)}
                x2={chart.toX(activeStrike)}
                y1={PADDING.top}
                y2={HEIGHT - PADDING.bottom}
                stroke="#f8fafc"
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.85}
              />
            )}
            <path
              d={linePath(points, chart.toX, chart.toY)}
              fill="none"
              stroke={COLORS[mode]}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {points.map((p) => (
              <g key={`p-${p.x}-${p.optionRight}`}>
                <title>{`Strike ${p.x.toLocaleString()} • ${meta.label} ${fmtSignedValue(p.y)}`}</title>
                <circle
                  cx={chart.toX(p.x)}
                  cy={chart.toY(p.y)}
                  r={activeStrike === p.x ? 4 : 3}
                  fill={p.y > 0 ? COLORS[mode] : p.y < 0 ? NEGATIVE_BAR_COLOR : NEUTRAL_BAR_COLOR}
                  stroke="#f8fafc"
                  strokeWidth={activeStrike === p.x ? 1.5 : 1}
                  onMouseEnter={() => setSelectedStrike(p.x)}
                  onClick={() => setSelectedStrike(p.x)}
                />
                <rect
                  x={chart.toX(p.x) - 12}
                  y={PADDING.top}
                  width={24}
                  height={HEIGHT - PADDING.top - PADDING.bottom}
                  fill="transparent"
                  onMouseEnter={() => setSelectedStrike(p.x)}
                  onClick={() => setSelectedStrike(p.x)}
                />
              </g>
            ))}
          </svg>
        )}
      </div>
      {activeStrike != null && (
        <div className={styles.breakEvenInline}>
          <span className={styles.breakEvenLabel}>Strike {fmtStrike(activeStrike)}</span>
          {activeBreakEvenRows.length === 0 ? (
            <span className={styles.breakEvenEmpty}>No break-even IV rows for this strike.</span>
          ) : (
            activeBreakEvenRows.map((row) => (
              <span key={row.legId} className={styles.breakEvenChip}>
                <span className={styles.breakEvenRight}>{row.optionRight === 'call' ? 'Call' : 'Put'}</span>
                <span>live {fmtIv(row.currentIv)}</span>
                <span>BE {fmtIv(row.breakEvenIv)}</span>
                <span>cushion {fmtPct(row.ivCushionPct)}</span>
              </span>
            ))
          )}
        </div>
      )}
      <div className={styles.hint}>
        x-axis: strike • y-axis: size-weighted {meta.label.toLowerCase()} • the line shows how that exposure bends across strikes, above zero helps and below zero hurts.
      </div>
    </div>
  );
}
