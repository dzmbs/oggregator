import { useRef, useEffect, useState } from 'react';
import { createChart, LineSeries, ColorType, type IChartApi } from 'lightweight-charts';

import { useUnderlyings } from '@features/chain';
import { DropdownPicker } from '@components/ui';
import { getTokenLogo } from '@lib/token-meta';
import { venueColor } from '@lib/colors';
import { VENUE_LIST, VENUE_IDS } from '@lib/venue-meta';
import { useSurface } from './queries';
import styles from './AtmTermStructure.module.css';

const AVG_COLOR = '#50D2C1';

interface Props {
  defaultUnderlying?: string;
}

function useTermStructureChart(
  containerRef: React.RefObject<HTMLDivElement | null>,
  data: ReturnType<typeof useSurface>['data'],
  enabledVenues: Set<string>,
  showAverage: boolean,
) {
  const chartRef = useRef<IChartApi | null>(null);
  // Stable key so a new Set reference doesn't tear down the chart
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

    const priceFmt = { type: 'custom' as const, formatter: (p: number) => `${p.toFixed(1)}%` };

    for (const [venueId, points] of Object.entries(data.venueAtm)) {
      if (!enabledVenues.has(venueId)) continue;
      const seriesData = points
        .filter((p) => p.atm != null && p.dte > 0)
        .map((p) => ({ time: p.dte as unknown as number, value: p.atm! * 100 }));
      if (seriesData.length === 0) continue;

      const series = chart.addSeries(LineSeries, {
        color: venueColor(venueId),
        lineWidth: 1,
        priceFormat: priceFmt,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      series.setData(seriesData as never);
    }

    if (showAverage) {
      const avgData = data.surface
        .filter((r) => r.atm != null && r.dte > 0)
        .map((r) => ({ time: r.dte as unknown as number, value: r.atm! * 100 }));

      if (avgData.length > 0) {
        const avgSeries = chart.addSeries(LineSeries, {
          color: AVG_COLOR,
          lineWidth: 2,
          priceFormat: priceFmt,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        avgSeries.setData(avgData as never);
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

export default function AtmTermStructure({ defaultUnderlying = 'BTC' }: Props) {
  const [localUnderlying, setLocalUnderlying] = useState(defaultUnderlying);
  const containerRef = useRef<HTMLDivElement>(null);
  const [enabledVenues, setEnabledVenues] = useState<Set<string>>(new Set());
  const [showAverage, setShowAverage] = useState(true);

  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];
  const { data } = useSurface(localUnderlying, VENUE_IDS);

  const venuesWithData = VENUE_LIST.filter((v) => {
    const points = data?.venueAtm[v.id];
    return points && points.some((p) => p.atm != null);
  });

  useTermStructureChart(containerRef, data, enabledVenues, showAverage);

  const toggleVenue = (venueId: string) => {
    setEnabledVenues((prev) => {
      const next = new Set(prev);
      if (next.has(venueId)) next.delete(venueId);
      else next.add(venueId);
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
      </div>

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
    </div>
  );
}
