import { useEffect, useMemo, useState } from 'react';

import { useAppStore } from '@stores/app-store';
import { ExpiryBar, useChainQuery, useExpiries, usePrefetchChain } from '@features/chain';
import { useSurface } from '@features/surface/queries';
import { useOpenPalette } from '@components/layout/palette-context';
import { useIsMobile } from '@hooks/useIsMobile';
import { Spinner, EmptyState } from '@components/ui';
import type { SpreadKind } from '@lib/analytics/verticalSpread';

import SpreadBuilderPanel from './SpreadBuilderPanel';
import SignalCard from './SignalCard';
import VenueRouterTable from './VenueRouterTable';
import VolSmileInset from './VolSmileInset';
import VrpChip from './VrpChip';
import { computeSviRichness } from './sviRichness';
import { useRegimeQuery } from './useRegimeQuery';
import { useVerticalSpreadAnalysis } from './useVerticalSpreadAnalysis';
import styles from './AlphaView.module.css';

export default function AlphaView() {
  const underlying = useAppStore((s) => s.underlying);
  const expiry = useAppStore((s) => s.expiry);
  const setExpiry = useAppStore((s) => s.setExpiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const openPalette = useOpenPalette();

  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const prefetchChain = usePrefetchChain(underlying, activeVenues);
  const { data: chain, isLoading, error } = useChainQuery(underlying, expiry, activeVenues);
  const { data: surface } = useSurface(underlying, activeVenues);

  const isMobile = useIsMobile();
  const [kind, setKind] = useState<SpreadKind>('call-credit');
  const [shortStrike, setShortStrike] = useState<number | null>(null);
  const [longStrike, setLongStrike] = useState<number | null>(null);

  const atmStrike = chain?.stats.atmStrike ?? null;

  const sortedStrikes = useMemo(() => {
    if (!chain) return null;
    return [...chain.strikes].map((s) => s.strike).sort((a, b) => a - b);
  }, [chain]);

  // Compute reasonable defaults for a given spread kind: for call-credit, short
  // ≈ ATM, long ≈ first strike above that. For put-credit, mirror image.
  const defaultsFor = (k: SpreadKind): { shortStrike: number; longStrike: number } | null => {
    if (!sortedStrikes || sortedStrikes.length < 2 || atmStrike == null) return null;
    const atmIdx = nearestIndex(sortedStrikes, atmStrike);
    if (k === 'call-credit') {
      const shortIdx = Math.min(atmIdx + 1, sortedStrikes.length - 2);
      return { shortStrike: sortedStrikes[shortIdx]!, longStrike: sortedStrikes[shortIdx + 1]! };
    }
    const shortIdx = Math.max(atmIdx - 1, 1);
    return { shortStrike: sortedStrikes[shortIdx]!, longStrike: sortedStrikes[shortIdx - 1]! };
  };

  // Seed (or re-seed) leg defaults whenever the current selection isn't valid
  // for the current chain. This covers initial load AND tenor/underlying
  // changes — at the moment the *new* chain arrives, if the prior strikes
  // don't exist on it we atomically swap to fresh defaults, avoiding any
  // render where strikes are null while old data is still on screen.
  useEffect(() => {
    if (!sortedStrikes || sortedStrikes.length < 2) return;
    const strikeSet = new Set(sortedStrikes);
    const valid =
      shortStrike != null &&
      longStrike != null &&
      strikeSet.has(shortStrike) &&
      strikeSet.has(longStrike);
    if (valid) return;
    const d = defaultsFor(kind);
    if (!d) return;
    setShortStrike(d.shortStrike);
    setLongStrike(d.longStrike);
    // defaultsFor is stable per (sortedStrikes, atmStrike); listing those is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedStrikes, atmStrike, kind, shortStrike, longStrike]);

  // Real-world POP wiring: when surface RV is available, the gate switches
  // from risk-neutral N(d₂) to physical-measure POP. Drift is 0 (no view) by
  // default — a future directional-view toggle would set μ here.
  const realWorld = useMemo(
    () => (surface?.rv30d != null ? { drift: 0, sigmaRV: surface.rv30d } : undefined),
    [surface?.rv30d],
  );

  const { data: regime } = useRegimeQuery(underlying);
  const regimeDominant = regime?.dominant ?? null;

  const analysis = useVerticalSpreadAnalysis({
    chain,
    kind,
    shortStrike,
    longStrike,
    venues: activeVenues,
    realWorld,
    regimeDominant,
  });

  const richness = useMemo(
    () => computeSviRichness(analysis.smile, analysis.T),
    [analysis.smile, analysis.T],
  );

  const executableNet = useMemo(() => {
    const sn = analysis.analysis?.short.best?.netAfterFees;
    const ln = analysis.analysis?.long.best?.netAfterFees;
    if (sn == null || ln == null) return null;
    return sn - ln;
  }, [analysis]);

  if (isLoading && !chain) {
    return (
      <div className={styles.view}>
        <Spinner size="lg" label="Loading chain data…" />
      </div>
    );
  }

  if (error && !chain) {
    return (
      <div className={styles.view}>
        <EmptyState
          icon="⚠"
          title="Failed to load chain"
          detail={error instanceof Error ? error.message : 'Check your connection and try again.'}
        />
      </div>
    );
  }

  const builder = chain && (
    <SpreadBuilderPanel
      kind={kind}
      onKindChange={(k) => {
        if (k === kind) return;
        const d = defaultsFor(k);
        setKind(k);
        if (d) {
          setShortStrike(d.shortStrike);
          setLongStrike(d.longStrike);
        } else {
          setShortStrike(null);
          setLongStrike(null);
        }
      }}
      strikes={chain.strikes}
      atmStrike={atmStrike}
      shortStrike={shortStrike}
      longStrike={longStrike}
      onShortChange={setShortStrike}
      onLongChange={setLongStrike}
      riskFreeRate={analysis.r}
      T={analysis.T}
    />
  );

  const signalStack = (
    <>
      <SignalCard
        signal={analysis.analysis?.combinedSignal ?? null}
        regime={regime ?? null}
      />
      <VenueRouterTable
        shortLeg={analysis.analysis?.short ?? null}
        longLeg={analysis.analysis?.long ?? null}
        shortStrike={shortStrike}
        longStrike={longStrike}
        executableNetCredit={executableNet}
      />
      <VolSmileInset
        smile={analysis.smile}
        shortStrike={shortStrike}
        longStrike={longStrike}
        richness={richness}
        T={analysis.T}
      />
    </>
  );

  return (
    <div className={styles.view}>
      {/* MobileToolbar already exposes the expiry picker on mobile — don't double up. */}
      {!isMobile && (
        <ExpiryBar
          underlying={underlying}
          spotPrice={chain?.stats.forwardPriceUsd}
          expiries={expiries}
          selected={expiry}
          onSelect={setExpiry}
          onChangeAsset={openPalette}
          onPrefetch={prefetchChain}
        />
      )}

      <div className={styles.contextStrip}>
        <VrpChip
          atmIv30d={surface?.atmIv30d ?? null}
          rv30d={surface?.rv30d ?? null}
          vrp30d={surface?.vrp30d ?? null}
        />
      </div>

      {chain && chain.strikes.length === 0 && (
        <EmptyState
          icon="∅"
          title="No options data"
          detail={`No venues returned data for ${underlying} ${expiry}.`}
        />
      )}

      {chain && chain.strikes.length > 0 && (
        isMobile ? (
          // On mobile: signal first (what users come for), then router + smile,
          // then the strike builder at the bottom (less central on small screens).
          <div className={styles.mobileStack}>
            {signalStack}
            {builder}
          </div>
        ) : (
          <div className={styles.grid}>
            {builder}
            <div className={styles.rightColumn}>{signalStack}</div>
          </div>
        )
      )}
    </div>
  );
}

function nearestIndex(strikes: number[], target: number): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < strikes.length; i++) {
    const d = Math.abs(strikes[i]! - target);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}
