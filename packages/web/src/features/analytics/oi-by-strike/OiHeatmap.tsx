// packages/web/src/features/analytics/oi-by-strike/OiHeatmap.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';

import type { EnrichedChainResponse } from '@shared/enriched';
import type { SpotCandleCurrency, SpotCandleResolutionSec } from '@shared/common';
import { fmtUsdCompact, fmtCompact, formatExpiry } from '@lib/format';

import styles from '../AnalyticsView.module.css';
import { HeatBandPrimitive } from './HeatBandPrimitive';
import { EmConePrimitive, type EmConeEntry } from './EmConePrimitive';
import {
  aggregateHeatRows,
  aggregateStrikeOi,
  computeMaxPain,
  type HeatSide,
  type OiMode,
  type StrikeOi,
} from './oi-heatmap-utils';
import {
  classifyStrikeVsEm,
  computeExpectedMove,
  filterRowsBySignificance,
  selectSignificantStrikes,
  type EmZone,
  type ExpectedMove,
  type SignificanceMode,
} from './oi-em-utils';
import { useSpotCandles } from './queries';

const EXPIRY_COLORS = [
  '#00E997', '#CB3855', '#50D2C1', '#F0B90B', '#0052FF',
  '#F7A600', '#25FAAF', '#8B5CF6', '#EC4899', '#6366F1',
  '#A855F7', '#14B8A6',
];

type Timeframe = '1d' | '3d' | '7d' | '30d' | '90d';

interface TimeframeSpec {
  resolution: SpotCandleResolutionSec;
  buckets: number;
  windowSec: number;
}

// Buckets are 3× the visible window so users can pan/scroll left and see ~3
// windows worth of history at the chosen resolution. The default visible
// range (set in the candle effect below) stays at ±windowSec so the chart
// opens at the same zoom regardless of how many extra historical candles
// were preloaded.
const TIMEFRAMES: Record<Timeframe, TimeframeSpec> = {
  '1d':  { resolution: 300,   buckets:  864, windowSec: 86_400 },
  '3d':  { resolution: 300,   buckets: 2592, windowSec: 3 * 86_400 },
  '7d':  { resolution: 1800,  buckets: 1008, windowSec: 7 * 86_400 },
  '30d': { resolution: 3600,  buckets: 2160, windowSec: 30 * 86_400 },
  '90d': { resolution: 14400, buckets: 1620, windowSec: 90 * 86_400 },
};
const DEFAULT_TIMEFRAME: Timeframe = '30d';

// Per-strike, per-session OI buffer. Capped per strike so a long session
// does not grow unbounded. ~1 sample per WS coalesced snapshot.
const SESSION_BUFFER_CAP = 1440;

interface SessionPoint { ts: number; oi: number }

interface Props {
  chains: EnrichedChainResponse[];
  spotPrice: number | null;
  currency: SpotCandleCurrency;
}

