// packages/web/src/features/chain/FloatingChartPanel.tsx
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { InstrumentCandleInterval, InstrumentCandleRange, VenueId } from '@oggregator/protocol';
import type { EnrichedChainResponse } from '@shared/enriched';
import { VENUES } from '@lib/venue-meta';
import type { ChartPanel } from './chart-panels-store.js';
import { useChartPanelsStore } from './chart-panels-store.js';
import { useInstrumentCandles, useLiveMidFromChain } from './use-instrument-candles.js';
import { toVenueSymbol, NotSupportedVenueError, isChartSupportedVenue } from './instrument-symbol.js';
import InstrumentChart from './InstrumentChart.js';
import styles from './FloatingChartPanel.module.css';

const INTERVALS: InstrumentCandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
const RANGES: InstrumentCandleRange[] = ['1d', '7d', '30d', 'max'];

interface DragState { startX: number; startY: number; panelX: number; panelY: number }
interface ResizeState { startX: number; startY: number; w: number; h: number }

function useStrikeVenues(underlying: string, expiry: string, strike: number, type: 'call' | 'put'): VenueId[] {
  const qc = useQueryClient();
  const entries = qc.getQueriesData<EnrichedChainResponse>({ queryKey: ['chain', underlying, expiry] });
  for (const [, data] of entries) {
    if (!data) continue;
    const row = data.strikes.find((s) => s.strike === strike);
    if (!row) continue;
    const side = type === 'call' ? row.call : row.put;
    return (Object.keys(side.venues) as VenueId[]).filter(isChartSupportedVenue);
  }
  return [];
}

function switchPanelVenue(
  newVenue: VenueId,
  panel: ChartPanel,
  close: (id: string) => void,
  openPanel: (args: { venue: VenueId; symbol: string; underlying: string; expiry: string; strike: number; type: 'call' | 'put' }) => string,
): void {
  if (newVenue === panel.venue) return;
  try {
    const newSymbol = toVenueSymbol({
      venue: newVenue,
      underlying: panel.underlying,
      expiry: panel.expiry,
      strike: panel.strike,
      type: panel.type,
    });
    close(panel.id);
    openPanel({
      venue: newVenue,
      symbol: newSymbol,
      underlying: panel.underlying,
      expiry: panel.expiry,
      strike: panel.strike,
      type: panel.type,
    });
  } catch (err) {
    if (err instanceof NotSupportedVenueError) return;
    throw err;
  }
}

export default function FloatingChartPanel({ panel }: { panel: ChartPanel }) {
  const update = useChartPanelsStore((s) => s.updatePanel);
  const close = useChartPanelsStore((s) => s.closePanel);
  const front = useChartPanelsStore((s) => s.bringToFront);
  const openPanel = useChartPanelsStore((s) => s.openPanel);
  const strikeVenues = useStrikeVenues(panel.underlying, panel.expiry, panel.strike, panel.type);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);

  const liveMid = useLiveMidFromChain(
    panel.underlying, panel.expiry, panel.strike, panel.type, panel.venue,
  );
  const { candles, markLine, isLoading, error, priceCurrency } = useInstrumentCandles({
    venue: panel.venue,
    symbol: panel.symbol,
    interval: panel.interval,
    range: panel.range,
    liveMid,
  });

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        update(panel.id, {
          x: Math.max(0, dragRef.current.panelX + dx),
          y: Math.max(0, dragRef.current.panelY + dy),
        });
      } else if (resizeRef.current) {
        const dw = e.clientX - resizeRef.current.startX;
        const dh = e.clientY - resizeRef.current.startY;
        update(panel.id, {
          w: Math.max(320, resizeRef.current.w + dw),
          h: Math.max(220, resizeRef.current.h + dh),
        });
      }
    }
    function onUp() {
      dragRef.current = null;
      resizeRef.current = null;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [panel.id, update]);

  function startDrag(e: React.PointerEvent) {
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      panelX: panel.x, panelY: panel.y,
    };
    front(panel.id);
  }
  function startResize(e: React.PointerEvent) {
    e.stopPropagation();
    resizeRef.current = {
      startX: e.clientX, startY: e.clientY,
      w: panel.w, h: panel.h,
    };
    front(panel.id);
  }

  return (
    <div
      className={styles.panel}
      data-minimized={panel.minimized || undefined}
      style={{
        transform: `translate(${panel.x}px, ${panel.y}px)`,
        width: panel.w,
        height: panel.minimized ? 28 : panel.h,
        zIndex: 1500 + panel.zSeq,
      }}
      onPointerDown={() => front(panel.id)}
    >
      <div className={styles.titlebar} onPointerDown={startDrag}>
        <span className={styles.title}>
          {panel.symbol}
          <span className={styles.venueLabel}> · {VENUES[panel.venue]?.shortLabel ?? panel.venue}</span>
          {priceCurrency && (
            <span className={styles.venueLabel}> · {priceCurrency}</span>
          )}
        </span>
        <span className={styles.controls}>
          <button
            type="button"
            onClick={() => update(panel.id, { minimized: !panel.minimized })}
            aria-label={panel.minimized ? 'Restore' : 'Minimize'}
          >—</button>
          <button type="button" onClick={() => close(panel.id)} aria-label="Close">✕</button>
        </span>
      </div>
      {!panel.minimized && (
        <>
          <div className={styles.toolbar}>
            <div className={styles.intervals}>
              {INTERVALS.map((i) => (
                <button
                  key={i}
                  type="button"
                  data-active={panel.interval === i || undefined}
                  onClick={() => update(panel.id, { interval: i })}
                >{i}</button>
              ))}
            </div>
            <div className={styles.ranges}>
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  data-active={panel.range === r || undefined}
                  onClick={() => update(panel.id, { range: r })}
                >{r}</button>
              ))}
            </div>
            <div className={styles.overlays}>
              <button
                type="button"
                data-active={panel.overlays.mark || undefined}
                onClick={() => update(panel.id, { overlays: { ...panel.overlays, mark: !panel.overlays.mark } })}
              >Mark</button>
              <button
                type="button"
                data-active={panel.overlays.ma9 || undefined}
                onClick={() => update(panel.id, { overlays: { ...panel.overlays, ma9: !panel.overlays.ma9 } })}
              >MA9</button>
              <button
                type="button"
                data-active={panel.overlays.ma20 || undefined}
                onClick={() => update(panel.id, { overlays: { ...panel.overlays, ma20: !panel.overlays.ma20 } })}
              >MA20</button>
            </div>
            {strikeVenues.length > 0 && (
              <div className={styles.venueDots}>
                {strikeVenues.map((v) => (
                  <button
                    key={v}
                    type="button"
                    data-active={panel.venue === v || undefined}
                    onClick={() => switchPanelVenue(v, panel, close, openPanel)}
                  >{VENUES[v]?.shortLabel ?? v}</button>
                ))}
              </div>
            )}
          </div>
          <div className={styles.body}>
            {isLoading && <div className={styles.empty}>loading…</div>}
            {error && <div className={styles.empty}>error — retry</div>}
            {!isLoading && !error && candles.length === 0 && (
              <div className={styles.empty}>No historical data for this strike on {VENUES[panel.venue]?.shortLabel ?? panel.venue}</div>
            )}
            {!isLoading && !error && candles.length > 0 && (
              <InstrumentChart
                candles={candles}
                markLine={markLine}
                overlays={panel.overlays}
              />
            )}
          </div>
          <div className={styles.resize} onPointerDown={startResize} />
        </>
      )}
    </div>
  );
}

