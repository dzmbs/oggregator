import { useRef, useEffect, useState, useCallback } from 'react';
import {
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  ColorType,
} from 'lightweight-charts';

import { useAppStore } from '@stores/app-store';
import { useChainQuery, useExpiries } from '@features/chain/queries';
import { Spinner, DropdownPicker } from '@components/ui';
import { formatExpiry, dteDays } from '@lib/format';
import styles from './VolSmile.module.css';

type SmileMode = 'both' | 'call' | 'put';

const ALL_VENUES = ['deribit', 'okx', 'bybit', 'binance', 'derive'];

interface SmilePoint {
  strike: number;
  iv: number;
}

function averageIv(
  venues: Record<string, { markIv?: number | null } | undefined>,
  activeVenues: string[],
): number | null {
  let sum = 0;
  let count = 0;

  for (const [venueId, quote] of Object.entries(venues)) {
    if (!activeVenues.includes(venueId) || quote?.markIv == null) continue;
    sum += quote.markIv;
    count += 1;
  }

  return count > 0 ? sum / count : null;
}

function extractSmile(
  strikes: Array<{
    strike: number;
    call: { venues: Record<string, { markIv?: number | null } | undefined> };
    put: { venues: Record<string, { markIv?: number | null } | undefined> };
  }>,
  activeVenues: string[],
  spotPrice: number | null,
): { calls: SmilePoint[]; puts: SmilePoint[] } {
  const calls: SmilePoint[] = [];
  const puts: SmilePoint[] = [];

  for (const s of strikes) {
    const callIv = averageIv(s.call.venues, activeVenues);
    const putIv = averageIv(s.put.venues, activeVenues);

    if (callIv != null) calls.push({ strike: s.strike, iv: callIv * 100 });
    if (putIv != null) puts.push({ strike: s.strike, iv: putIv * 100 });
  }

  const band = spotPrice ? spotPrice * 0.3 : Infinity;
  const inBand = (p: SmilePoint) => !spotPrice || Math.abs(p.strike - spotPrice) <= band;

  return {
    calls: calls.filter(inBand).sort((a, b) => a.strike - b.strike),
    puts: puts.filter(inBand).sort((a, b) => a.strike - b.strike),
  };
}

export default function VolSmile() {
  const underlying = useAppStore((s) => s.underlying);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const expiry = useAppStore((s) => s.expiry);
  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];

  const defaultExpiry =
    expiry && expiries.includes(expiry)
      ? expiry
      : expiries.length > 1
        ? expiries[1]!
        : (expiries[0] ?? '');

  const [localExpiry, setLocalExpiry] = useState('');
  const smileExpiry = localExpiry && expiries.includes(localExpiry) ? localExpiry : defaultExpiry;

  const handleExpiryChange = useCallback((value: string) => {
    setLocalExpiry(value);
  }, []);

  const { data: chain } = useChainQuery(underlying, smileExpiry, ALL_VENUES);
  const [mode, setMode] = useState<SmileMode>('both');

  const chartRef = useRef<HTMLDivElement>(null);
  const chartApi = useRef<IChartApi | null>(null);
  const callSeries = useRef<ISeriesApi<'Line'> | null>(null);
  const putSeries = useRef<ISeriesApi<'Line'> | null>(null);

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
      rightPriceScale: {
        borderColor: '#1F2937',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: '#1F2937',
        tickMarkFormatter: (v: number) => v.toLocaleString(),
      },
      crosshair: {
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

    const priceFmt = { type: 'custom' as const, formatter: (p: number) => `${p.toFixed(1)}%` };

    const ps = chart.addSeries(LineSeries, {
      color: '#CB3855',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      title: 'Put IV',
      priceFormat: priceFmt,
    });

    const cs = chart.addSeries(LineSeries, {
      color: '#00E997',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      title: 'Call IV',
      priceFormat: priceFmt,
    });

    chartApi.current = chart;
    callSeries.current = cs;
    putSeries.current = ps;

    return () => {
      chart.remove();
      chartApi.current = null;
      callSeries.current = null;
      putSeries.current = null;
    };
  }, []);

  useEffect(() => {
    if (!callSeries.current || !putSeries.current || !chain) return;

    const spot = chain.stats.spotIndexUsd;
    const { calls, puts } = extractSmile(chain.strikes, activeVenues, spot);

    const toData = (points: SmilePoint[]) =>
      points.map((p) => ({ time: p.strike as unknown as number, value: p.iv })) as never;

    const showCall = mode === 'both' || mode === 'call';
    const showPut = mode === 'both' || mode === 'put';

    callSeries.current.setData(showCall ? toData(calls) : []);
    putSeries.current.setData(showPut ? toData(puts) : []);

    // Put is dashed when both visible so call line stays readable on overlap
    putSeries.current.applyOptions({
      lineStyle: mode === 'put' ? LineStyle.Solid : LineStyle.Dashed,
    });

    chartApi.current?.timeScale().fitContent();
  }, [chain, activeVenues, mode]);

  if (!chain) {
    return (
      <div className={styles.wrap}>
        <Spinner size="md" label="Loading smile…" />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Vol Smile</span>

        <DropdownPicker
          size="sm"
          value={smileExpiry}
          onChange={handleExpiryChange}
          options={expiries.map((e) => ({
            value: e,
            label: formatExpiry(e),
            meta: `${dteDays(e)}d`,
          }))}
        />

        <div className={styles.modePicker}>
          {(['both', 'call', 'put'] as const).map((m) => (
            <button
              key={m}
              className={styles.modeBtn}
              data-active={m === mode}
              data-type={m}
              onClick={() => setMode(m)}
            >
              {m === 'both' ? 'Both' : m === 'call' ? 'Call' : 'Put'}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.legend}>
        {(mode === 'both' || mode === 'call') && (
          <span className={styles.legendItem}>
            <span className={styles.legendLine} data-type="call" /> Call IV
          </span>
        )}
        {(mode === 'both' || mode === 'put') && (
          <span className={styles.legendItem}>
            <span
              className={styles.legendLine}
              data-type="put"
              data-dashed={mode === 'both' || undefined}
            />{' '}
            Put IV
          </span>
        )}
      </div>
      <div className={styles.chartArea}>
        <div className={styles.chartWrap} ref={chartRef} />
      </div>
    </div>
  );
}
