import { useEffect, useMemo } from 'react';

import { useExpiries } from '@features/chain/queries';
import { useAppStore } from '@stores/app-store';

import { useChainWs } from './useChainWs';

export function useGlobalFeedStatus() {
  const underlying = useAppStore((s) => s.underlying);
  const expiry = useAppStore((s) => s.expiry);
  const setExpiry = useAppStore((s) => s.setExpiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const setFeedStatus = useAppStore((s) => s.setFeedStatus);

  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const { connectionState, staleMs, failedVenues } = useChainWs({
    underlying,
    expiry,
    venues: activeVenues,
  });

  const failedVenueIds = useMemo(() => failedVenues.map((venue) => venue.venue), [failedVenues]);

  useEffect(() => {
    if (expiries.length > 0 && !expiry) {
      setExpiry(expiries[0]!);
    }
  }, [expiries, expiry, setExpiry]);

  useEffect(() => {
    setFeedStatus({
      connectionState,
      failedVenueCount: failedVenueIds.length,
      failedVenueIds,
      failedVenues,
      staleMs,
      lastUpdateMs: connectionState === 'live' && staleMs != null ? Date.now() - staleMs : null,
    });
  }, [connectionState, failedVenueIds, failedVenues, staleMs, setFeedStatus]);
}
