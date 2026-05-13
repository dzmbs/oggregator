import { useEffect, useMemo, useState } from 'react';

import type { PortfolioPnlCurve as PortfolioPnlCurveData } from '@oggregator/protocol';

import styles from './PortfolioPnlCurve.module.css';

interface Props {
  curve: PortfolioPnlCurveData;
  forwardDays: number;
}

const WIDTH = 720;
const HEIGHT = 280;
const PADDING = { top: 16, right: 16, bottom: 32, left: 64 };

function fmtPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  });
}

function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function xTicks(min: number, max: number): number[] {
  const count = 5;
  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));
}

function yTicks(min: number, max: number): number[] {
  const count = 5;
  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));
}

function linePath(
  points: PortfolioPnlCurveData['points'],
  toX: (value: number) => number,
  toY: (value: number) => number,
  pickY: (point: PortfolioPnlCurveData['points'][number]) => number | null,
): string {
  const commands: string[] = [];
  for (const point of points) {
    const y = pickY(point);
    if (y == null || !Number.isFinite(y)) continue;
    commands.push(`${commands.length === 0 ? 'M' : 'L'} ${toX(point.underlyingPriceUsd)} ${toY(y)}`);
  }
  return commands.join(' ');
}

function emptyMessage(status: PortfolioPnlCurveData['status']): string {
  if (status === 'empty') return 'Add positions to see the payoff curve.';
  if (status === 'mixed_underlyings') return 'The payoff curve needs a single underlying book.';
  if (status === 'missing_marks') return 'Live marks are missing for one or more legs, so the curve is unavailable.';
  return 'No P/L curve available.';
}

