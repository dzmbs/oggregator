import { useEffect, useMemo, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineStyle,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
} from 'lightweight-charts';

import { Spinner } from '@components/ui';
import type { Leg } from './payoff';
import { pnlAtPrice } from './payoff';
import { dteDays } from '@lib/format';
import type { SpotCandle } from './queries';
import { ZonesPrimitive, type PriceZone } from './zones-primitive';
import styles from './Architect.module.css';

interface PayoffChartV2Props {
  candles: SpotCandle[];
  breakevens: number[];
  spotPrice: number;
  legs: Leg[];
  loading: boolean;
  available: boolean;
  onSwitchToV1: () => void;
}

export interface CandleSpec {
  resolutionSec: number;
  buckets: number;
}

/**
 * Pick a candle window that scales with the strategy's nearest-leg DTE.
 * Bucket counts are quantized to a small fixed set of tiers per resolution:
 * small DTE edits collapse onto the same query key, which keeps the server
 * cache warm and avoids forcing an upstream Deribit refetch on every leg
 * adjustment. The previous design varied buckets per-day to force refetches,
 * which was the root cause of the "Snapshot stale" banner appearing whenever
 * the user retuned a strategy.
 */
export function pickCandleSpec(legs: Leg[]): CandleSpec {
  if (legs.length === 0) return { resolutionSec: 3600, buckets: 24 };
  const minDte = Math.max(0, Math.min(...legs.map((l) => dteDays(l.expiry))));

  if (minDte < 1) return { resolutionSec: 300, buckets: 48 };          // 4h window
  if (minDte < 3) return { resolutionSec: 1800, buckets: 96 };         // 2d window
  if (minDte < 14) {
    return { resolutionSec: 3600, buckets: minDte < 7 ? 96 : 168 };    // 4d or 7d
  }
  if (minDte < 60) {
    return { resolutionSec: 14400, buckets: minDte < 30 ? 90 : 180 };  // 15d or 30d
  }
  return { resolutionSec: 86400, buckets: minDte < 120 ? 90 : 180 };   // 90d or 180d
}

function buildZones(legs: Leg[], breakevens: number[], spotPrice: number): PriceZone[] {
  if (legs.length === 0) return [];

  if (breakevens.length === 0) {
    const sign = pnlAtPrice(legs, spotPrice) >= 0;
    return [{ low: -Infinity, high: Infinity, profit: sign }];
  }

  const sorted = [...breakevens].sort((a, b) => a - b);
  const zones: PriceZone[] = [];
  const boundaries = [-Infinity, ...sorted, Infinity];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const low = boundaries[i]!;
    const high = boundaries[i + 1]!;
    let probe: number;
    if (Number.isFinite(low) && Number.isFinite(high)) {
      probe = (low + high) / 2;
    } else if (Number.isFinite(high)) {
      probe = (high as number) * 0.5;
    } else if (Number.isFinite(low)) {
      probe = (low as number) * 1.5;
    } else {
      probe = spotPrice;
    }
    zones.push({ low, high, profit: pnlAtPrice(legs, probe) >= 0 });
  }
  return zones;
}

export default function PayoffChartV2({
  candles,
  breakevens,
  spotPrice,
  legs,
  loading,
  available,
  onSwitchToV1,
}: PayoffChartV2Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const primitiveRef = useRef<ZonesPrimitive | null>(null);
  const lastWindowKeyRef = useRef<string>('');

  const zones = useMemo(
    () => buildZones(legs, breakevens, spotPrice),
    [legs, breakevens, spotPrice],
  );

  // Init chart once.
  useEffect(() => {
    const container = chartRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0A0A0A' },
        textColor: '#555B5E',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1A1A1A' },
        horzLines: { color: '#1A1A1A' },
      },
      crosshair: {
        horzLine: { color: '#CB3855', labelBackgroundColor: '#3A1620' },
        vertLine: { color: '#CB3855', labelBackgroundColor: '#3A1620' },
      },
      rightPriceScale: {
        borderColor: '#1F2937',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#1F2937',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#00E997',
      downColor: '#CB3855',
      borderUpColor: '#00E997',
      borderDownColor: '#CB3855',
      wickUpColor: '#00E997',
      wickDownColor: '#CB3855',
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    });

    const primitive = new ZonesPrimitive();
    series.attachPrimitive(primitive);

    chartApiRef.current = chart;
    seriesRef.current = series;
    primitiveRef.current = primitive;

    return () => {
      chart.remove();
      chartApiRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
      primitiveRef.current = null;
      lastWindowKeyRef.current = '';
    };
  }, []);

  // Push candle data. Only fit-content when the underlying window changes
  // (resolution / tenor swap) — incremental websocket updates must preserve
  // any zoom or pan the user has applied.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartApiRef.current;
    if (!series || !chart || candles.length === 0) return;

    const seen = new Set<number>();
    const data = candles
      .map((c) => ({
        time: Math.floor(c.timestamp / 1000) as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .filter((p) => {
        if (seen.has(p.time)) return false;
        seen.add(p.time);
        return true;
      })
      .sort((a, b) => a.time - b.time);
    series.setData(data as never);

    // A "fresh window" is the first load or a structural reset of the data
    // window (resolution change or strategy swap). We detect those by a shrink
    // in length or a backwards jump in the first timestamp; pure rolling
    // updates only nudge the first timestamp forward and grow length.
    const first = data[0]!.time as number;
    const windowKey = `${first}:${data.length}`;
    const prev = lastWindowKeyRef.current;
    let isFresh = prev === '';
    if (!isFresh) {
      const [prevFirstStr, prevLenStr] = prev.split(':');
      const prevFirst = Number(prevFirstStr);
      const prevLen = Number(prevLenStr);
      isFresh = first < prevFirst || data.length < prevLen;
    }
    if (isFresh) {
      chart.timeScale().fitContent();
    }
    lastWindowKeyRef.current = windowKey;
  }, [candles]);

  // Apply break-even price lines.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = [];

    for (const be of breakevens) {
      const line = series.createPriceLine({
        price: be,
        color: '#F0B90B',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'BE',
      });
      priceLinesRef.current.push(line);
    }

    if (spotPrice > 0) {
      const spotLine = series.createPriceLine({
        price: spotPrice,
        color: '#F0B90B66',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
        title: 'spot',
      });
      priceLinesRef.current.push(spotLine);
    }
  }, [breakevens, spotPrice]);

  // Push zones to the chart-canvas primitive. The primitive itself recomputes
  // pixel coordinates on every chart redraw via updateAllViews, so there is
  // nothing to wire up to pan/zoom or resize events here.
  useEffect(() => {
    primitiveRef.current?.setZones(zones);
  }, [zones]);

  if (!available) {
    return (
      <div className={styles.chartV2EmptyState}>
        <div className={styles.chartV2EmptyTitle}>V2 candles cover BTC and ETH only</div>
        <div className={styles.chartV2EmptyDetail}>
          SOL spot history isn’t available on Deribit. The V1 expiry view stays accurate.
        </div>
        <button className={styles.chartV2EmptyBtn} onClick={onSwitchToV1}>
          Switch back to V1
        </button>
      </div>
    );
  }

  return (
    <div className={styles.chartV2Frame}>
      <div className={styles.chartV2Inner}>
        <div className={styles.chartV2Wrap} ref={chartRef} />
        {loading && (
          <div className={styles.chartV2Overlay}>
            <Spinner size="lg" />
          </div>
        )}
      </div>
    </div>
  );
}