export default function OiHeatmap({ chains, spotPrice, currency }: Props) {
  const [mode, setMode] = useState<OiMode>('contracts');
  const [side, setSide] = useState<HeatSide>('both');
  const [significance, setSignificance] = useState<SignificanceMode>('a3-topk');
  const [timeframe, setTimeframe] = useState<Timeframe>(DEFAULT_TIMEFRAME);
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(new Set());
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const didFitRef = useRef(false);
  const heatPrimitiveRef = useRef<HeatBandPrimitive | null>(null);
  const conePrimitiveRef = useRef<EmConePrimitive | null>(null);
  const strikeLinesRef = useRef<Map<number, IPriceLine>>(new Map());
  const spotLineRef = useRef<IPriceLine | null>(null);
  const maxPainLineRef = useRef<IPriceLine | null>(null);

  const sessionBufferRef = useRef<Map<number, SessionPoint[]>>(new Map());

  const tfSpec = TIMEFRAMES[timeframe];
  const { data: candleData, isLoading: candlesLoading, error: candlesError, refetch } =
    useSpotCandles(currency, tfSpec.resolution, tfSpec.buckets);

  const sortedExpiries = useMemo(() => chains.map((c) => c.expiry).sort(), [chains]);
  const expiryColorMap = useMemo(
    () => new Map(sortedExpiries.map((exp, i) => [exp, EXPIRY_COLORS[i % EXPIRY_COLORS.length]!])),
    [sortedExpiries],
  );

  const emByExpiry = useMemo(() => {
    const map = new Map<string, ExpectedMove>();
    if (spotPrice == null) return map;
    for (const chain of chains) {
      const em = computeExpectedMove(chain, spotPrice);
      if (em) map.set(chain.expiry, em);
    }
    return map;
  }, [chains, spotPrice]);

  const allRows = useMemo(
    () => aggregateHeatRows(chains, spotPrice, mode, hiddenExpiries, side),
    [chains, spotPrice, mode, hiddenExpiries, side],
  );

  const significantStrikes = useMemo(
    () => selectSignificantStrikes({
      chains,
      spotPrice,
      mode,
      hiddenExpiries,
      side,
      emByExpiry,
      significance,
    }),
    [chains, spotPrice, mode, hiddenExpiries, side, emByExpiry, significance],
  );

  const heatRows = useMemo(
    () => filterRowsBySignificance(allRows, significantStrikes),
    [allRows, significantStrikes],
  );

  const coneEntries = useMemo<EmConeEntry[]>(() => {
    const entries: EmConeEntry[] = [];
    for (const chain of chains) {
      if (hiddenExpiries.has(chain.expiry)) continue;
      if (chain.expiryTs == null) continue;
      const em = emByExpiry.get(chain.expiry);
      if (!em) continue;
      entries.push({
        expiry: chain.expiry,
        expiryTimeSec: Math.floor(chain.expiryTs / 1000),
        emValue: em.value,
        color: expiryColorMap.get(chain.expiry) ?? '#888',
        source: em.source,
      });
    }
    return entries;
  }, [chains, hiddenExpiries, emByExpiry, expiryColorMap]);

  // Tooltip needs venue/expiry breakdown (re-uses V1 aggregation).
  const fullStrikeData = useMemo(
    () => aggregateStrikeOi(
      chains.filter((c) => !hiddenExpiries.has(c.expiry)),
      spotPrice,
      mode,
    ),
    [chains, hiddenExpiries, spotPrice, mode],
  );

  const maxPain = useMemo(
    () => computeMaxPain(chains.filter((c) => !hiddenExpiries.has(c.expiry))),
    [chains, hiddenExpiries],
  );

  // Latest heatRows in a ref so the crosshair callback (registered once at
  // mount) can read fresh data without re-subscribing.
  const heatRowsRef = useRef(heatRows);
  useEffect(() => { heatRowsRef.current = heatRows; }, [heatRows]);

  // ── Chart lifecycle (mount/unmount only) ────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9aa0a6',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: '#1A1A1A' }, horzLines: { color: '#1A1A1A' } },
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: '#1F2937', timeVisible: true, secondsVisible: false },
      crosshair: {
        horzLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
        vertLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
      },
    });

    const series: ISeriesApi<'Candlestick', Time> = chart.addSeries(CandlestickSeries, {
      upColor: '#00E997',
      downColor: '#CB3855',
      wickUpColor: '#00E997',
      wickDownColor: '#CB3855',
      borderVisible: false,
      priceLineVisible: false,
    }) as ISeriesApi<'Candlestick', Time>;

    const heatPrimitive = new HeatBandPrimitive();
    series.attachPrimitive(heatPrimitive);
    const conePrimitive = new EmConePrimitive();
    series.attachPrimitive(conePrimitive);

    chartRef.current = chart;
    seriesRef.current = series;
    heatPrimitiveRef.current = heatPrimitive;
    conePrimitiveRef.current = conePrimitive;

    chart.subscribeCrosshairMove((param) => {
      if (param.point === undefined || param.time === undefined) {
        setHoveredStrike(null);
        setTooltipPos(null);
        return;
      }
      const price = series.coordinateToPrice(param.point.y);
      if (price === null) return;
      let nearest: number | null = null;
      let bestDist = Infinity;
      for (const row of heatRowsRef.current) {
        const d = Math.abs(row.strike - price);
        if (d < bestDist) { bestDist = d; nearest = row.strike; }
      }
      setHoveredStrike(nearest);
      setTooltipPos({ x: param.point.x, y: param.point.y });
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      heatPrimitiveRef.current = null;
      conePrimitiveRef.current = null;
      strikeLinesRef.current.clear();
      spotLineRef.current = null;
      maxPainLineRef.current = null;
    };
  }, []);

  // Re-fit visible range whenever the underlying or timeframe changes so the
  // chart shows [now − window, now + window] symmetrically for the new TF.
  useEffect(() => { didFitRef.current = false; }, [currency, timeframe]);

  // ── Push candle data + set symmetric visible range for the TF ─────
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !candleData) return;
    const data = candleData.candles.map((c) => ({
      time: Math.floor(c.timestamp / 1000) as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    series.setData(data);
    if (data.length === 0) return;

    if (!didFitRef.current) {
      const nowSec = Math.floor(Date.now() / 1000);
      chart.timeScale().setVisibleRange({
        from: (nowSec - tfSpec.windowSec) as Time,
        to: (nowSec + tfSpec.windowSec) as Time,
      });
      didFitRef.current = true;
    }
  }, [candleData, tfSpec]);

  // ── Push heat rows + cones to the primitives ────────────────────
  useEffect(() => {
    heatPrimitiveRef.current?.update(heatRows);
  }, [heatRows]);

  useEffect(() => {
    if (spotPrice == null) return;
    conePrimitiveRef.current?.update(spotPrice, coneEntries);
  }, [spotPrice, coneEntries]);

  // ── Diff strike axis labels (avoid flicker) ─────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const next = new Set(heatRows.map((r) => r.strike));
    const lines = strikeLinesRef.current;

    for (const [strike, line] of lines.entries()) {
      if (!next.has(strike)) {
        series.removePriceLine(line);
        lines.delete(strike);
      }
    }
    for (const row of heatRows) {
      if (lines.has(row.strike)) continue;
      const line = series.createPriceLine({
        price: row.strike,
        color: 'transparent',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        lineVisible: false,
        axisLabelVisible: true,
        title: row.strike.toLocaleString(),
        axisLabelColor: row.dominant === 'call' ? '#0E3D2C' : '#3D0E1A',
        axisLabelTextColor: row.dominant === 'call' ? '#00E997' : '#CB3855',
      });
      lines.set(row.strike, line);
    }
  }, [heatRows]);

  // ── SPOT and MP price lines ─────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (spotLineRef.current) {
      series.removePriceLine(spotLineRef.current);
      spotLineRef.current = null;
    }
    if (spotPrice != null) {
      spotLineRef.current = series.createPriceLine({
        price: spotPrice,
        color: '#50D2C1',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `${Math.round(spotPrice).toLocaleString()} SPOT`,
      });
    }
  }, [spotPrice]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (maxPainLineRef.current) {
      series.removePriceLine(maxPainLineRef.current);
      maxPainLineRef.current = null;
    }
    if (maxPain != null) {
      maxPainLineRef.current = series.createPriceLine({
        price: maxPain,
        color: '#F0B90B',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${maxPain.toLocaleString()} MP`,
      });
    }
  }, [maxPain]);

  // ── Session OI buffer (in-memory, clears on unmount/currency change) ──
  useEffect(() => {
    sessionBufferRef.current = new Map();
  }, [currency]);

  useEffect(() => {
    if (chains.length === 0) return;
    const ts = Date.now();
    const buf = sessionBufferRef.current;
    for (const chain of chains) {
      for (const strike of chain.strikes) {
        let oi = 0;
        for (const q of Object.values(strike.call.venues)) oi += q?.openInterest ?? 0;
        for (const q of Object.values(strike.put.venues))  oi += q?.openInterest ?? 0;
        const series = buf.get(strike.strike) ?? [];
        const last = series[series.length - 1];
        if (last && last.oi === oi) continue;
        series.push({ ts, oi });
        if (series.length > SESSION_BUFFER_CAP) series.shift();
        buf.set(strike.strike, series);
      }
    }
  }, [chains]);

  const toggleExpiry = (expiry: string) => {
    setHiddenExpiries((prev) => {
      const next = new Set(prev);
      if (next.has(expiry)) next.delete(expiry);
      else next.add(expiry);
      return next;
    });
  };

  const fmt = mode === 'notional' ? fmtUsdCompact : fmtCompact;
  const hovered = hoveredStrike != null
    ? fullStrikeData.find((s) => s.strike === hoveredStrike) ?? null
    : null;
  const hoveredZones = useMemo(() => {
    if (!hovered || spotPrice == null) return new Map<string, EmZone>();
    const zones = new Map<string, EmZone>();
    for (const ep of hovered.expiries) {
      const em = emByExpiry.get(ep.expiry);
      if (em) zones.set(ep.expiry, classifyStrikeVsEm(hovered.strike, spotPrice, em));
    }
    return zones;
  }, [hovered, emByExpiry, spotPrice]);
  const hoveredSparkline = useMemo(() => {
    if (!hovered) return [];
    return sessionBufferRef.current.get(hovered.strike) ?? [];
  }, [hovered]);
  const allHidden = hiddenExpiries.size > 0 && hiddenExpiries.size === sortedExpiries.length;

  return (
    <div>
      <div className={styles.heatControls}>
        <div className={styles.oiToggle}>
          <button className={styles.oiToggleBtn} data-active={mode === 'contracts' || undefined} onClick={() => setMode('contracts')}>Contracts</button>
          <button className={styles.oiToggleBtn} data-active={mode === 'notional'  || undefined} onClick={() => setMode('notional')}>Notional</button>
        </div>
        <div className={styles.oiToggle}>
          <button className={styles.oiToggleBtn} data-active={side === 'calls' || undefined} onClick={() => setSide('calls')}>Calls</button>
          <button className={styles.oiToggleBtn} data-active={side === 'puts'  || undefined} onClick={() => setSide('puts')}>Puts</button>
          <button className={styles.oiToggleBtn} data-active={side === 'both'  || undefined} onClick={() => setSide('both')}>Both</button>
        </div>
        <div className={styles.oiToggle}>
          <button className={styles.oiToggleBtn} data-active={significance === 'a3-topk' || undefined} onClick={() => setSignificance('a3-topk')}>A3</button>
          <button className={styles.oiToggleBtn} data-active={significance === 'a4-outliers' || undefined} onClick={() => setSignificance('a4-outliers')}>
            A4
            <span className={styles.betaBadge}>BETA</span>
          </button>
        </div>
        <div className={styles.oiToggle}>
          {(Object.keys(TIMEFRAMES) as Timeframe[]).map((tf) => (
            <button
              key={tf}
              className={styles.oiToggleBtn}
              data-active={timeframe === tf || undefined}
              onClick={() => setTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.curveLegend}>
        {sortedExpiries.map((expiry) => {
          const active = !hiddenExpiries.has(expiry);
          const em = emByExpiry.get(expiry);
          return (
            <button
              key={expiry}
              type="button"
              className={styles.curveLegendItem}
              data-active={active || undefined}
              onClick={() => toggleExpiry(expiry)}
              title={em ? `EM ±${fmtUsdCompact(em.value)} · ${em.source}` : undefined}
            >
              <span className={styles.curveLegendDot} style={{ background: expiryColorMap.get(expiry) }} />
              {formatExpiry(expiry)}
              {em && em.source === 'iv-fallback' && <span className={styles.emFallbackTick}>·iv</span>}
            </button>
          );
        })}
      </div>

      <div className={styles.heatChartWrap}>
        <div className={styles.heatChartCanvas} ref={containerRef} />

        {candlesLoading && !candleData && (
          <div className={styles.heatStatusOverlay}>Loading spot history…</div>
        )}
        {candlesError && (
          <div className={styles.heatStatusOverlay}>
            <div>Spot history unavailable</div>
            <button onClick={() => void refetch()}>Retry</button>
          </div>
        )}
        {allHidden && (
          <div className={styles.heatStatusOverlay}>
            All expiries hidden — re-enable one in the legend above.
          </div>
        )}

        {hovered && tooltipPos && (
          <HeatTooltip
            data={hovered}
            tooltipPos={tooltipPos}
            expiryColorMap={expiryColorMap}
            emByExpiry={emByExpiry}
            zones={hoveredZones}
            sparkline={hoveredSparkline}
            fmt={fmt}
          />
        )}
      </div>
    </div>
  );
}

function HeatTooltip({
  data,
  tooltipPos,
  expiryColorMap,
  emByExpiry,
  zones,
  sparkline,
  fmt,
}: {
  data: StrikeOi;
  tooltipPos: { x: number; y: number };
  expiryColorMap: Map<string, string>;
  emByExpiry: ReadonlyMap<string, ExpectedMove>;
  zones: ReadonlyMap<string, EmZone>;
  sparkline: SessionPoint[];
  fmt: (v: number | null | undefined) => string;
}) {
  const insideExpiries = data.expiries.filter((ep) => zones.get(ep.expiry) === 'inside-1sigma');
  const summary = insideExpiries.length > 0
    ? `Inside ±1σ for: ${insideExpiries.map((ep) => ep.expiry).join(', ')}`
    : data.expiries.some((ep) => zones.get(ep.expiry) === 'inside-2sigma')
      ? 'Inside ±2σ (no expiry inside ±1σ)'
      : 'Outside ±2σ for all visible expiries';
  return (
    <div
      className={styles.oiTooltip}
      style={{ left: tooltipPos.x + 16, top: tooltipPos.y - 8 }}
    >
      <div className={styles.oiTooltipTitle}>{data.strike.toLocaleString()}</div>
      <div className={styles.oiTooltipZone}>{summary}</div>
      <div className={styles.oiTooltipColumns}>
        {data.venues.length > 0 && (
          <div className={styles.oiTooltipCol}>
            <div className={styles.oiTooltipSection}>By Venue</div>
            <div className={styles.oiTooltipHeader}><span /><span>Calls</span><span>Puts</span></div>
            {data.venues.map((v) => (
              <div key={v.venue} className={styles.oiTooltipRow}>
                <span className={styles.oiTooltipVenue}>{v.venue}</span>
                <span className={styles.oiCall}>{fmt(v.callOi)}</span>
                <span className={styles.oiPut}>{fmt(v.putOi)}</span>
              </div>
            ))}
          </div>
        )}
        {data.expiries.length > 0 && (
          <div className={styles.oiTooltipCol}>
            <div className={styles.oiTooltipSection}>By Expiry · EM</div>
            <div className={styles.oiTooltipHeader}><span /><span>Calls</span><span>Puts</span></div>
            {data.expiries.map((ep) => {
              const em = emByExpiry.get(ep.expiry);
              return (
                <div key={ep.expiry} className={styles.oiTooltipRow}>
                  <span className={styles.oiTooltipVenue}>
                    <span className={styles.oiTooltipDot} style={{ background: expiryColorMap.get(ep.expiry) }} />
                    {ep.expiry}
                    {em && (
                      <span className={styles.oiTooltipEm} data-source={em.source}>
                        ±{fmt(em.value)}·{em.source === 'straddle' ? 's' : 'iv'}
                      </span>
                    )}
                  </span>
                  <span className={styles.oiCall}>{fmt(ep.callOi)}</span>
                  <span className={styles.oiPut}>{fmt(ep.putOi)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {sparkline.length >= 2 && <SessionSparkline points={sparkline} />}
    </div>
  );
}

function SessionSparkline({ points }: { points: SessionPoint[] }) {
  const width = 160;
  const height = 28;
  const xs = points.map((_, i) => (i / (points.length - 1)) * width);
  const ys = (() => {
    const min = Math.min(...points.map((p) => p.oi));
    const max = Math.max(...points.map((p) => p.oi));
    const range = max - min || 1;
    return points.map((p) => height - ((p.oi - min) / range) * height);
  })();
  const d = points.map((_, i) => `${i === 0 ? 'M' : 'L'}${xs[i]!.toFixed(1)},${ys[i]!.toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!.oi;
  const first = points[0]!.oi;
  const trendUp = last >= first;
  return (
    <div className={styles.oiTooltipSparkline}>
      <span className={styles.oiTooltipSparkLabel}>Session OI</span>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <path d={d} fill="none" stroke={trendUp ? '#00E997' : '#CB3855'} strokeWidth={1.25} />
      </svg>
    </div>
  );
}
