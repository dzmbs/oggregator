import { memo, useMemo, useState, type MouseEvent } from 'react';

import InfoTip from '@components/ui/InfoTip';
import { interpAtStrike, type SmileCurve, type SmilePoint } from '@lib/analytics/smile';
import { sviIv } from '@lib/analytics/svi';
import type { SviRichness } from './sviRichness';

import styles from './VolSmileInset.module.css';

interface Props {
  smile: SmileCurve | null;
  shortStrike: number | null;
  longStrike: number | null;
  richness?: SviRichness;
  T?: number | null;
}

const Z_NEUTRAL = 1;

function richnessColor(zScore: number | null | undefined): string {
  if (zScore == null || !Number.isFinite(zScore)) return 'var(--text-dim)';
  if (zScore > Z_NEUTRAL) return 'var(--accent-primary)';
  if (zScore < -Z_NEUTRAL) return 'var(--color-loss)';
  return 'var(--text-secondary)';
}

const W = 520;
const H = 200;
const PAD_L = 44;
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 28;

function VolSmileInset({ smile, shortStrike, longStrike, richness, T }: Props) {
  const [hoverX, setHoverX] = useState<number | null>(null);

  const zByStrike = useMemo(() => {
    const m = new Map<number, number | null>();
    if (richness?.params != null) {
      for (const r of richness.points) m.set(r.strike, r.zScore);
    }
    return m;
  }, [richness]);

  const layout = useMemo(() => {
    if (!smile || smile.points.length === 0) return null;
    const pts = smile.points.filter((p) => p.blendedIv != null);
    if (pts.length === 0) return null;

    const xs = pts.map((p) => p.strike);
    const ys = pts.map((p) => p.blendedIv!);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const yPad = (yMax - yMin) * 0.1 || 0.01;
    const yLo = yMin - yPad;
    const yHi = yMax + yPad;

    const sx = (x: number) =>
      PAD_L + ((x - xMin) / Math.max(1e-9, xMax - xMin)) * (W - PAD_L - PAD_R);
    const sy = (y: number) =>
      H - PAD_B - ((y - yLo) / Math.max(1e-9, yHi - yLo)) * (H - PAD_T - PAD_B);

    const screen = pts.map((p) => ({ x: sx(p.strike), y: sy(p.blendedIv!) }));
    const path = catmullRomPath(screen);

    let sviPath: string | null = null;
    if (richness?.params != null && T != null && T > 0 && smile.spot > 0) {
      const samples: { x: number; y: number }[] = [];
      const SAMPLES = 80;
      for (let i = 0; i <= SAMPLES; i++) {
        const strike = xMin + ((xMax - xMin) * i) / SAMPLES;
        const k = Math.log(strike / smile.spot);
        const iv = sviIv(richness.params, k, T);
        if (Number.isFinite(iv) && iv > 0) {
          samples.push({ x: sx(strike), y: sy(iv) });
        }
      }
      if (samples.length >= 2) {
        sviPath = catmullRomPath(samples);
      }
    }

    const xTicks = niceTicks(xMin, xMax, 5);
    const yTicks = niceTicks(yLo, yHi, 5);

    return { path, sviPath, pts, sx, sy, xMin, xMax, yLo, yHi, xTicks, yTicks };
  }, [smile, richness, T]);

  if (!layout) {
    return (
      <div className={styles.wrap}>
        <div className={styles.title}>Vol smile</div>
        <div className={styles.empty}>Waiting for chain data…</div>
      </div>
    );
  }

  const shortDot = findPoint(layout.pts, shortStrike);
  const longDot = findPoint(layout.pts, longStrike);

  const handleMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const xPx = ((e.clientX - rect.left) / rect.width) * W;
    if (xPx < PAD_L || xPx > W - PAD_R) {
      setHoverX(null);
      return;
    }
    setHoverX(xPx);
  };

  const hover = hoverX != null ? buildHover(hoverX, layout) : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.title}>
        <span>
          Vol smile · OTM IV blend
          <InfoTip label="How to read the smile" title="Reading the vol smile" align="start">
            <p>
              For each strike, IV is averaged across venues using the OTM side
              (puts below spot, calls above) — the side that actually trades and
              reflects the wing premium the market is paying.
            </p>
            <p style={{ marginTop: 6 }}>
              <strong>What to look for:</strong>
            </p>
            <ul style={{ margin: '4px 0 0', paddingLeft: 14 }}>
              <li>
                <strong>Short leg sitting on a peak</strong> (rich IV vs.
                neighbours) = you&apos;re selling expensive vol — the structural
                edge for credit spreads.
              </li>
              <li>
                <strong>Short below the curve</strong> = selling cheap vol; the
                signal can still gate SELL but the edge is thin.
              </li>
              <li>
                <strong>Long sitting on a trough</strong> = paying for cheap
                wing protection — desirable.
              </li>
            </ul>
            <p style={{ marginTop: 6 }}>
              <strong>Skew</strong> = (IV at 0.9·spot − IV at 1.1·spot) / ATM IV.
              Positive skew → downside puts richer than upside calls (downside
              fear). In BTC/ETH, mildly positive is normal; spikes often precede
              directional regimes. Use it to pick the side: rich put skew makes
              put-credit spreads structurally more attractive.
            </p>
            <p style={{ marginTop: 6 }}>
              <strong>Dashed line</strong> is the arbitrage-free SVI fit (Gatheral
              raw, Zeliade calibration). Dot color = richness vs. fit:{' '}
              <span style={{ color: 'var(--accent-primary)' }}>rich</span> at
              z &gt; +1σ (good for sellers),{' '}
              <span style={{ color: 'var(--color-loss)' }}>cheap</span> at z &lt;
              −1σ (good for buyers / cheap protection legs).
            </p>
          </InfoTip>
        </span>
        <span className={styles.stats}>
          {smile?.atmIv != null && (
            <span className={styles.stat}>
              ATM <strong>{(smile.atmIv * 100).toFixed(1)}%</strong>
            </span>
          )}
          {smile?.skew != null && (
            <span className={styles.stat} title="(IV at 0.9·spot − IV at 1.1·spot) / ATM IV. Positive = downside puts richer than upside calls.">
              Skew{' '}
              <strong data-sign={smile.skew >= 0 ? 'pos' : 'neg'}>
                {smile.skew >= 0 ? '+' : ''}
                {smile.skew.toFixed(3)}
              </strong>
            </span>
          )}
        </span>
        <span className={styles.subtitle}>
          per-strike avg markIv across venues — puts below spot, calls above
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.svg}
        role="img"
        aria-label="Volatility smile"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverX(null)}
      >
        {layout.yTicks.map((t) => (
          <g key={`y-${t}`}>
            <line
              x1={PAD_L}
              y1={layout.sy(t)}
              x2={W - PAD_R}
              y2={layout.sy(t)}
              className={styles.gridLine}
            />
            <text
              x={PAD_L - 6}
              y={layout.sy(t)}
              dy="0.32em"
              textAnchor="end"
              className={styles.axisLabel}
            >
              {(t * 100).toFixed(0)}%
            </text>
          </g>
        ))}
        {layout.xTicks.map((t) => (
          <g key={`x-${t}`}>
            <line
              x1={layout.sx(t)}
              y1={PAD_T}
              x2={layout.sx(t)}
              y2={H - PAD_B}
              className={styles.gridLine}
            />
            <text x={layout.sx(t)} y={H - 8} textAnchor="middle" className={styles.axisLabel}>
              {formatStrike(t)}
            </text>
          </g>
        ))}

        <line
          x1={PAD_L}
          y1={H - PAD_B}
          x2={W - PAD_R}
          y2={H - PAD_B}
          stroke="var(--border-subtle)"
          strokeWidth="1"
        />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="var(--border-subtle)" strokeWidth="1" />

        {layout.sviPath && (
          <path
            d={layout.sviPath}
            fill="none"
            stroke="var(--text-dim)"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.7"
          />
        )}

        <path d={layout.path} fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" />

        {layout.pts.map((p) => {
          const z = zByStrike.get(p.strike);
          const fill = richness?.params != null ? richnessColor(z) : 'var(--text-secondary)';
          const r = z != null && Math.abs(z) > Z_NEUTRAL ? 3 : 1.75;
          return (
            <circle
              key={p.strike}
              cx={layout.sx(p.strike)}
              cy={layout.sy(p.blendedIv!)}
              r={r}
              fill={fill}
              className={styles.dataDot}
            >
              {z != null && (
                <title>
                  {p.strike} · IV {(p.blendedIv! * 100).toFixed(1)}% · richness{' '}
                  {z >= 0 ? '+' : ''}
                  {z.toFixed(2)}σ
                </title>
              )}
            </circle>
          );
        })}

        {smile && (
          <line
            x1={layout.sx(smile.spot)}
            y1={PAD_T}
            x2={layout.sx(smile.spot)}
            y2={H - PAD_B}
            stroke="var(--text-dim)"
            strokeDasharray="3 3"
            opacity="0.35"
          />
        )}

        {hover && (
          <g pointerEvents="none">
            <line
              x1={hover.x}
              y1={PAD_T}
              x2={hover.x}
              y2={H - PAD_B}
              className={styles.hoverLine}
            />
            {hover.iv != null && (
              <>
                <circle cx={hover.x} cy={layout.sy(hover.iv)} r="3" className={styles.hoverDot} />
                <text
                  x={hover.x > (W + PAD_L - PAD_R) / 2 ? hover.x - 8 : hover.x + 8}
                  y={PAD_T + 12}
                  textAnchor={hover.x > (W + PAD_L - PAD_R) / 2 ? 'end' : 'start'}
                  className={styles.hoverLabel}
                >
                  {formatStrike(hover.strike)} · {(hover.iv * 100).toFixed(1)}%
                </text>
              </>
            )}
          </g>
        )}

        {shortDot && (
          <StrikeMarker
            x={layout.sx(shortDot.strike)}
            y={layout.sy(shortDot.blendedIv!)}
            label={`S ${shortDot.strike.toLocaleString()} · ${(shortDot.blendedIv! * 100).toFixed(1)}%`}
            color="var(--color-profit)"
            placement="above"
          />
        )}
        {longDot && (
          <StrikeMarker
            x={layout.sx(longDot.strike)}
            y={layout.sy(longDot.blendedIv!)}
            label={`L ${longDot.strike.toLocaleString()} · ${(longDot.blendedIv! * 100).toFixed(1)}%`}
            color="var(--color-loss)"
            placement="below"
          />
        )}
      </svg>
    </div>
  );
}

