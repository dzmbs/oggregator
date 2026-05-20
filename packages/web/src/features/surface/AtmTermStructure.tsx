import { useRef, useEffect, useLayoutEffect, useState, useMemo } from 'react';
import {
  createChart,
  LineSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';

import { useUnderlyings } from '@features/chain';
import { DropdownPicker } from '@components/ui';
import { getTokenLogo } from '@lib/token-meta';
import { venueColor, deltaColor, deltaLabel } from '@lib/colors';
import { fmtIv } from '@lib/format';
import { VENUE_LIST, VENUE_IDS } from '@lib/venue-meta';
import { useSurface } from './queries';
import DeltaToggleLegend, { preset25Deltas } from './DeltaToggleLegend';
import styles from './AtmTermStructure.module.css';

const AVG_COLOR = '#50D2C1';

const IV_PRICE_FORMAT = {
  type: 'custom' as const,
  formatter: (p: number) => fmtIv(p),
  minMove: 0.0001,
};

type Mode = 'per-venue-atm' | 'multi-delta';
type TenorMode = 'listed' | 'cmm';

interface Props {
  defaultUnderlying?: string;
}

interface CrosshairState {
  dte: number;
  x: number;
  y: number;
  values: Array<{ delta: number; iv: number }>;
}

interface MultiDeltaRow {
  dte: number;
  ivs: (number | null)[];
}

function useTermStructureChart(
  containerRef: React.RefObject<HTMLDivElement | null>,
  data: ReturnType<typeof useSurface>['data'],
  enabledVenues: Set<string>,
  showAverage: boolean,
) {
  const chartRef = useRef<IChartApi | null>(null);
  const venueKey = [...enabledVenues].sort().join(',');

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !data) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#555B5E',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: '#1A1A1A' }, horzLines: { color: '#1A1A1A' } },
      rightPriceScale: {
        borderColor: '#1F2937',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: '#1F2937',
        tickMarkFormatter: (v: number) => `${v}d`,
      },
      crosshair: {
        horzLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
        vertLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333', labelVisible: false },
      },
      handleScale: { mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });

    for (const [venueId, points] of Object.entries(data.venueAtm)) {
      if (!enabledVenues.has(venueId)) continue;
      const seriesData = points
        .filter((p) => p.atm != null && p.dte > 0)
        .map((p) => ({ time: p.dte as UTCTimestamp, value: p.atm! }));
      if (seriesData.length === 0) continue;

      const series = chart.addSeries(LineSeries, {
        color: venueColor(venueId),
        lineWidth: 1,
        priceFormat: IV_PRICE_FORMAT,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      series.setData(seriesData);
    }

    if (showAverage) {
      const avgData = data.surface
        .filter((r) => r.atm != null && r.dte > 0)
        .map((r) => ({ time: r.dte as UTCTimestamp, value: r.atm! }));

      if (avgData.length > 0) {
        const avgSeries = chart.addSeries(LineSeries, {
          color: AVG_COLOR,
          lineWidth: 2,
          priceFormat: IV_PRICE_FORMAT,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        avgSeries.setData(avgData);
      }
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [containerRef, data, venueKey, showAverage]);
}

function useMultiDeltaTermStructureChart(
  containerRef: React.RefObject<HTMLDivElement | null>,
  rows: readonly MultiDeltaRow[] | null,
  deltas: readonly number[],
  enabledDeltas: Set<number>,
  onCrosshair: (state: CrosshairState | null) => void,
) {
  const seriesByDeltaRef = useRef<Map<number, ISeriesApi<'Line', Time>>>(new Map());
  const enabledRef = useRef<Set<number>>(enabledDeltas);
  enabledRef.current = enabledDeltas;

  const rowsKey = useMemo(
    () => (rows ?? []).map((r) => `${r.dte}:${r.ivs.length}`).join('|'),
    [rows],
  );
  const deltasKey = useMemo(() => deltas.join(','), [deltas]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !rows || rows.length === 0 || deltas.length === 0) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#555B5E',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: '#1A1A1A' }, horzLines: { color: '#1A1A1A' } },
      rightPriceScale: {
        borderColor: '#1F2937',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: '#1F2937',
        tickMarkFormatter: (v: number) => `${v}d`,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
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

    const seriesByDelta = new Map<number, ISeriesApi<'Line', Time>>();
    for (let i = 0; i < deltas.length; i++) {
      const d = deltas[i]!;
      const isAtm = Math.abs(d - 0.5) < 1e-6;
      const seriesData = rows
        .filter((r) => r.dte > 0 && r.ivs[i] != null)
        .map((r) => ({ time: r.dte as UTCTimestamp, value: r.ivs[i]! }));
      if (seriesData.length === 0) continue;

      const series = chart.addSeries(LineSeries, {
        color: deltaColor(d),
        lineWidth: isAtm ? 2 : 1,
        priceFormat: IV_PRICE_FORMAT,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: enabledRef.current.has(d),
      });
      series.setData(seriesData);
      seriesByDelta.set(d, series);
    }

    seriesByDeltaRef.current = seriesByDelta;
    chart.timeScale().fitContent();

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || param.time == null) {
        onCrosshair(null);
        return;
      }
      const dte = Number(param.time);
      const values: Array<{ delta: number; iv: number }> = [];
      const enabledNow = enabledRef.current;
      for (const [delta, series] of seriesByDeltaRef.current) {
        if (!enabledNow.has(delta)) continue;
        const datum = param.seriesData.get(series) as { value?: number } | undefined;
        if (datum && typeof datum.value === 'number') {
          values.push({ delta, iv: datum.value });
        }
      }
      if (values.length === 0) {
        onCrosshair(null);
        return;
      }
      onCrosshair({ dte, x: param.point.x, y: param.point.y, values });
    });

    return () => {
      chart.remove();
      seriesByDeltaRef.current = new Map();
      onCrosshair(null);
    };
  }, [containerRef, rows, rowsKey, deltas, deltasKey, onCrosshair]);

  useEffect(() => {
    const seriesByDelta = seriesByDeltaRef.current;
    if (seriesByDelta.size === 0) return;
    for (const [delta, series] of seriesByDelta) {
      series.applyOptions({ visible: enabledDeltas.has(delta) });
    }
  }, [enabledDeltas]);
}

