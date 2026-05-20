import { useMemo } from 'react';

import type { EnrichedChainResponse, EnrichedStrike } from '@shared/enriched';
import {
  routeVerticalSpread,
  type RegimeLabel,
  type SpreadKind,
  type RoutedSpreadAnalysis,
  type RealWorldParams,
} from '@lib/analytics/verticalSpread';
import { extractSmile, interpAtStrike, type SmileCurve } from '@lib/analytics/smile';

const DEFAULT_RISK_FREE_RATE = 0.05;

export interface AnalysisInput {
  chain: EnrichedChainResponse | undefined;
  kind: SpreadKind;
  shortStrike: number | null;
  longStrike: number | null;
  venues?: readonly string[];
  realWorld?: RealWorldParams;
  regimeDominant?: RegimeLabel | null;
}

export interface AnalysisOutput {
  spot: number | null;
  smile: SmileCurve | null;
  analysis: RoutedSpreadAnalysis | null;
  T: number | null;
  r: number;
}

function computeTFromDte(dte: number | null | undefined): number | null {
  if (dte == null || dte <= 0) return null;
  return dte / 365.25;
}

export function useVerticalSpreadAnalysis({
  chain,
  kind,
  shortStrike,
  longStrike,
  venues,
  realWorld,
  regimeDominant,
}: AnalysisInput): AnalysisOutput {
  // Pre-index strikes by key so the router's lookups are O(1) per WS tick.
  // Separated from the analysis memo so the map only rebuilds when the
  // strikes array identity changes, not on every kind/strike selection.
  const strikeByKey = useMemo(() => {
    const m = new Map<number, EnrichedStrike>();
    for (const s of chain?.strikes ?? []) m.set(s.strike, s);
    return m;
  }, [chain?.strikes]);

  const spot = chain?.stats.indexPriceUsd ?? chain?.stats.forwardPriceUsd ?? null;
  const T = computeTFromDte(chain?.dte);

  // Smile only depends on strikes + spot. Lifting it out of the main memo
  // keeps the SVG inset stable when the user only changes strikes/kind.
  const smile = useMemo(
    () => (spot != null && spot > 0 ? extractSmile(chain?.strikes ?? [], spot) : null),
    [chain?.strikes, spot],
  );

  // Stringify the venues filter so an inline-array prop from the caller
  // doesn't invalidate the analysis memo on every parent render.
  const venuesKey = venues ? venues.join(',') : '';
  const rwKey = realWorld ? `${realWorld.drift}|${realWorld.sigmaRV}` : '';

  const analysis = useMemo(() => {
    if (
      !chain ||
      spot == null ||
      spot <= 0 ||
      T == null ||
      shortStrike == null ||
      longStrike == null ||
      shortStrike === longStrike
    ) {
      return null;
    }
    const smilePoints = smile?.points ?? [];
    const ivAtStrike = (k: number) => interpAtStrike(smilePoints, k);
    return routeVerticalSpread({
      kind,
      shortStrike,
      longStrike,
      strikes: chain.strikes,
      strikeByKey,
      spot,
      T,
      r: DEFAULT_RISK_FREE_RATE,
      venues: venues as readonly import('@shared/enriched').VenueId[] | undefined,
      ivAtStrike,
      realWorld,
      regimeDominant,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain?.strikes, kind, shortStrike, longStrike, spot, T, strikeByKey, venuesKey, smile, rwKey, regimeDominant]);

  return { spot, smile, analysis, T, r: DEFAULT_RISK_FREE_RATE };
}
