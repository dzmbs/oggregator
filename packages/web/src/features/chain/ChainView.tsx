import { useState, useEffect, useRef } from 'react';

import { useAppStore } from '@stores/app-store';
import { useChainQuery, useExpiries, useStats, usePrefetchChain } from './queries';
import { useOpenPalette } from '@components/layout/palette-context';
import { Spinner, EmptyState } from '@components/ui';
import { useIsMobile } from '@hooks/useIsMobile';
import { fmtIv, fmtUsdCompact } from '@lib/format';

import ExpiryBar from './ExpiryBar';
import StatStrip from './StatStrip';
import ChainTable from './ChainTable';
import VenueSidebar from './VenueSidebar';
import MyIvInput from './MyIvInput';
import OptionCalculator from './OptionCalculator';
import styles from './ChainView.module.css';

export default function ChainView() {
  const underlying = useAppStore((s) => s.underlying);
  const expiry = useAppStore((s) => s.expiry);
  const setExpiry = useAppStore((s) => s.setExpiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const toggleVenue = useAppStore((s) => s.toggleVenue);
  const setActiveVenues = useAppStore((s) => s.setActiveVenues);
  const myIv = useAppStore((s) => s.myIv);
  const connectionState = useAppStore((s) => s.feedStatus.connectionState);
  const failedVenues = useAppStore((s) => s.feedStatus.failedVenues);
  const openPalette = useOpenPalette();

  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const expiryByVenue = expiriesData?.byVenue;

  // Once the WS is live it delivers a snapshot on every resubscribe (tenor /
  // underlying / venue change), so the REST fetch is redundant and only races
  // the WS write into the same cache key — causing a visible double-render on
  // every tenor click. Keep REST as bootstrap / fallback when WS isn't live.
  const { data: chain, isLoading, error } = useChainQuery(underlying, expiry, activeVenues, {
    enabled: connectionState !== 'live',
  });
  const { data: marketStats } = useStats(underlying);

  // Hold the most recent chain across tenor swaps so the table doesn't unmount
  // during the ~50ms gap between subscribe and snapshot. Once placeholderData
  // is gone, query.data is briefly `undefined` on each tenor change; we keep
  // the table mounted with the previous chain dimmed, then swap in fresh data
  // when it lands. Avoids losing virtualizer / expanded-row state.
  const lastChainRef = useRef<typeof chain>(undefined);
  if (chain) lastChainRef.current = chain;
  const displayChain = chain ?? lastChainRef.current;
  const isStale = !chain && lastChainRef.current != null;

  const prefetchChain = usePrefetchChain(underlying, activeVenues);

  // Only auto-reset venue selection when the underlying changes — not on every
  // expiry switch. Without this guard, manually toggling a venue off and then
  // navigating to a different expiry overwrites the user's selection.
  const lastAutoSetUnderlyingRef = useRef<string | null>(null);
  useEffect(() => {
    if (!expiryByVenue || underlying === lastAutoSetUnderlyingRef.current) return;
    const available = expiryByVenue.map((v) => v.venue);
    if (available.length > 0) {
      lastAutoSetUnderlyingRef.current = underlying;
      setActiveVenues(available);
    }
  }, [underlying, expiryByVenue, setActiveVenues]);

  const isMobile = useIsMobile();
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);

  const myIvFloat = myIv !== '' ? parseFloat(myIv) / 100 : null;
  const myIvValid = myIvFloat != null && !Number.isNaN(myIvFloat) && myIvFloat > 0;

  if (isMobile) {
    return (
      <div className={styles.view}>
        <div className={styles.main}>
          {/* Collapsible stats summary */}
          {displayChain && (
            <button
              className={styles.mobileStatsToggle}
              onClick={() => setStatsExpanded((v) => !v)}
            >
              <span className={styles.mstLabel}>
                ATM {fmtIv(displayChain.stats.atmIv)} · P/C{' '}
                {displayChain.stats.putCallOiRatio?.toFixed(2) ?? '—'} · OI{' '}
                {fmtUsdCompact(displayChain.stats.totalOiUsd)}
              </span>
              <span className={styles.mstChevron} data-expanded={statsExpanded}>
                ›
              </span>
            </button>
          )}

          {statsExpanded && displayChain && (
            <StatStrip
              stats={displayChain.stats}
              underlying={displayChain.underlying}
              dte={displayChain.dte}
              connectionState={connectionState}
              marketStats={marketStats}
            />
          )}

          <div className={styles.tableArea} data-stale={isStale}>
            {isLoading && !displayChain && <Spinner size="lg" label="Loading chain data…" />}
            {error && !displayChain && (
              <EmptyState
                icon="⚠"
                title="Failed to load chain"
                detail={
                  error instanceof Error ? error.message : 'Check your connection and try again.'
                }
              />
            )}
            {displayChain && displayChain.strikes.length === 0 && (
              <EmptyState
                icon="∅"
                title="No options data"
                detail={`No venues returned data for ${underlying} ${expiry}.`}
              />
            )}
            {displayChain && displayChain.strikes.length > 0 && (
              <ChainTable
                strikes={displayChain.strikes}
                atmStrike={displayChain.stats.atmStrike}
                indexPrice={displayChain.stats.indexPriceUsd}
                activeVenues={activeVenues}
                myIv={myIvValid ? myIvFloat : null}
                expiry={expiry}
                underlying={underlying}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.view}>
      <VenueSidebar
        activeVenues={activeVenues}
        onToggle={toggleVenue}
        failedVenues={failedVenues}
      />

      <div className={styles.main}>
        <ExpiryBar
          underlying={underlying}
          spotPrice={displayChain?.stats.forwardPriceUsd}
          spotChange={marketStats?.spot?.change24hPct}
          expiries={expiries}
          selected={expiry}
          onSelect={setExpiry}
          onChangeAsset={openPalette}
          onPrefetch={prefetchChain}
        />

        {displayChain && (
          <StatStrip
            stats={displayChain.stats}
            underlying={displayChain.underlying}
            dte={displayChain.dte}
            connectionState={connectionState}
            marketStats={marketStats}
          />
        )}

        <div className={styles.tableControls}>
          <MyIvInput />
        </div>

        <div className={styles.tableArea} data-stale={isStale}>
          {isLoading && !displayChain && <Spinner size="lg" label="Loading chain data…" />}
          {error && !displayChain && (
            <EmptyState
              icon="⚠"
              title="Failed to load chain"
              detail={
                error instanceof Error ? error.message : 'Check your connection and try again.'
              }
            />
          )}
          {displayChain && displayChain.strikes.length === 0 && (
            <EmptyState
              icon="∅"
              title="No options data"
              detail={`No venues returned data for ${underlying} ${expiry}. The expiry may only be listed on venues that are currently unavailable.`}
            />
          )}
          {displayChain && displayChain.strikes.length > 0 && (
            <ChainTable
              strikes={displayChain.strikes}
              atmStrike={displayChain.stats.atmStrike}
              indexPrice={displayChain.stats.indexPriceUsd}
              activeVenues={activeVenues}
              myIv={myIvValid ? myIvFloat : null}
              expiry={expiry}
              underlying={underlying}
            />
          )}
        </div>
      </div>

      <button
        type="button"
        className={styles.calcFab}
        data-active={calcOpen}
        onClick={() => setCalcOpen((v) => !v)}
        aria-label="Toggle option calculator"
        title="Option Calculator"
      >
        ⌥
      </button>
      {calcOpen && (
        <OptionCalculator
          defaultUnderlying={underlying}
          defaultExpiry={expiry}
          defaultSpot={displayChain?.stats.indexPriceUsd}
          onClose={() => setCalcOpen(false)}
        />
      )}
    </div>
  );
}
