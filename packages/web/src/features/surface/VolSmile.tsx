import { useRef, useEffect, useState } from 'react';
import {
  createChart,
  LineSeries,
  ColorType,
} from 'lightweight-charts';

import type { EnrichedChainResponse } from '@shared/enriched';
import { useUnderlyings, useExpiries } from '@features/chain';
import { DropdownPicker } from '@components/ui';
import { getTokenLogo } from '@lib/token-meta';
import { VENUE_IDS, VENUE_LIST } from '@lib/venue-meta';
import { formatExpiry, dteDays } from '@lib/format';
import { extractSmile, deltaTickLabel, type XAxisMode } from './smile-utils';
import { useAllExpiriesSmile } from './queries';
import styles from './VolSmile.module.css';

const EXPIRY_COLORS = [
  '#00E997', '#CB3855', '#50D2C1', '#F0B90B', '#0052FF',
  '#F7A600', '#25FAAF', '#8B5CF6', '#EC4899', '#6366F1',
  '#A855F7', '#14B8A6',
];

const CHART_OPTIONS = {
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid as const, color: 'transparent' },
    textColor: '#555B5E',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
  },
  grid: { vertLines: { color: '#1A1A1A' }, horzLines: { color: '#1A1A1A' } },
  rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.08, bottom: 0.08 } },
  crosshair: {
    horzLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
    vertLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333', labelVisible: false },
  },
  handleScale: { mouseWheel: true, pinch: true },
  handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
} as const;

const IV_FORMAT = { type: 'custom' as const, formatter: (p: number) => `${p.toFixed(1)}%` };

function useVolSmileChart(
  containerRef: React.RefObject<HTMLDivElement | null>,
  chains: EnrichedChainResponse[],
  hiddenExpiries: Set<string>,
  selectedVenue: string,
  xAxisMode: XAxisMode,
  expiries: string[],
) {
  const hiddenKey = [...hiddenExpiries].sort().join(',');

  useEffect(() => {
    const container = containerRef.current;
    if (!container || chains.length === 0) return;

    const colors = new Map(expiries.map((e, i) => [e, EXPIRY_COLORS[i % EXPIRY_COLORS.length]!]));
    const tickFmt = xAxisMode === 'delta'
      ? (v: number) => deltaTickLabel(v)
      : (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v));

    const chart = createChart(container, {
      ...CHART_OPTIONS,
      timeScale: { borderColor: '#1F2937', tickMarkFormatter: tickFmt },
    });

    const activeVenues = selectedVenue === 'average' ? VENUE_IDS : [selectedVenue];

    for (const chain of chains) {
      if (hiddenExpiries.has(chain.expiry)) continue;
      const spot = chain.stats.forwardPriceUsd;
      const points = extractSmile(chain.strikes, activeVenues, spot, xAxisMode);
      if (points.length < 3) continue;

      const series = chart.addSeries(LineSeries, {
        color: colors.get(chain.expiry) ?? '#555B5E',
        lineWidth: 2,
        priceFormat: IV_FORMAT,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      series.setData(points.map((p) => ({ time: p.strike as unknown as number, value: p.iv })) as never);
    }

    chart.timeScale().fitContent();
    return () => { chart.remove(); };
  }, [containerRef, chains, hiddenKey, selectedVenue, xAxisMode, expiries]);
}

interface Props {
  defaultUnderlying?: string;
}

export default function VolSmile({ defaultUnderlying = 'BTC' }: Props) {
  const [localUnderlying, setLocalUnderlying] = useState(defaultUnderlying);
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(new Set());
  const [xAxisMode, setXAxisMode] = useState<XAxisMode>('strike');
  const [selectedVenue, setSelectedVenue] = useState('deribit');

  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];
  const { data: expiriesData } = useExpiries(localUnderlying);
  const expiries = expiriesData?.expiries ?? [];

  const { data: chains } = useAllExpiriesSmile(localUnderlying, true);

  const expiryColors = new Map(expiries.map((e, i) => [e, EXPIRY_COLORS[i % EXPIRY_COLORS.length]!]));

  const containerRef = useRef<HTMLDivElement>(null);

  useVolSmileChart(containerRef, chains ?? [], hiddenExpiries, selectedVenue, xAxisMode, expiries);

  const toggleExpiry = (exp: string) => {
    setHiddenExpiries((prev) => {
      const next = new Set(prev);
      if (next.has(exp)) next.delete(exp);
      else next.add(exp);
      return next;
    });
  };

  const toggleAll = () => {
    if (hiddenExpiries.size === 0) {
      setHiddenExpiries(new Set(expiries));
    } else {
      setHiddenExpiries(new Set());
    }
  };

  const logo = getTokenLogo(localUnderlying);

  const venueOptions = [
    { value: 'average', label: 'Average' },
    ...VENUE_LIST.map((v) => ({ value: v.id, label: v.label })),
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Vol Smile</span>
        <DropdownPicker
          size="sm"
          value={localUnderlying}
          onChange={(v: string) => { setLocalUnderlying(v); setHiddenExpiries(new Set()); }}
          icon={logo ? <img src={logo} alt="" className={styles.tokenLogo} /> : undefined}
          options={underlyings.map((u) => ({ value: u, label: u }))}
        />
        <DropdownPicker
          size="sm"
          value={selectedVenue}
          onChange={setSelectedVenue}
          options={venueOptions}
        />
        <div className={styles.xAxisToggle}>
          <button
            type="button"
            className={styles.toggleBtn}
            data-active={xAxisMode === 'delta' || undefined}
            onClick={() => setXAxisMode('delta')}
          >
            Delta
          </button>
          <button
            type="button"
            className={styles.toggleBtn}
            data-active={xAxisMode === 'strike' || undefined}
            onClick={() => setXAxisMode('strike')}
          >
            Strike
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.sidebar}>
          <button
            type="button"
            className={styles.expiryBtn}
            data-active={hiddenExpiries.size === 0 || undefined}
            onClick={toggleAll}
          >
            <span className={styles.expiryLine} style={{ background: '#888' }} />
            <span className={styles.expiryLabel}>All</span>
          </button>
          {expiries.map((exp) => {
            const active = !hiddenExpiries.has(exp);
            const color = expiryColors.get(exp) ?? '#555B5E';
            const dte = dteDays(exp);
            return (
              <button
                key={exp}
                type="button"
                className={styles.expiryBtn}
                data-active={active || undefined}
                onClick={() => toggleExpiry(exp)}
              >
                <span className={styles.expiryLine} style={{ background: color }} />
                <span className={styles.expiryLabel}>{formatExpiry(exp)}</span>
                <span className={styles.expiryDte}>{dte}d</span>
              </button>
            );
          })}
        </div>
        <div className={styles.chartArea}>
          <div className={styles.chartWrap} ref={containerRef} />
        </div>
      </div>
    </div>
  );
}
