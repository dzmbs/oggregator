import { useMemo, useState } from 'react';
import type { VenueId } from '@shared/enriched';
import type { EnrichedSide, InstrumentCandleInterval } from '@oggregator/protocol';
import { VENUES } from '@lib/venue-meta';
import InstrumentChart from './InstrumentChart.js';
import { useInstrumentCandles, useLiveMidFromChain } from './use-instrument-candles.js';
import { toVenueSymbol, NotSupportedVenueError } from './instrument-symbol.js';
import { useChartPanelsStore } from './chart-panels-store.js';
import styles from './InstrumentChartInline.module.css';

interface Props {
  underlying: string;
  expiry: string;
  strike: number;
  type: 'call' | 'put';
  side: EnrichedSide;
  activeVenues: readonly VenueId[];
}

const INTERVALS: InstrumentCandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

function pickPrimaryVenue(side: EnrichedSide, active: readonly VenueId[]): VenueId | null {
  const entries = (Object.entries(side.venues) as [VenueId, { openInterest: number | null }][])
    .filter(([v]) => active.includes(v));
  if (entries.length === 0) return null;
  entries.sort((a, b) => (b[1].openInterest ?? 0) - (a[1].openInterest ?? 0));
  return entries[0]![0];
}

function safeSymbol(args: {
  venue: VenueId; underlying: string; expiry: string; strike: number; type: 'call' | 'put';
}): { symbol: string | null; unsupported: boolean } {
  try {
    return { symbol: toVenueSymbol(args), unsupported: false };
  } catch (e) {
    if (e instanceof NotSupportedVenueError) return { symbol: null, unsupported: true };
    throw e;
  }
}

export default function InstrumentChartInline({
  underlying, expiry, strike, type, side, activeVenues,
}: Props) {
  const initialVenue = useMemo(() => pickPrimaryVenue(side, activeVenues), [side, activeVenues]);
  const [venue, setVenue] = useState<VenueId | null>(initialVenue);
  const [interval, setInterval] = useState<InstrumentCandleInterval>('1h');
  const openPanel = useChartPanelsStore((s) => s.openPanel);

  const { symbol, unsupported } = useMemo(
    () => (venue
      ? safeSymbol({ venue, underlying, expiry, strike, type })
      : { symbol: null, unsupported: false }),
    [venue, underlying, expiry, strike, type],
  );

  const panelId = venue && symbol ? `${venue}:${symbol}` : null;
  const isPoppedOut = useChartPanelsStore((s) =>
    panelId != null && s.panels.some((p) => p.id === panelId),
  );

  const liveMid = useLiveMidFromChain(
    underlying, expiry, strike, type,
    (venue ?? 'deribit') as VenueId,
  );
  const { candles, markLine, isLoading, error } = useInstrumentCandles({
    venue: (venue ?? 'deribit') as VenueId,
    symbol: symbol ?? '',
    interval,
    range: '7d',
    liveMid: venue ? liveMid : null,
    enabled: !!venue && !!symbol && !isPoppedOut,
  });

  if (!venue) {
    return <div className={styles.empty}>No venue with this strike</div>;
  }
  if (unsupported) {
    return (
      <div className={styles.empty}>
        Historical chart unavailable for {VENUES[venue]?.shortLabel ?? venue} — switch venue
        <VenueDotStrip
          venues={Object.keys(side.venues) as VenueId[]}
          active={venue}
          onSwitch={setVenue}
        />
      </div>
    );
  }
  if (isPoppedOut) {
    return <div className={styles.placeholder}>popped out — click panel to focus</div>;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.intervals}>
          {INTERVALS.map((i) => (
            <button
              key={i}
              type="button"
              data-active={interval === i || undefined}
              onClick={() => setInterval(i)}
            >
              {i}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.popOut}
          aria-label="Pop out chart"
          onClick={() => {
            if (symbol) openPanel({ venue, symbol, underlying, expiry, strike, type });
          }}
        >⤢</button>
      </div>
      <VenueDotStrip
        venues={Object.keys(side.venues) as VenueId[]}
        active={venue}
        onSwitch={setVenue}
      />
      {isLoading && <div className={styles.empty}>…</div>}
      {error && <div className={styles.empty}>—</div>}
      {!isLoading && !error && (
        <InstrumentChart
          candles={candles}
          markLine={markLine}
          overlays={{ mark: true, ma9: false, ma20: false }}
          compact
        />
      )}
    </div>
  );
}

function VenueDotStrip({ venues, active, onSwitch }: {
  venues: VenueId[]; active: VenueId; onSwitch: (v: VenueId) => void;
}) {
  return (
    <div className={styles.dots}>
      {venues.map((v) => (
        <button
          key={v}
          type="button"
          data-active={v === active || undefined}
          onClick={() => onSwitch(v)}
          title={v}
        >
          {VENUES[v]?.shortLabel ?? v}
        </button>
      ))}
    </div>
  );
}
