import { useEffect, useRef, useState } from 'react';
import {
  BaselineSeries,
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
} from 'lightweight-charts';

import InfoTip from '@components/ui/InfoTip';
import { getTokenLogo } from '@lib/token-meta';
import type { IvTenor } from '@shared/enriched';
import { getHistoryCoverage } from './history-coverage';
import { useIvHistory, type IvHistoryWindow } from './queries';
import {
  buildSkewLineData,
  formatSkewDisplayValue,
  latestSkewDisplayValue,
  referenceLines,
  zoneFor,
  type SkewDisplayMode,
  type SkewLinePoint,
  type SkewZone,
} from './skew-history-utils';
import styles from './SkewHistory.module.css';

const TENORS: IvTenor[] = ['7d', '30d', '60d', '90d'];
const DISPLAY_MODES: SkewDisplayMode[] = ['normalized', 'zscore', 'raw'];
const DISPLAY_LABELS: Record<SkewDisplayMode, string> = {
  raw: 'Raw',
  normalized: 'Normalized',
  zscore: 'Z-Score',
};
const MODE_TITLES: Record<SkewDisplayMode, string> = {
  normalized: 'Default lens: skew relative to ATM IV',
  zscore: 'Stretch lens: skew versus its recent range',
  raw: 'Absolute lens: desk-style vol-point skew',
};
const MODE_DESCRIPTIONS: Record<SkewDisplayMode, string> = {
  normalized: 'Best for cross-regime reading. Compare skew after adjusting for the current vol level.',
  zscore: 'Best for extremes. Use this to spot when skew is stretched versus the selected history window.',
  raw: 'Best for absolute pricing. Keep this as the advanced view when you care about straight vol-point moves.',
};
const NORMALIZED_SOFT_BAND = 5;
const NORMALIZED_EXTREME_BAND = 10;
const RR_COLOR = '#50d2c1';
const FLY_COLOR = '#f59e0b';

const RR_TIP_BODY = (
  <>
    <div>call25 IV − put25 IV.</div>
    <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
      <li>Positive: calls richer than puts → upside fear/FOMO.</li>
      <li>Negative: puts richer than calls → downside fear (usual state in BTC/ETH).</li>
      <li>Moves to zero when skew compresses; blow-outs often precede directional regimes.</li>
    </ul>
  </>
);

const FLY_TIP_BODY = (
  <>
    <div>(call25 IV + put25 IV) / 2 − ATM IV.</div>
    <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
      <li>Measures wing richness vs body — the convexity premium.</li>
      <li>High fly: wings expensive (fat-tail pricing, event premium).</li>
      <li>Low/negative fly: wings cheap vs body — possible vega pay for directional skew.</li>
    </ul>
  </>
);

function axisFormatter(mode: SkewDisplayMode) {
  return (value: number) => {
    const sign = value > 0 ? '+' : '';
    if (mode === 'zscore') return `${sign}${value.toFixed(2)}σ`;
    if (mode === 'normalized') return `${sign}${value.toFixed(1)}% ATM`;
    return `${sign}${value.toFixed(1)}%`;
  };
}

function describeRrState(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'Insufficient data';
  if (value > 0.25) return 'Calls rich vs puts';
  if (value < -0.25) return 'Puts rich vs calls';
  return 'Skew close to balanced';
}

function describeFlyState(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'Insufficient data';
  if (value > 0.25) return 'Wings rich vs ATM';
  if (value < -0.25) return 'Wings cheap vs ATM';
  return 'Wings close to ATM';
}

function describeStretch(zone: SkewZone | null): string {
  if (zone === 'extreme') return 'extreme vs window';
  if (zone === 'stretched') return 'stretched vs window';
  if (zone === 'normal') return 'near window average';
  return 'insufficient history';
}

function describeMetric(
  directionalValue: number | null,
  zone: SkewZone | null,
  mode: SkewDisplayMode,
  title: string,
): string {
  const base = title === '25Δ RR' ? describeRrState(directionalValue) : describeFlyState(directionalValue);
  if (mode === 'zscore') return `${base} · ${describeStretch(zone)}`;
  if (mode === 'normalized') return `${base} · scaled by ATM IV`;
  return `${base} · absolute vol points`;
}

