import { useEffect, useMemo, useRef, useState } from 'react';
import type { EnrichedChainResponse } from '@shared/enriched';

import { fmtUsdCompact, fmtCompact, formatExpiry } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import styles from '../AnalyticsView.module.css';
import {
  aggregateStrikeOi,
  computeMaxPain,
  type OiMode,
  type StrikeOi,
} from './oi-heatmap-utils';

const EXPIRY_COLORS = [
  '#00E997', '#CB3855', '#50D2C1', '#F0B90B', '#0052FF',
  '#F7A600', '#25FAAF', '#8B5CF6', '#EC4899', '#6366F1',
  '#A855F7', '#14B8A6',
];

function OiStrikeTooltip({
  data,
  tooltipPos,
  hoveredStrike,
  expiryColorMap,
  fmt,
}: {
  data: StrikeOi[];
  tooltipPos: { x: number; y: number };
  hoveredStrike: number;
  expiryColorMap: Map<string, string>;
  fmt: (v: number | null | undefined) => string;
}) {
  const hovered = data.find((d) => d.strike === hoveredStrike);
  if (!hovered) return null;

  return (
    <div
      className={styles.oiTooltip}
      style={{ left: tooltipPos.x + 16, top: tooltipPos.y - 8 }}
    >
      <div className={styles.oiTooltipTitle}>{hovered.strike.toLocaleString()}</div>
      <div className={styles.oiTooltipColumns}>
        {hovered.venues.length > 0 && (
          <div className={styles.oiTooltipCol}>
            <div className={styles.oiTooltipSection}>By Venue</div>
            <div className={styles.oiTooltipHeader}>
              <span />
              <span>Calls</span>
              <span>Puts</span>
            </div>
            {hovered.venues.map((v) => {
              const meta = VENUES[v.venue];
              return (
                <div key={v.venue} className={styles.oiTooltipRow}>
                  <span className={styles.oiTooltipVenue}>
                    {meta?.logo && <img src={meta.logo} className={styles.venueLogo} alt="" />}
                    {meta?.shortLabel ?? v.venue}
                  </span>
                  <span className={styles.oiCall}>{fmt(v.callOi)}</span>
                  <span className={styles.oiPut}>{fmt(v.putOi)}</span>
                </div>
              );
            })}
          </div>
        )}

        {hovered.expiries.length > 1 && (
          <div className={styles.oiTooltipCol}>
            <div className={styles.oiTooltipSection}>By Expiry</div>
            <div className={styles.oiTooltipHeader}>
              <span />
              <span>Calls</span>
              <span>Puts</span>
            </div>
            {hovered.expiries.map((ep) => (
              <div key={ep.expiry} className={styles.oiTooltipRow}>
                <span className={styles.oiTooltipVenue}>
                  <span
                    className={styles.oiTooltipDot}
                    style={{ background: expiryColorMap.get(ep.expiry) }}
                  />
                  {formatExpiry(ep.expiry)}
                </span>
                <span className={styles.oiCall}>{fmt(ep.callOi)}</span>
                <span className={styles.oiPut}>{fmt(ep.putOi)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function useScrollToRef(
  listRef: React.RefObject<HTMLDivElement | null>,
  targetRef: React.RefObject<HTMLDivElement | null>,
  deps: unknown[],
) {
  useEffect(() => {
    if (targetRef.current && listRef.current) {
      const list = listRef.current;
      const target = targetRef.current;
      const offset =
        target.offsetTop - list.offsetTop - list.clientHeight / 2 + target.clientHeight / 2;
      list.scrollTop = Math.max(0, offset);
    }
  }, deps);
}

function OiByStrikeChart({
  chains,
  spotPrice,
}: {
  chains: EnrichedChainResponse[];
  spotPrice: number | null;
}) {
  const [mode, setMode] = useState<OiMode>('contracts');
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(new Set());
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const spotRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const sortedExpiries = useMemo(() => chains.map((c) => c.expiry).sort(), [chains]);
  const expiryColorMap = useMemo(
    () => new Map(sortedExpiries.map((exp, i) => [exp, EXPIRY_COLORS[i % EXPIRY_COLORS.length]!])),
    [sortedExpiries],
  );

  const filteredChains = useMemo(
    () => chains.filter((c) => !hiddenExpiries.has(c.expiry)),
    [chains, hiddenExpiries],
  );
  const data = useMemo(
    () => aggregateStrikeOi(filteredChains, spotPrice, mode),
    [filteredChains, spotPrice, mode],
  );
  const maxPain = useMemo(() => computeMaxPain(filteredChains), [filteredChains]);
  const fmt = mode === 'notional' ? fmtUsdCompact : fmtCompact;

  const maxOi = Math.max(...data.map((d) => Math.max(d.callOi, d.putOi)), 1);

  const spotStrike = useMemo(
    () =>
      spotPrice != null
        ? data.reduce<number | null>((best, d) => {
            if (best === null) return d.strike;
            return Math.abs(d.strike - spotPrice) < Math.abs(best - spotPrice) ? d.strike : best;
          }, null)
        : null,
    [data, spotPrice],
  );

  const maxPainStrike = useMemo(
    () =>
      maxPain != null
        ? data.reduce<number | null>((best, d) => {
            if (best === null) return d.strike;
            return Math.abs(d.strike - maxPain) < Math.abs(best - maxPain) ? d.strike : best;
          }, null)
        : null,
    [data, maxPain],
  );

  useScrollToRef(listRef, spotRef, [data, spotStrike]);

  const handleRowMouse = (strike: number, e: React.MouseEvent) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    setHoveredStrike(strike);
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const toggleExpiry = (expiry: string) => {
    setHiddenExpiries((prev) => {
      const next = new Set(prev);
      if (next.has(expiry)) next.delete(expiry);
      else next.add(expiry);
      return next;
    });
  };

  return (
    <div ref={cardRef} style={{ position: 'relative' }}>
      <div className={styles.oiHeader}>
        <div className={styles.oiControls}>
          <div className={styles.oiToggle}>
            <button
              className={styles.oiToggleBtn}
              data-active={mode === 'contracts' || undefined}
              onClick={() => setMode('contracts')}
            >
              Contracts
            </button>
            <button
              className={styles.oiToggleBtn}
              data-active={mode === 'notional' || undefined}
              onClick={() => setMode('notional')}
            >
              Notional
            </button>
          </div>
        </div>
      </div>

      <div className={styles.curveLegend}>
        {sortedExpiries.map((expiry) => {
          const active = !hiddenExpiries.has(expiry);
          return (
            <button
              key={expiry}
              type="button"
              className={styles.curveLegendItem}
              data-active={active || undefined}
              onClick={() => toggleExpiry(expiry)}
            >
              <span className={styles.curveLegendDot} style={{ background: expiryColorMap.get(expiry) }} />
              {formatExpiry(expiry)}
            </button>
          );
        })}
      </div>

      <div className={styles.oiList} ref={listRef}>
        {data.map((d) => {
          const isSpot = d.strike === spotStrike;
          const isMaxPain = d.strike === maxPainStrike;
          const callPct = (d.callOi / maxOi) * 100;
          const putPct = (d.putOi / maxOi) * 100;
          return (
            <div
              key={d.strike}
              className={styles.oiRow}
              data-spot={isSpot || undefined}
              data-maxpain={isMaxPain || undefined}
              ref={isSpot ? spotRef : undefined}
              onMouseEnter={(e) => handleRowMouse(d.strike, e)}
              onMouseMove={(e) => handleRowMouse(d.strike, e)}
              onMouseLeave={() => { setHoveredStrike(null); setTooltipPos(null); }}
            >
              <div className={styles.oiStrike} data-spot={isSpot || undefined} data-maxpain={isMaxPain || undefined}>
                {d.strike.toLocaleString()}
                {isSpot && <span className={styles.spotTag}>SPOT</span>}
                {isMaxPain && !isSpot && <span className={styles.maxPainTag}>MP</span>}
              </div>
              <div className={styles.oiBars}>
                <div className={styles.oiBarLeft}>
                  <div className={styles.oiBarCall} style={{ width: `${callPct}%` }} />
                </div>
                <div className={styles.oiBarRight}>
                  <div className={styles.oiBarPut} style={{ width: `${putPct}%` }} />
                </div>
              </div>
              <div className={styles.oiValues}>
                <span className={styles.oiCall}>{fmt(d.callOi)}</span>
                <span className={styles.oiPut}>{fmt(d.putOi)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {hoveredStrike != null && tooltipPos && (
        <OiStrikeTooltip
          data={data}
          tooltipPos={tooltipPos}
          hoveredStrike={hoveredStrike}
          expiryColorMap={expiryColorMap}
          fmt={fmt}
        />
      )}

      <div className={styles.oiLegend}>
        <span className={styles.pcrLegendDot} data-type="call" /> Call OI
        <span className={styles.pcrLegendDot} data-type="put" /> Put OI
        {maxPain != null && (
          <>
            <span className={styles.maxPainDot} /> Max Pain
          </>
        )}
      </div>
    </div>
  );
}

export default OiByStrikeChart;
