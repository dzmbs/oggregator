import { useState, useEffect, useRef } from 'react';

import { useAppStore } from '@stores/app-store';
import { useChainQuery, useExpiries, useStats } from './queries';
import { useChainWs } from '@hooks/useChainWs';
import { useOpenPalette } from '@components/layout';
import { Spinner, EmptyState } from '@components/ui';
import { useIsMobile } from '@hooks/useIsMobile';
import { fmtIv, fmtUsdCompact } from '@lib/format';

import ExpiryBar from './ExpiryBar';
import StatStrip from './StatStrip';
import ChainTable from './ChainTable';
import VenueSidebar from './VenueSidebar';
import MyIvInput from './MyIvInput';
import styles from './ChainView.module.css';

export default function ChainView() {
  const underlying = useAppStore((s) => s.underlying);
  const expiry = useAppStore((s) => s.expiry);
  const setExpiry = useAppStore((s) => s.setExpiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const toggleVenue = useAppStore((s) => s.toggleVenue);
  const setActiveVenues = useAppStore((s) => s.setActiveVenues);
  const myIv = useAppStore((s) => s.myIv);
  const openPalette = useOpenPalette();

  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const expiryByVenue = expiriesData?.byVenue;

  const { data: chain, isLoading, error } = useChainQuery(underlying, expiry, activeVenues);
  const { data: marketStats } = useStats(underlying);
  const setFeedStatus = useAppStore((s) => s.setFeedStatus);
  const { connectionState, staleMs, failedVenues } = useChainWs({
    underlying,
    expiry,
    venues: activeVenues,
  });

  useEffect(() => {
    setFeedStatus({ connectionState, failedVenueCount: failedVenues.length, staleMs });
  }, [connectionState, failedVenues.length, staleMs, setFeedStatus]);

  useEffect(() => {
    if (expiries.length > 0 && !expiry) {
      setExpiry(expiries[0]!);
    }
  }, [expiries, expiry, setExpiry]);

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

  const myIvFloat = myIv !== '' ? parseFloat(myIv) / 100 : null;
  const myIvValid = myIvFloat != null && !isNaN(myIvFloat) && myIvFloat > 0;

  if (isMobile) {
    return (
      <div className={styles.view}>
        <div className={styles.main}>
          {/* Collapsible stats summary */}
          {chain && (
            <button
              className={styles.mobileStatsToggle}
              onClick={() => setStatsExpanded((v) => !v)}
            >
              <span className={styles.mstLabel}>
                ATM {fmtIv(chain.stats.atmIv)} · P/C {chain.stats.putCallOiRatio?.toFixed(2) ?? '—'}{' '}
                · OI {fmtUsdCompact(chain.stats.totalOiUsd)}
              </span>
              <span className={styles.mstChevron} data-expanded={statsExpanded}>
                ›
              </span>
            </button>
          )}

          {statsExpanded && chain && (
            <StatStrip
              stats={chain.stats}
              underlying={chain.underlying}
              dte={chain.dte}
              connectionState={connectionState}
              marketStats={marketStats}
            />
          )}

          <div className={styles.tableArea}>
            {isLoading && !chain && <Spinner size="lg" label="Loading chain data…" />}
            {error && !chain && (
              <EmptyState
                icon="⚠"
                title="Failed to load chain"
                detail={
                  error instanceof Error ? error.message : 'Check your connection and try again.'
                }
              />
            )}
            {chain && chain.strikes.length === 0 && (
              <EmptyState
                icon="∅"
                title="No options data"
                detail={`No venues returned data for ${underlying} ${expiry}.`}
              />
            )}
            {chain && chain.strikes.length > 0 && (
              <ChainTable
                strikes={chain.strikes}
                atmStrike={chain.stats.atmStrike}
                indexPrice={chain.stats.indexPriceUsd}
                activeVenues={activeVenues}
                myIv={myIvValid ? myIvFloat : null}
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
          spotPrice={chain?.stats.spotIndexUsd}
          spotChange={marketStats?.spot?.change24hPct}
          expiries={expiries}
          selected={expiry}
          onSelect={setExpiry}
          onChangeAsset={openPalette}
        />

        {chain && (
          <StatStrip
            stats={chain.stats}
            underlying={chain.underlying}
            dte={chain.dte}
            connectionState={connectionState}
            marketStats={marketStats}
          />
        )}

        <div className={styles.tableControls}>
          <MyIvInput />
        </div>

        <div className={styles.tableArea}>
          {isLoading && !chain && <Spinner size="lg" label="Loading chain data…" />}
          {error && !chain && (
            <EmptyState
              icon="⚠"
              title="Failed to load chain"
              detail={
                error instanceof Error ? error.message : 'Check your connection and try again.'
              }
            />
          )}
          {chain && chain.strikes.length === 0 && (
            <EmptyState
              icon="∅"
              title="No options data"
              detail={`No venues returned data for ${underlying} ${expiry}. The expiry may only be listed on venues that are currently unavailable.`}
            />
          )}
          {chain && chain.strikes.length > 0 && (
            <ChainTable
              strikes={chain.strikes}
              atmStrike={chain.stats.atmStrike}
              indexPrice={chain.stats.indexPriceUsd}
              activeVenues={activeVenues}
              myIv={myIvValid ? myIvFloat : null}
            />
          )}
        </div>
      </div>
    </div>
  );
}