export function MobileChartModal({ panel }: { panel: ChartPanel }) {
  const update = useChartPanelsStore((s) => s.updatePanel);
  const close = useChartPanelsStore((s) => s.closePanel);
  const openPanel = useChartPanelsStore((s) => s.openPanel);
  const strikeVenues = useStrikeVenues(panel.underlying, panel.expiry, panel.strike, panel.type);

  const liveMid = useLiveMidFromChain(
    panel.underlying, panel.expiry, panel.strike, panel.type, panel.venue,
  );
  const { candles, markLine, isLoading, error, priceCurrency } = useInstrumentCandles({
    venue: panel.venue,
    symbol: panel.symbol,
    interval: panel.interval,
    range: panel.range,
    liveMid,
  });

  return (
    <div className={styles.mobileModal}>
      <div className={styles.titlebar}>
        <span className={styles.title}>
          {panel.symbol}
          <span className={styles.venueLabel}> · {VENUES[panel.venue]?.shortLabel ?? panel.venue}</span>
          {priceCurrency && (
            <span className={styles.venueLabel}> · {priceCurrency}</span>
          )}
        </span>
        <button type="button" onClick={() => close(panel.id)} aria-label="Close">✕</button>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.intervals}>
          {INTERVALS.map((i) => (
            <button
              key={i}
              type="button"
              data-active={panel.interval === i || undefined}
              onClick={() => update(panel.id, { interval: i })}
            >{i}</button>
          ))}
        </div>
        <div className={styles.ranges}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              data-active={panel.range === r || undefined}
              onClick={() => update(panel.id, { range: r })}
            >{r}</button>
          ))}
        </div>
        <div className={styles.overlays}>
          <button type="button" data-active={panel.overlays.mark || undefined}
            onClick={() => update(panel.id, { overlays: { ...panel.overlays, mark: !panel.overlays.mark } })}>Mark</button>
          <button type="button" data-active={panel.overlays.ma9 || undefined}
            onClick={() => update(panel.id, { overlays: { ...panel.overlays, ma9: !panel.overlays.ma9 } })}>MA9</button>
          <button type="button" data-active={panel.overlays.ma20 || undefined}
            onClick={() => update(panel.id, { overlays: { ...panel.overlays, ma20: !panel.overlays.ma20 } })}>MA20</button>
        </div>
        {strikeVenues.length > 0 && (
          <div className={styles.venueDots}>
            {strikeVenues.map((v) => (
              <button
                key={v}
                type="button"
                data-active={panel.venue === v || undefined}
                onClick={() => switchPanelVenue(v, panel, close, openPanel)}
              >{VENUES[v]?.shortLabel ?? v}</button>
            ))}
          </div>
        )}
      </div>
      <div className={styles.body}>
        {isLoading && <div className={styles.empty}>loading…</div>}
        {error && <div className={styles.empty}>error — retry</div>}
        {!isLoading && !error && candles.length === 0 && (
          <div className={styles.empty}>No historical data for this strike on {VENUES[panel.venue]?.shortLabel ?? panel.venue}</div>
        )}
        {!isLoading && !error && candles.length > 0 && (
          <InstrumentChart candles={candles} markLine={markLine} overlays={panel.overlays} />
        )}
      </div>
    </div>
  );
}
