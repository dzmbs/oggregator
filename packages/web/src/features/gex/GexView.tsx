import { useState, useEffect, useRef } from 'react';

import { useAppStore } from '@stores/app-store';
import { AssetPickerButton, Spinner, EmptyState, VenuePickerButton } from '@components/ui';
import { fmtUsd, dteDays, formatExpiry } from '@lib/format';
import { useChainQuery, useExpiries } from '@features/chain/queries';
import { useIsMobile } from '@hooks/useIsMobile';
import styles from './GexView.module.css';

export default function GexView() {
  const underlying = useAppStore((s) => s.underlying);
  const activeVenues = useAppStore((s) => s.activeVenues);

  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];

  // Default to 2nd expiry (more OI than the nearest 1d) or first if only one
  const [expiry, setExpiry] = useState('');
  useEffect(() => {
    if (expiries.length > 0 && (!expiry || !expiries.includes(expiry))) {
      setExpiry(expiries.length > 1 ? expiries[1]! : expiries[0]!);
    }
  }, [expiries, expiry]);

  const isMobile = useIsMobile();
  const [showExplain, setShowExplain] = useState(false);

  const { data: chain, isLoading } = useChainQuery(underlying, expiry, activeVenues);
  const gex = chain?.gex ?? [];
  const spotPrice = chain?.stats.spotIndexUsd ?? null;
  const barsRef = useRef<HTMLDivElement | null>(null);
  const spotRowRef = useRef<HTMLDivElement | null>(null);

  const maxMagnitude = Math.max(...gex.map((g) => Math.abs(g.gexUsdMillions)), 1);
  const sorted = [...gex].sort((a, b) => b.strike - a.strike);
  const nonzero = gex.filter((g) => Math.abs(g.gexUsdMillions) > 0.001);
  const spotStrike =
    spotPrice != null
      ? nonzero.reduce<number | null>((best, row) => {
          if (best == null) return row.strike;
          return Math.abs(row.strike - spotPrice) < Math.abs(best - spotPrice) ? row.strike : best;
        }, null)
      : null;

  useEffect(() => {
    if (!barsRef.current || !spotRowRef.current) return;

    const list = barsRef.current;
    const row = spotRowRef.current;
    const offset = row.offsetTop - list.offsetTop - list.clientHeight / 2 + row.clientHeight / 2;
    list.scrollTop = Math.max(0, offset);
  }, [expiry, nonzero.length, spotStrike]);

  if (isLoading && gex.length === 0) {
    return (
      <div className={styles.view}>
        <Spinner size="lg" label="Loading GEX data…" />
      </div>
    );
  }

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <span className={styles.title}>Gamma Exposure (GEX)</span>
            <AssetPickerButton />
            <VenuePickerButton />
          </div>
          <span className={styles.subtitle}>Dealer hedging pressure per strike in $M</span>
        </div>
        {spotPrice != null && <div className={styles.spotBadge}>Spot: {fmtUsd(spotPrice)}</div>}
      </div>

      {/* Expiry picker */}
      <div className={styles.expiryPicker}>
        {expiries.map((e) => {
          const dte = dteDays(e);
          return (
            <button
              key={e}
              className={styles.expiryBtn}
              data-active={e === expiry}
              onClick={() => setExpiry(e)}
            >
              {formatExpiry(e)}
              <span className={styles.dteBadge} data-urgent={dte <= 1}>
                {dte}d
              </span>
            </button>
          );
        })}
      </div>

      {nonzero.length === 0 ? (
        <EmptyState
          icon="◈"
          title="No GEX data for this expiry"
          detail="Try a further-dated expiry with more open interest."
        />
      ) : (
        <>
          {isMobile ? (
            <button className={styles.explainToggle} onClick={() => setShowExplain((v) => !v)}>
              <span className={styles.explainToggleLabel}>
                <span className={styles.explainDot} data-type="positive" /> Magnet
                <span className={styles.explainDot} data-type="negative" /> Accelerator
              </span>
              <span className={styles.explainToggleChevron} data-expanded={showExplain}>
                ⓘ
              </span>
            </button>
          ) : null}
          {(!isMobile || showExplain) && (
            <div className={styles.explain}>
              <span className={styles.explainItem} data-type="positive">
                <span className={styles.explainDot} data-type="positive" />
                Positive GEX: dealers buy dips and sell rallies to stay hedged → dampens volatility,
                pins price near high-OI strikes
              </span>
              <span className={styles.explainItem} data-type="negative">
                <span className={styles.explainDot} data-type="negative" />
                Negative GEX: dealers sell into dips and buy into rallies → amplifies moves, expect
                bigger swings
              </span>
              <span className={styles.explainFormula}>
                GEX per strike = OI × Gamma × Spot² × contract size. Calls contribute positive, puts
                negative.
              </span>
            </div>
          )}

          <div className={styles.chart}>
            <div className={styles.axis}>
              <div className={styles.axisLeft}>
                <span className={styles.axisLabel}>← Negative (accelerator)</span>
              </div>
              <div className={styles.axisCenter}>0</div>
              <div className={styles.axisRight}>
                <span className={styles.axisLabel}>Positive (magnet) →</span>
              </div>
            </div>

            <div className={styles.bars} ref={barsRef}>
              {sorted.map((g) => {
                const pct = (Math.abs(g.gexUsdMillions) / maxMagnitude) * 100;
                const positive = g.gexUsdMillions >= 0;
                const isNearSpot = g.strike === spotStrike;

                return (
                  <div
                    key={g.strike}
                    className={styles.barRow}
                    data-near-spot={isNearSpot || undefined}
                    ref={isNearSpot ? spotRowRef : undefined}
                  >
                    <div className={styles.strikeLabel} data-near-spot={isNearSpot}>
                      {g.strike.toLocaleString()}
                      {isNearSpot && <span className={styles.spotMarker}>◄ SPOT</span>}
                    </div>
                    <div className={styles.barTrack}>
                      <div className={styles.leftHalf}>
                        {!positive && (
                          <div
                            className={styles.bar}
                            data-type="negative"
                            style={{ width: `${pct}%` }}
                            title={`${g.strike}: ${g.gexUsdMillions.toFixed(1)}M USD GEX`}
                          />
                        )}
                      </div>
                      <div className={styles.spine} />
                      <div className={styles.rightHalf}>
                        {positive && (
                          <div
                            className={styles.bar}
                            data-type="positive"
                            style={{ width: `${pct}%` }}
                            title={`${g.strike}: +${g.gexUsdMillions.toFixed(1)}M USD GEX`}
                          />
                        )}
                      </div>
                    </div>
                    <div className={styles.valueLabel}>
                      {positive ? '+' : ''}
                      {g.gexUsdMillions.toFixed(1)}M
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