function StrikeMarker({
  x,
  y,
  label,
  color,
  placement,
}: {
  x: number;
  y: number;
  label: string;
  color: string;
  placement: 'above' | 'below';
}) {
  // Flip horizontal anchor when the dot is in the right half so the label
  // doesn't get clipped at the chart edge.
  const anchorRight = x > (W + PAD_L - PAD_R) / 2;
  const tx = anchorRight ? x - 10 : x + 10;
  const ty = placement === 'above' ? y - 12 : y + 18;
  return (
    <>
      <circle cx={x} cy={y} r="5" fill={color} stroke="var(--bg-base)" strokeWidth="2" />
      <text
        x={tx}
        y={ty}
        textAnchor={anchorRight ? 'end' : 'start'}
        className={styles.strikeLabel}
        fill={color}
        paintOrder="stroke"
        stroke="var(--bg-elevated)"
        strokeWidth="3"
        strokeLinejoin="round"
      >
        {label}
      </text>
    </>
  );
}

function findPoint(pts: { strike: number; blendedIv: number | null }[], strike: number | null) {
  if (strike == null) return null;
  return pts.find((p) => p.strike === strike && p.blendedIv != null) ?? null;
}

// 1-2-5 series tick generator — picks a step that yields ~target ticks across
// [min, max], snapped to a multiple of 10 so labels stay round.
function niceTicks(min: number, max: number, target: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || target <= 0) return [];
  const rough = (max - min) / target;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * pow;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(roundToStep(v, step));
  return ticks;
}

function roundToStep(v: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

function formatStrike(v: number): string {
  return v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`;
}

// Uniform Catmull-Rom → cubic Bézier (tension 0.5), endpoints repeated so the
// spline passes through the wings without overshoot.
function catmullRomPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0]!.x.toFixed(1)} ${pts[0]!.y.toFixed(1)}`;
  const out: string[] = [`M ${pts[0]!.x.toFixed(1)} ${pts[0]!.y.toFixed(1)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    out.push(
      `C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
    );
  }
  return out.join(' ');
}

function buildHover(
  xPx: number,
  layout: { pts: SmilePoint[]; xMin: number; xMax: number },
) {
  const t = (xPx - PAD_L) / (W - PAD_L - PAD_R);
  const strike = layout.xMin + t * (layout.xMax - layout.xMin);
  const iv = interpAtStrike(layout.pts, strike);
  return { x: xPx, strike, iv };
}

export default memo(VolSmileInset);