function formatPercentile(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'hist n/a';
  return `${Math.round(value)}th pct`;
}

function formatIvContext(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'ATM IV n/a';
  return `ATM IV ${value.toFixed(1)}%`;
}

function formatVolPoints(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)} vol pts`;
}

function describeTakeaway(
  mode: SkewDisplayMode,
  rrDirectionalValue: number | null,
  flyDirectionalValue: number | null,
  rrZone: SkewZone | null,
  flyZone: SkewZone | null,
  atmIv: number | null,
): string {
  const rrState = describeRrState(rrDirectionalValue);
  const flyState = describeFlyState(flyDirectionalValue);
  if (mode === 'zscore') {
    return `${rrState}, ${describeStretch(rrZone)}; ${flyState}, ${describeStretch(flyZone)}.`;
  }
  if (mode === 'normalized') {
    return `${rrState}; ${flyState}. ${formatIvContext(atmIv)} is the denominator, so ${formatVolPoints(rrDirectionalValue)} RR reads relative to today's vol regime.`;
  }
  return `${rrState}; ${flyState}. Raw mode shows the same moves in straight vol points.`;
}

function describeModeGuide(mode: SkewDisplayMode, atmIv: number | null): string {
  if (mode !== 'normalized') return MODE_DESCRIPTIONS[mode];
  return `${MODE_DESCRIPTIONS[mode]} Current context: ${formatIvContext(atmIv)}.`;
}

