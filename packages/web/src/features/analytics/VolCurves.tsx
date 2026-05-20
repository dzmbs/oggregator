import { useRef, useEffect, useMemo, useState } from 'react';
import {
  createChart,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  ColorType,
} from 'lightweight-charts';

import type {
  EnrichedChainResponse,
  EnrichedSide,
  EnrichedStrike,
  VenueQuote,
} from '@shared/enriched';
import { formatExpiry } from '@lib/format';
import InfoTip from '@components/ui/InfoTip';
import styles from './AnalyticsView.module.css';

interface CurvePoint {
  strike: number;
  iv: number;
}

const ATM_BLEND_HALF_WIDTH = 0.025;
const MIN_IV = 0.05;
const MAX_IV = 5;
const ENTRY_STRIKE_COUNT = 7;

// Sequential single-hue palette: light cyan (near-dated) → deep navy (long-dated).
// Avoids rainbow while keeping enough contrast to differentiate tenors at a glance.
function tenorColor(idx: number, total: number): string {
  const t = total <= 1 ? 0 : idx / (total - 1);
  const hue = 180 + Math.round(t * 40);
  const saturation = 55 + Math.round(t * 10);
  const lightness = 72 - Math.round(t * 32);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function withAlpha(hslColor: string, alpha: number): string {
  return hslColor.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
}

// Mirrors core/enrichment.ts → buildEnrichedSide hasMarket gate. Without this,
// phantom quotes (no genuine bid/ask, no OI) inflate far-OTM averages and
// produce the 100%+ IV spikes on short-dated wings.
function hasMarket(quote: VenueQuote): boolean {
  const hasQuotes =
    (quote.bid != null && quote.bid > 0) || (quote.ask != null && quote.ask > 0);
  const hasLiquidity =
    (quote.openInterest ?? 0) > 0 ||
    (quote.bid != null && quote.ask != null && quote.bid !== quote.ask);
  return hasQuotes && hasLiquidity;
}

type IvField = 'markIv' | 'bidIv' | 'askIv';

function liquidAvg(side: EnrichedSide, key: IvField): number | null {
  let sum = 0;
  let count = 0;
  for (const quote of Object.values(side.venues)) {
    if (!quote) continue;
    const v = quote[key];
    if (v == null) continue;
    if (v < MIN_IV || v > MAX_IV) continue;
    if (!hasMarket(quote)) continue;
    sum += v;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

function liquidAvgIv(side: EnrichedSide): number | null {
  return liquidAvg(side, 'markIv');
}

interface StrikeEntryIv {
  strike: number;
  bidIv: number | null;
  askIv: number | null;
}

function entryIvsAroundAtm(
  strikes: readonly EnrichedStrike[],
  ref: number | null,
): StrikeEntryIv[] {
  if (ref == null || strikes.length === 0) return [];
  const sorted = [...strikes].sort((a, b) => a.strike - b.strike);
  let atmIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < sorted.length; i++) {
    const diff = Math.abs(sorted[i]!.strike - ref);
    if (diff < bestDiff) {
      bestDiff = diff;
      atmIdx = i;
    }
  }
  const half = Math.floor(ENTRY_STRIKE_COUNT / 2);
  let lo = atmIdx - half;
  let hi = lo + ENTRY_STRIKE_COUNT;
  if (lo < 0) {
    hi = Math.min(sorted.length, hi - lo);
    lo = 0;
  }
  if (hi > sorted.length) {
    lo = Math.max(0, lo - (hi - sorted.length));
    hi = sorted.length;
  }
  const out: StrikeEntryIv[] = [];
  for (let i = lo; i < hi; i++) {
    const s = sorted[i]!;
    const bidIv = blendOtm(
      s.strike,
      ref,
      liquidAvg(s.call, 'bidIv'),
      liquidAvg(s.put, 'bidIv'),
    );
    const askIv = blendOtm(
      s.strike,
      ref,
      liquidAvg(s.call, 'askIv'),
      liquidAvg(s.put, 'askIv'),
    );
    if (bidIv == null && askIv == null) continue;
    out.push({ strike: s.strike, bidIv, askIv });
  }
  return out;
}

function blendOtm(
  strike: number,
  ref: number,
  callIv: number | null,
  putIv: number | null,
): number | null {
  if (callIv == null && putIv == null) return null;
  if (callIv == null) return putIv;
  if (putIv == null) return callIv;
  const lo = ref * (1 - ATM_BLEND_HALF_WIDTH);
  const hi = ref * (1 + ATM_BLEND_HALF_WIDTH);
  if (strike <= lo) return putIv;
  if (strike >= hi) return callIv;
  const w = (strike - lo) / (hi - lo);
  return (1 - w) * putIv + w * callIv;
}

function buildPoints(
  strikes: readonly EnrichedStrike[],
  ref: number | null,
  band: number | null,
): CurvePoint[] {
  const out: CurvePoint[] = [];
  for (const s of strikes) {
    if (band != null && ref != null && Math.abs(s.strike - ref) > band) continue;
    const callIv = liquidAvgIv(s.call);
    const putIv = liquidAvgIv(s.put);
    const iv =
      ref != null
        ? blendOtm(s.strike, ref, callIv, putIv)
        : callIv != null && putIv != null
          ? (callIv + putIv) / 2
          : (callIv ?? putIv);
    if (iv == null) continue;
    out.push({ strike: s.strike, iv: iv * 100 });
  }
  out.sort((a, b) => a.strike - b.strike);
  return ref != null ? rejectWingSpikes(out, ref) : out;
}

// Black-Scholes IV becomes ill-conditioned as option price approaches zero, so
// far-OTM short-dated wings can return mathematically real but visually noisy
// 100%+ IVs from a single venue. Drop a wing point only if it sits well above
// the median of its neighbors AND it is in the wing region (>15% from spot).
// Inside ±15% we never trim — that's where the real smile lives.
function rejectWingSpikes(points: CurvePoint[], ref: number): CurvePoint[] {
  if (points.length < 5) return points;
  const result: CurvePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const moneyness = Math.abs(p.strike - ref) / ref;
    if (moneyness < 0.15) {
      result.push(p);
      continue;
    }
    const lo = Math.max(0, i - 2);
    const hi = Math.min(points.length, i + 3);
    const neighbors: number[] = [];
    for (let j = lo; j < hi; j++) {
      if (j !== i) neighbors.push(points[j]!.iv);
    }
    if (neighbors.length === 0) {
      result.push(p);
      continue;
    }
    neighbors.sort((a, b) => a - b);
    const median = neighbors[Math.floor(neighbors.length / 2)]!;
    if (p.iv <= median * 2) result.push(p);
  }
  return result;
}

interface VolCurvesProps {
  chains: EnrichedChainResponse[];
  // Parent passes a per-expiry forward as `spotPrice`; we keep it as a fallback
  // but prefer chain.stats.indexPriceUsd (true spot) when available.
  spotPrice: number | null;
}

export default function VolCurves({ chains, spotPrice }: VolCurvesProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApi = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<'Area'>>>(new Map());
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(new Set());
  const [spotX, setSpotX] = useState<number | null>(null);
  const [hoveredExpiry, setHoveredExpiry] = useState<string | null>(null);
  const [hoverDots, setHoverDots] = useState<
    Array<{
      strike: number;
      x: number;
      bidY: number | null;
      askY: number | null;
      bidIvPct: number | null;
      askIvPct: number | null;
    }>
  >([]);

  const indexSpot = useMemo(
    () => chains.find((c) => c.stats.indexPriceUsd != null)?.stats.indexPriceUsd ?? spotPrice,
    [chains, spotPrice],
  );

  const curves = useMemo(() => {
    const sorted = chains.filter((c) => c.strikes.length > 5).sort((a, b) => a.dte - b.dte);
    const band = indexSpot != null ? indexSpot * 0.3 : null;
    return sorted
      .map((chain, i) => {
        const ref = chain.stats.forwardPriceUsd ?? indexSpot ?? null;
        return {
          expiry: chain.expiry,
          label: formatExpiry(chain.expiry),
          dte: chain.dte,
          color: tenorColor(i, sorted.length),
          points: buildPoints(chain.strikes, ref, band),
        };
      })
      .filter((curve) => curve.points.length > 3);
  }, [chains, indexSpot]);

  const visibleCurves = useMemo(
    () => curves.filter((curve) => !hiddenExpiries.has(curve.expiry)),
    [curves, hiddenExpiries],
  );

  const entryByExpiry = useMemo(() => {
    const map = new Map<string, StrikeEntryIv[]>();
    for (const chain of chains) {
      const ref = chain.stats.forwardPriceUsd ?? indexSpot ?? null;
      const entries = entryIvsAroundAtm(chain.strikes, ref);
      if (entries.length > 0) map.set(chain.expiry, entries);
    }
    return map;
  }, [chains, indexSpot]);

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
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: '#1F2937',
        tickMarkFormatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)),
      },
      crosshair: {
        horzLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
        vertLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
      },
      handleScale: { mouseWheel: true, pinch: true },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    });

    seriesRefs.current.clear();
    for (const curve of visibleCurves) {
      const series = chart.addSeries(AreaSeries, {
        lineColor: curve.color,
        topColor: 'rgba(0,0,0,0)',
        bottomColor: 'rgba(0,0,0,0)',
        lineWidth: 2,
        pointMarkersVisible: true,
        pointMarkersRadius: 2,
        priceFormat: { type: 'custom', formatter: (p: number) => `${p.toFixed(1)}%` },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      series.setData(
        curve.points.map((point) => ({
          time: point.strike as unknown as number,
          value: point.iv,
        })) as never,
      );
      seriesRefs.current.set(curve.expiry, series);
    }

    chart.timeScale().fitContent();
    chartApi.current = chart;

    // Spot vertical reference: lightweight-charts has no native vertical line,
    // so we render an HTML overlay positioned via timeToCoordinate. Subscribe
    // to range/size changes so it tracks zoom and resize.
    const updateSpot = () => {
      const api = chartApi.current;
      if (api == null || indexSpot == null) {
        setSpotX(null);
        return;
      }
      const x = api.timeScale().timeToCoordinate(indexSpot as never);
      setSpotX(typeof x === 'number' && Number.isFinite(x) ? x : null);
    };
    updateSpot();
    // Layout isn't ready synchronously after createChart — defer one frame so
    // the canvas has actually sized itself before timeToCoordinate is queried.
    const raf = requestAnimationFrame(updateSpot);
    const ts = chart.timeScale();
    ts.subscribeVisibleTimeRangeChange(updateSpot);
    ts.subscribeVisibleLogicalRangeChange(updateSpot);
    ts.subscribeSizeChange(updateSpot);

    return () => {
      cancelAnimationFrame(raf);
      ts.unsubscribeVisibleTimeRangeChange(updateSpot);
      ts.unsubscribeVisibleLogicalRangeChange(updateSpot);
      ts.unsubscribeSizeChange(updateSpot);
      chart.remove();
      chartApi.current = null;
      seriesRefs.current.clear();
    };
  }, [visibleCurves, indexSpot]);

  useEffect(() => {
    const api = chartApi.current;
    if (!api || !hoveredExpiry) {
      setHoverDots([]);
      return;
    }
    const entries = entryByExpiry.get(hoveredExpiry);
    const series = seriesRefs.current.get(hoveredExpiry);
    if (!entries || !series) {
      setHoverDots([]);
      return;
    }

    const update = () => {
      const next: Array<{
        strike: number;
        x: number;
        bidY: number | null;
        askY: number | null;
        bidIvPct: number | null;
        askIvPct: number | null;
      }> = [];
      for (const entry of entries) {
        const x = api.timeScale().timeToCoordinate(entry.strike as never);
        if (typeof x !== 'number' || !Number.isFinite(x)) continue;
        const bidPct = entry.bidIv != null ? entry.bidIv * 100 : null;
        const askPct = entry.askIv != null ? entry.askIv * 100 : null;
        const bidYRaw = bidPct != null ? series.priceToCoordinate(bidPct) : null;
        const askYRaw = askPct != null ? series.priceToCoordinate(askPct) : null;
        next.push({
          strike: entry.strike,
          x,
          bidY:
            typeof bidYRaw === 'number' && Number.isFinite(bidYRaw) ? bidYRaw : null,
          askY:
            typeof askYRaw === 'number' && Number.isFinite(askYRaw) ? askYRaw : null,
          bidIvPct: bidPct,
          askIvPct: askPct,
        });
      }
      setHoverDots(next);
    };

    update();
    const raf = requestAnimationFrame(update);
    const ts = api.timeScale();
    ts.subscribeVisibleTimeRangeChange(update);
    ts.subscribeVisibleLogicalRangeChange(update);
    ts.subscribeSizeChange(update);

    return () => {
      cancelAnimationFrame(raf);
      ts.unsubscribeVisibleTimeRangeChange(update);
      ts.unsubscribeVisibleLogicalRangeChange(update);
      ts.unsubscribeSizeChange(update);
    };
  }, [hoveredExpiry, entryByExpiry]);

  const handleHover = (expiry: string | null) => {
    setHoveredExpiry(expiry);
    for (const curve of visibleCurves) {
      const series = seriesRefs.current.get(curve.expiry);
      if (!series) continue;
      if (expiry == null) {
        series.applyOptions({
          lineColor: curve.color,
          lineWidth: 2,
          topColor: 'rgba(0,0,0,0)',
          bottomColor: 'rgba(0,0,0,0)',
        });
      } else if (curve.expiry === expiry) {
        series.applyOptions({
          lineColor: curve.color,
          lineWidth: 3,
          topColor: withAlpha(curve.color, 0.18),
          bottomColor: withAlpha(curve.color, 0),
        });
      } else {
        series.applyOptions({
          lineColor: withAlpha(curve.color, 0.3),
          lineWidth: 2,
          topColor: 'rgba(0,0,0,0)',
          bottomColor: 'rgba(0,0,0,0)',
        });
      }
    }
  };

  if (curves.length === 0) return null;

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>
        <span>
          Implied Volatility Curves
          <InfoTip label="How to read these curves" title="Reading the IV curves" align="start">
            <p>
              Each line is one expiry&apos;s <strong>volatility smile</strong>:
              implied volatility (Y) vs. strike (X). Per strike we blend the
              <strong> OTM side</strong> only — puts below spot, calls above —
              because OTM options are what actually trade and price the wings.
              ITM legs are excluded; their wide spreads otherwise pollute the
              mean.
            </p>
            <p style={{ marginTop: 6 }}>
              <strong>Quote filter:</strong> a venue contributes only if it has
              a real market (genuine bid/ask AND OI &gt; 0 or bid ≠ ask) and IV
              sits in the 5%–500% sanity band. This is what kills the phantom
              quotes that spike far-OTM short-dated wings.
            </p>
            <p style={{ marginTop: 6 }}>
              <strong>How to read it:</strong>
            </p>
            <ul style={{ margin: '4px 0 0', paddingLeft: 14 }}>
              <li>
                <strong>Dip</strong> near the dashed line = ATM IV for that
                expiry.
              </li>
              <li>
                <strong>Curvature</strong> (smile width) = relative wing
                premium.
              </li>
              <li>
                <strong>Left wing higher than right</strong> = put skew
                (downside fear), normal in BTC/ETH.
              </li>
              <li>
                <strong>Color = tenor</strong>: light cyan = near-dated, deep
                navy = long-dated. Near above far = backwardation (event risk
                priced in).
              </li>
            </ul>
            <p style={{ marginTop: 6 }}>
              <strong>Markings:</strong> dots are real per-strike OTM-blended
              quotes (interpolated line connects them). The dashed vertical line
              marks current spot
              {indexSpot != null ? ` ($${(indexSpot / 1000).toFixed(1)}k)` : ''}.
              Each curve&apos;s OTM boundary uses that expiry&apos;s own forward
              so the dip aligns with that tenor&apos;s ATM.
            </p>
            <p style={{ marginTop: 6 }}>
              <strong>Wing trim:</strong> single-point wing IVs more than 2× the
              local median are dropped — this kills the Black-Scholes
              degeneracies on 0–1 DTE far-OTM strikes (option price → $0 makes
              implied vol numerically unstable). Real skew within ±15% of spot
              is never trimmed.
            </p>
            <p style={{ marginTop: 6 }}>
              <strong>Interaction:</strong> hover a legend chip to highlight one
              expiry (others fade, soft fill appears below the line). Entry-IV
              dots appear at the 7 strikes around that expiry&apos;s ATM —{' '}
              <strong style={{ color: 'var(--color-profit)' }}>green</strong> =
              OTM-blended <strong>bid IV</strong>,{' '}
              <strong style={{ color: 'var(--color-loss)' }}>red</strong> ={' '}
              <strong>ask IV</strong>. They refresh live with each WS snapshot.
              Click a chip to hide / show that expiry.
            </p>
          </InfoTip>
        </span>
      </div>
      <div className={styles.cardSubtitle}>OTM-blended mark IV per strike, all expiries</div>
      <div className={styles.curveHint}>Hover an expiry to highlight · click to toggle visibility</div>
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
              onMouseEnter={() => handleHover(curve.expiry)}
              onMouseLeave={() => handleHover(null)}
            >
              <span className={styles.curveLegendDot} style={{ background: curve.color }} />
              {curve.label}
            </button>
          );
        })}
      </div>
      <div className={styles.curveChartArea}>
        <div className={styles.curveChartWrap} ref={chartRef}>
          {spotX != null && (
            <div
              className={styles.curveSpotLine}
              style={{ left: `${spotX}px` }}
              aria-hidden="true"
            />
          )}
          {hoverDots.map((dot) => (
            <span key={dot.strike}>
              {dot.bidY != null && dot.bidIvPct != null && (
                <span
                  className={styles.curveEntryDotBid}
                  style={{ left: `${dot.x}px`, top: `${dot.bidY}px` }}
                  aria-hidden="true"
                  title={`Strike ${dot.strike} · bid IV ${dot.bidIvPct.toFixed(1)}%`}
                />
              )}
              {dot.askY != null && dot.askIvPct != null && (
                <span
                  className={styles.curveEntryDotAsk}
                  style={{ left: `${dot.x}px`, top: `${dot.askY}px` }}
                  aria-hidden="true"
                  title={`Strike ${dot.strike} · ask IV ${dot.askIvPct.toFixed(1)}%`}
                />
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