function pickRows(
  data: ReturnType<typeof useSurface>['data'],
  venueId: string | null,
  tenorMode: TenorMode,
): { rows: MultiDeltaRow[] | null; deltas: readonly number[] } {
  if (!data || !venueId) return { rows: null, deltas: [] };
  if (tenorMode === 'listed') {
    const rows = data.venueSurfaceFineSmoothed?.[venueId];
    return {
      rows: rows ? rows.map((r) => ({ dte: r.dte, ivs: r.ivs })) : null,
      deltas: data.surfaceFineDeltasDense,
    };
  }
  const cmm = data.venueSurfaceFineCmm?.[venueId];
  if (!cmm) return { rows: null, deltas: data.surfaceFineDeltasDense };
  return {
    rows: cmm.map((r) => ({ dte: r.tenorDays, ivs: r.ivs })),
    deltas: data.surfaceFineDeltasDense,
  };
}

export default function AtmTermStructure({ defaultUnderlying = 'BTC' }: Props) {
  const [localUnderlying, setLocalUnderlying] = useState(defaultUnderlying);
  const containerRef = useRef<HTMLDivElement>(null);
  const multiContainerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [enabledVenues, setEnabledVenues] = useState<Set<string>>(new Set());
  const [showAverage, setShowAverage] = useState(true);

  const [mode, setMode] = useState<Mode>('per-venue-atm');
  const [selectedVenue, setSelectedVenue] = useState<string | null>(null);
  const [tenorMode, setTenorMode] = useState<TenorMode>('listed');
  const [enabledDeltas, setEnabledDeltas] = useState<Set<number>>(new Set());
  const [crosshair, setCrosshair] = useState<CrosshairState | null>(null);

  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];
  const { data } = useSurface(localUnderlying, VENUE_IDS);

  const venuesWithData = VENUE_LIST.filter((v) => {
    const points = data?.venueAtm[v.id];
    return points && points.some((p) => p.atm != null);
  });

  const venuesWithFine = useMemo(() => {
    if (!data?.venueSurfaceFineSmoothed) return [] as string[];
    return Object.keys(data.venueSurfaceFineSmoothed).filter(
      (id) => (data.venueSurfaceFineSmoothed?.[id]?.length ?? 0) > 0,
    );
  }, [data]);

  useEffect(() => {
    if (mode !== 'multi-delta') return;
    if (selectedVenue && venuesWithFine.includes(selectedVenue)) return;
    setSelectedVenue(venuesWithFine[0] ?? null);
  }, [mode, selectedVenue, venuesWithFine]);

  const { rows: multiRows, deltas: multiDeltas } = useMemo(
    () => pickRows(data, selectedVenue, tenorMode),
    [data, selectedVenue, tenorMode],
  );

  const presetAppliedRef = useRef(false);
  useEffect(() => {
    if (multiDeltas.length === 0) return;
    if (presetAppliedRef.current) return;
    presetAppliedRef.current = true;
    setEnabledDeltas(preset25Deltas(multiDeltas));
  }, [multiDeltas]);

  useTermStructureChart(
    containerRef,
    mode === 'per-venue-atm' ? data : undefined,
    enabledVenues,
    showAverage,
  );

  useMultiDeltaTermStructureChart(
    multiContainerRef,
    mode === 'multi-delta' ? multiRows : null,
    multiDeltas,
    enabledDeltas,
    setCrosshair,
  );

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    const container = multiContainerRef.current;
    if (!tooltip || !container || !crosshair) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const margin = 12;
    let left = crosshair.x + margin;
    let top = crosshair.y + margin;
    if (left + tw + margin > cw) left = Math.max(margin, crosshair.x - tw - margin);
    if (top + th + margin > ch) top = Math.max(margin, crosshair.y - th - margin);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }, [crosshair]);

  const expiryByDte = useMemo(() => {
    const m = new Map<number, string>();
    if (mode === 'multi-delta' && tenorMode === 'listed' && data) {
      const venueRows = selectedVenue ? data.venueSurfaceFineSmoothed?.[selectedVenue] : undefined;
      for (const r of venueRows ?? []) m.set(r.dte, r.expiry);
    }
    return m;
  }, [mode, tenorMode, data, selectedVenue]);

  const toggleVenue = (venueId: string) => {
    setEnabledVenues((prev) => {
      const next = new Set(prev);
      if (next.has(venueId)) next.delete(venueId);
      else next.add(venueId);
      return next;
    });
  };

  const toggleDelta = (delta: number) => {
    setEnabledDeltas((prev) => {
      const next = new Set(prev);
      if (next.has(delta)) next.delete(delta);
      else next.add(delta);
      return next;
    });
  };

  const logo = getTokenLogo(localUnderlying);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>ATM Term Structure</span>
        <DropdownPicker
          size="sm"
          value={localUnderlying}
          onChange={setLocalUnderlying}
          icon={logo ? <img src={logo} alt="" className={styles.tokenLogo} /> : undefined}
          options={underlyings.map((u) => ({ value: u, label: u }))}
        />

        <div className={styles.modeSegmented} role="tablist" aria-label="Term structure mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'per-venue-atm'}
            className={mode === 'per-venue-atm' ? styles.segActive : styles.seg}
            onClick={() => setMode('per-venue-atm')}
          >
            ATM · per venue
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'multi-delta'}
            className={mode === 'multi-delta' ? styles.segActive : styles.seg}
            onClick={() => setMode('multi-delta')}
          >
            Multi-delta
          </button>
        </div>
      </div>

      {mode === 'per-venue-atm' ? (
        <>
          <div className={styles.venues}>
            <label className={styles.venueToggle}>
              <input
                type="checkbox"
                checked={showAverage}
                onChange={() => setShowAverage((p) => !p)}
                className={styles.checkbox}
              />
              <span className={styles.venueSwatch} style={{ background: AVG_COLOR }} />
              Average
            </label>
            {venuesWithData.map((v) => {
              const active = enabledVenues.has(v.id);
              return (
                <label key={v.id} className={styles.venueToggle}>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleVenue(v.id)}
                    className={styles.checkbox}
                  />
                  {v.logo && <img src={v.logo} className={styles.venueLogo} alt="" />}
                  <span className={styles.venueSwatch} style={{ background: venueColor(v.id) }} />
                  {v.shortLabel}
                </label>
              );
            })}
          </div>

          <div className={styles.chartArea}>
            <div className={styles.chartWrap} ref={containerRef} />
          </div>
        </>
      ) : (
        <>
          <div className={styles.multiControls}>
            <DropdownPicker
              size="sm"
              value={selectedVenue ?? ''}
              onChange={(v) => setSelectedVenue(v || null)}
              options={venuesWithFine.map((id) => {
                const meta = VENUE_LIST.find((m) => m.id === id);
                return { value: id, label: meta?.shortLabel ?? id };
              })}
            />
            <div className={styles.tenorSegmented} role="tablist" aria-label="Tenor mode">
              <button
                type="button"
                role="tab"
                aria-selected={tenorMode === 'listed'}
                className={tenorMode === 'listed' ? styles.segActive : styles.seg}
                onClick={() => setTenorMode('listed')}
              >
                Listed
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tenorMode === 'cmm'}
                className={tenorMode === 'cmm' ? styles.segActive : styles.seg}
                onClick={() => setTenorMode('cmm')}
              >
                CMM
              </button>
            </div>
          </div>

          <div className={styles.multiLayout}>
            <DeltaToggleLegend
              deltas={multiDeltas}
              enabled={enabledDeltas}
              onToggle={toggleDelta}
              onSetAll={setEnabledDeltas}
            />
            <div className={styles.chartArea}>
              <div className={styles.chartWrap} ref={multiContainerRef} />
              <div
                ref={tooltipRef}
                className={styles.tooltip}
                style={{ visibility: crosshair ? 'visible' : 'hidden' }}
                aria-hidden={!crosshair}
              >
                {crosshair && (
                  <>
                    <div className={styles.tooltipHead}>
                      {expiryByDte.get(crosshair.dte) ?? `${crosshair.dte}d`}
                      {expiryByDte.has(crosshair.dte) ? ` (${crosshair.dte}d)` : ''}
                    </div>
                    <ul className={styles.tooltipList}>
                      {crosshair.values
                        .slice()
                        .sort((a, b) => a.delta - b.delta)
                        .map(({ delta, iv }) => (
                          <li key={delta} className={styles.tooltipRow}>
                            <span
                              className={styles.tooltipSwatch}
                              style={{ background: deltaColor(delta) }}
                            />
                            <span className={styles.tooltipLabel}>{deltaLabel(delta)}</span>
                            <span className={styles.tooltipValue}>{fmtIv(iv)}</span>
                          </li>
                        ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