function SkewMiniChart({
  title,
  color,
  data,
  latest,
  insight,
  percentile,
  mode,
  zone,
}: {
  title: string;
  color: string;
  data: SkewLinePoint[];
  latest: string;
  insight: string;
  percentile: string;
  mode: SkewDisplayMode;
  zone: SkewZone | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#555b5e',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: '#1A1A1A' }, horzLines: { color: '#1A1A1A' } },
      rightPriceScale: {
        borderColor: '#1F2937',
        scaleMargins: { top: 0.18, bottom: 0.18 },
      },
      timeScale: { borderColor: '#1F2937', timeVisible: true },
      crosshair: {
        horzLine: { color, labelBackgroundColor: '#0E3333' },
        vertLine: { color, labelBackgroundColor: '#0E3333', labelVisible: false },
      },
    });

    if (mode === 'zscore' && data.length >= 2) {
      const firstTime = data[0]!.time;
      const lastTime = data[data.length - 1]!.time;
      const bandFill = 'rgba(0, 233, 151, 0.10)';
      const transparent = 'rgba(0, 0, 0, 0)';
      const upper = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: 0 },
        topFillColor1: bandFill,
        topFillColor2: bandFill,
        topLineColor: transparent,
        bottomFillColor1: transparent,
        bottomFillColor2: transparent,
        bottomLineColor: transparent,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      upper.setData([
        { time: firstTime, value: 1 },
        { time: lastTime, value: 1 },
      ] as never);
      const lower = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: 0 },
        topFillColor1: transparent,
        topFillColor2: transparent,
        topLineColor: transparent,
        bottomFillColor1: bandFill,
        bottomFillColor2: bandFill,
        bottomLineColor: transparent,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      lower.setData([
        { time: firstTime, value: -1 },
        { time: lastTime, value: -1 },
      ] as never);
    }

    if (mode === 'normalized' && data.length >= 2) {
      const firstTime = data[0]!.time;
      const lastTime = data[data.length - 1]!.time;
      const mildFill = 'rgba(80, 210, 193, 0.07)';
      const extremeFill = 'rgba(245, 158, 11, 0.08)';
      const transparent = 'rgba(0, 0, 0, 0)';
      const upperMild = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: 0 },
        topFillColor1: mildFill,
        topFillColor2: mildFill,
        topLineColor: transparent,
        bottomFillColor1: transparent,
        bottomFillColor2: transparent,
        bottomLineColor: transparent,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      upperMild.setData([
        { time: firstTime, value: NORMALIZED_SOFT_BAND },
        { time: lastTime, value: NORMALIZED_SOFT_BAND },
      ] as never);
      const lowerMild = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: 0 },
        topFillColor1: transparent,
        topFillColor2: transparent,
        topLineColor: transparent,
        bottomFillColor1: mildFill,
        bottomFillColor2: mildFill,
        bottomLineColor: transparent,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      lowerMild.setData([
        { time: firstTime, value: -NORMALIZED_SOFT_BAND },
        { time: lastTime, value: -NORMALIZED_SOFT_BAND },
      ] as never);
      const upperExtreme = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: NORMALIZED_SOFT_BAND },
        topFillColor1: extremeFill,
        topFillColor2: extremeFill,
        topLineColor: transparent,
        bottomFillColor1: transparent,
        bottomFillColor2: transparent,
        bottomLineColor: transparent,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      upperExtreme.setData([
        { time: firstTime, value: NORMALIZED_EXTREME_BAND },
        { time: lastTime, value: NORMALIZED_EXTREME_BAND },
      ] as never);
      const lowerExtreme = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: -NORMALIZED_SOFT_BAND },
        topFillColor1: transparent,
        topFillColor2: transparent,
        topLineColor: transparent,
        bottomFillColor1: extremeFill,
        bottomFillColor2: extremeFill,
        bottomLineColor: transparent,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      lowerExtreme.setData([
        { time: firstTime, value: -NORMALIZED_EXTREME_BAND },
        { time: lastTime, value: -NORMALIZED_EXTREME_BAND },
      ] as never);
    }

    const line = chart.addSeries(LineSeries, {
      color,
      lineWidth: 1,
      priceFormat: {
        type: 'custom' as const,
        formatter: axisFormatter(mode),
      },
      lastValueVisible: false,
      priceLineVisible: false,
    });

    line.setData(data as never);

    for (const ref of referenceLines(mode)) {
      line.createPriceLine({
        price: ref.price,
        color: ref.emphasis === 'strong' ? '#3a4248' : '#23292e',
        lineWidth: 1,
        lineStyle: ref.emphasis === 'strong' ? LineStyle.Dashed : LineStyle.Dotted,
        axisLabelVisible: true,
        title: ref.label,
      });
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, color, mode, JSON.stringify(data)]);

  return (
    <div className={styles.miniChart}>
      <div className={styles.metricHeader}>
        <div className={styles.metricMeta}>
          <div className={styles.metricRow}>
            <span className={styles.metricName} style={{ color }}>
              {title}
            </span>
            <span className={styles.metricBadge}>{percentile}</span>
          </div>
          <span className={styles.metricInsight}>{insight}</span>
        </div>
        <span className={styles.metricValue} data-zone={zone ?? undefined}>
          {latest}
        </span>
      </div>
      <div className={styles.chartWrap}>
        <div className={styles.chartCanvas} ref={containerRef} />
        {data.length === 0 && <div className={styles.empty}>insufficient data</div>}
      </div>
    </div>
  );
}

interface Props {
  underlying: string;
}