export default function PortfolioPnlCurve({ curve, forwardDays }: Props) {
  const [stickyCurve, setStickyCurve] = useState<PortfolioPnlCurveData | null>(null);

  useEffect(() => {
    if (curve.status === 'ok' && curve.points.length > 0) {
      setStickyCurve(curve);
    } else if (curve.status === 'empty' || curve.status === 'mixed_underlyings') {
      setStickyCurve(null);
    } else if (stickyCurve != null && stickyCurve.underlying !== curve.underlying) {
      setStickyCurve(null);
    }
  }, [curve, stickyCurve]);

  const displayCurve =
    curve.status === 'ok' && curve.points.length > 0
      ? curve
      : stickyCurve != null && stickyCurve.underlying === curve.underlying
        ? stickyCurve
        : curve;
  const isStale = displayCurve !== curve;

  const chart = useMemo(() => {
    if (displayCurve.status !== 'ok' || displayCurve.points.length === 0) return null;
    const xMin = displayCurve.points[0]?.underlyingPriceUsd ?? 0;
    const xMax = displayCurve.points[displayCurve.points.length - 1]?.underlyingPriceUsd ?? 1;
    const values = displayCurve.points.flatMap((point) => [
      point.nowPnlUsd,
      point.expiryPnlUsd,
      point.forwardPnlUsd ?? point.nowPnlUsd,
      0,
    ]);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const yPadding = Math.max(50, (maxValue - minValue) * 0.12);
    const yMin = minValue - yPadding;
    const yMax = maxValue + yPadding;
    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;

    const toX = (value: number) => PADDING.left + ((value - xMin) / xSpan) * innerW;
    const toY = (value: number) => PADDING.top + (1 - (value - yMin) / ySpan) * innerH;

    return {
      toX,
      toY,
      zeroY: toY(0),
      xTicks: xTicks(xMin, xMax),
      yTicks: yTicks(yMin, yMax),
      nowPath: linePath(displayCurve.points, toX, toY, (point) => point.nowPnlUsd),
      expiryPath: linePath(displayCurve.points, toX, toY, (point) => point.expiryPnlUsd),
      forwardPath:
        forwardDays > 0
          ? linePath(displayCurve.points, toX, toY, (point) => point.forwardPnlUsd)
          : '',
    };
  }, [displayCurve, forwardDays]);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.title}>Portfolio P&amp;L curve</span>
          <span className={styles.subtitle}>x-axis: underlying price • y-axis: portfolio P&amp;L</span>
        </div>
        <div className={styles.legend}>
          <span className={styles.legendItem}><span className={styles.nowSwatch} />Now</span>
          {forwardDays > 0 && <span className={styles.legendItem}><span className={styles.forwardSwatch} />T+{forwardDays}d</span>}
          <span className={styles.legendItem}><span className={styles.expirySwatch} />Expiry</span>
        </div>
      </div>

      <div className={styles.metaRow}>
        <span className={styles.metricPill}>underlying {displayCurve.underlying ?? '—'}</span>
        <span className={styles.metricPill}>spot {fmtPrice(displayCurve.currentSpotUsd)}</span>
        <span className={styles.metricPill}>
          BE {displayCurve.breakEvenPricesUsd.length === 0 ? '—' : displayCurve.breakEvenPricesUsd.map((value) => fmtPrice(value)).join(' / ')}
        </span>
        {displayCurve.maxProfitUsd != null && <span className={styles.metricPill}>max gain {fmtUsd(displayCurve.maxProfitUsd)}</span>}
        {displayCurve.maxLossUsd != null && <span className={styles.metricPill}>max loss {fmtUsd(displayCurve.maxLossUsd)}</span>}
        {isStale && <span className={styles.stalePill}>stale · waiting for live marks</span>}
      </div>

      <div className={styles.chartWrap}>
        {chart == null ? (
          <div className={styles.empty}>{emptyMessage(curve.status)}</div>
        ) : (
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={`${styles.svg} ${isStale ? styles.svgStale : ''}`}>
            <rect
              x={PADDING.left}
              y={PADDING.top}
              width={WIDTH - PADDING.left - PADDING.right}
              height={chart.zeroY - PADDING.top}
              fill="rgba(74, 222, 128, 0.04)"
            />
            <rect
              x={PADDING.left}
              y={chart.zeroY}
              width={WIDTH - PADDING.left - PADDING.right}
              height={HEIGHT - PADDING.bottom - chart.zeroY}
              fill="rgba(248, 113, 113, 0.04)"
            />
            {chart.yTicks.map((value) => {
              const y = chart.toY(value);
              return (
                <g key={`y-${value}`}>
                  <line
                    x1={PADDING.left}
                    x2={WIDTH - PADDING.right}
                    y1={y}
                    y2={y}
                    stroke="#1a1f2b"
                    strokeWidth={1}
                  />
                  <text x={PADDING.left - 8} y={y + 3} textAnchor="end" fontSize={10} fill="#7c8798">
                    {fmtUsd(value)}
                  </text>
                </g>
              );
            })}
            {chart.xTicks.map((value) => {
              const x = chart.toX(value);
              return (
                <g key={`x-${value}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1={PADDING.top}
                    y2={HEIGHT - PADDING.bottom}
                    stroke="#10151e"
                    strokeWidth={1}
                  />
                  <text x={x} y={HEIGHT - PADDING.bottom + 18} textAnchor="middle" fontSize={10} fill="#7c8798">
                    {fmtPrice(value)}
                  </text>
                </g>
              );
            })}
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={chart.zeroY}
              y2={chart.zeroY}
              stroke="#334155"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            {displayCurve.breakEvenPricesUsd.map((value) => (
              <line
                key={`be-${value}`}
                x1={chart.toX(value)}
                x2={chart.toX(value)}
                y1={PADDING.top}
                y2={HEIGHT - PADDING.bottom}
                stroke="#fbbf24"
                strokeWidth={1}
                strokeDasharray="3 5"
                opacity={0.95}
              />
            ))}
            {displayCurve.currentSpotUsd != null && (
              <line
                x1={chart.toX(displayCurve.currentSpotUsd)}
                x2={chart.toX(displayCurve.currentSpotUsd)}
                y1={PADDING.top}
                y2={HEIGHT - PADDING.bottom}
                stroke="#f8fafc"
                strokeWidth={1}
                strokeDasharray="6 4"
              />
            )}
            {chart.forwardPath && (
              <path
                d={chart.forwardPath}
                fill="none"
                stroke="#38bdf8"
                strokeWidth={2}
                strokeDasharray="8 6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            <path
              d={chart.nowPath}
              fill="none"
              stroke="#a78bfa"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={chart.expiryPath}
              fill="none"
              stroke="#4ade80"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      <div className={styles.hint}>
        Break-even markers are based on the expiry curve. The dashed white line marks current spot.
      </div>
    </div>
  );
}