export default function SkewHistory({ underlying }: Props) {
  const [window, setWindow] = useState<IvHistoryWindow>('30d');
  const [tenor, setTenor] = useState<IvTenor>('30d');
  const [mode, setMode] = useState<SkewDisplayMode>('normalized');

  const { data } = useIvHistory(underlying, window);
  const result = data?.tenors[tenor];
  const series = result?.series ?? [];

  const rrData = buildSkewLineData(series, 'rr25d', mode);
  const flyData = buildSkewLineData(series, 'bfly25d', mode);
  const rrLatestVal = latestSkewDisplayValue(series, 'rr25d', mode);
  const flyLatestVal = latestSkewDisplayValue(series, 'bfly25d', mode);
  const rrDirectionalVal = latestSkewDisplayValue(series, 'rr25d', 'raw');
  const flyDirectionalVal = latestSkewDisplayValue(series, 'bfly25d', 'raw');
  const rrLatest = formatSkewDisplayValue(rrLatestVal, mode);
  const flyLatest = formatSkewDisplayValue(flyLatestVal, mode);
  const rrZone = zoneFor(rrLatestVal, mode);
  const flyZone = zoneFor(flyLatestVal, mode);
  const rrInsight = describeMetric(rrDirectionalVal, rrZone, mode, '25Δ RR');
  const flyInsight = describeMetric(flyDirectionalVal, flyZone, mode, '25Δ Fly');
  const rrPercentile = formatPercentile(result?.rrPercentile ?? null);
  const flyPercentile = formatPercentile(result?.flyPercentile ?? null);
  const atmIvContext = result?.current.atmIv != null ? result.current.atmIv * 100 : null;
  const takeaway = describeTakeaway(
    mode,
    rrDirectionalVal,
    flyDirectionalVal,
    rrZone,
    flyZone,
    atmIvContext,
  );
  const coverage = getHistoryCoverage(series, window, ['rr25d', 'bfly25d']);

  const logo = getTokenLogo(underlying);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          {logo && <img src={logo} alt="" className={styles.tokenLogo} />}
          {underlying} SKEW
        </span>
        <div className={styles.toggles}>
          <span className={styles.toggleLabel}>TENOR</span>
          <div className={styles.toggleGroup}>
            {TENORS.map((t) => (
              <button
                key={t}
                type="button"
                className={styles.toggleBtn}
                data-active={tenor === t ? 'true' : undefined}
                onClick={() => setTenor(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <span className={styles.toggleLabel}>WINDOW</span>
          <div className={styles.toggleGroup}>
            <button
              type="button"
              className={styles.toggleBtn}
              data-active={window === '30d' ? 'true' : undefined}
              onClick={() => setWindow('30d')}
            >
              30d
            </button>
            <button
              type="button"
              className={styles.toggleBtn}
              data-active={window === '90d' ? 'true' : undefined}
              onClick={() => setWindow('90d')}
            >
              90d
            </button>
          </div>
          <span className={styles.toggleLabel}>MODE</span>
          <div className={styles.toggleGroup}>
            {DISPLAY_MODES.map((m) => (
              <button
                key={m}
                type="button"
                className={styles.toggleBtn}
                data-active={mode === m ? 'true' : undefined}
                onClick={() => setMode(m)}
              >
                {DISPLAY_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} style={{ background: RR_COLOR }} />
          25Δ RR (call − put)
          <InfoTip label="25Δ RR" title="25Δ Risk-Reversal" align="start">
            {RR_TIP_BODY}
          </InfoTip>
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} style={{ background: FLY_COLOR }} />
          25Δ Fly (wing − ATM)
          <InfoTip label="25Δ Fly" title="25Δ Butterfly" align="start">
            {FLY_TIP_BODY}
          </InfoTip>
        </span>
      </div>
      <div className={styles.coverage} data-short={coverage.short ? 'true' : undefined}>
        {coverage.label}
      </div>
      <div className={styles.takeaway}>{takeaway}</div>
      <div className={styles.modeGuide}>
        <span className={styles.modeGuideTitle}>{MODE_TITLES[mode]}</span>
        <span className={styles.modeGuideText}>{describeModeGuide(mode, atmIvContext)}</span>
      </div>

      <div className={styles.chartArea}>
        <div className={styles.chartStack}>
          <SkewMiniChart
            title="25Δ RR"
            color={RR_COLOR}
            data={rrData}
            latest={rrLatest}
            insight={rrInsight}
            percentile={rrPercentile}
            mode={mode}
            zone={rrZone}
          />
          <SkewMiniChart
            title="25Δ Fly"
            color={FLY_COLOR}
            data={flyData}
            latest={flyLatest}
            insight={flyInsight}
            percentile={flyPercentile}
            mode={mode}
            zone={flyZone}
          />
        </div>
      </div>
    </div>
  );
}
