import { buildComparisonChain } from '../../core/aggregator.js';
import {
  buildEnrichedChain,
  computeChainStats,
  computeGex,
  enrichComparisonRow,
  type EnrichedChainResponse,
  type EnrichedStrike,
} from '../../core/enrichment.js';
import type {
  ComparisonRow,
  SnapshotMeta,
  VenueDelta,
  VenueOptionChain,
} from '../../core/types.js';
import type { VenueId } from '../../types/common.js';

export interface ChainProjectionDelta {
  meta: SnapshotMeta;
  deltas: VenueDelta[];
  patch: {
    stats: EnrichedChainResponse['stats'];
    strikes: EnrichedStrike[];
    gex: EnrichedChainResponse['gex'];
  };
}

function quoteTimestamps(venueChains: VenueOptionChain[]): {
  maxQuoteTs: number;
  minQuoteTs: number;
} {
  let maxQuoteTs = 0;
  let minQuoteTs = Number.POSITIVE_INFINITY;

  for (const chain of venueChains) {
    for (const contract of Object.values(chain.contracts)) {
      const ts = contract.quote.timestamp ?? 0;
      if (ts <= 0) continue;
      if (ts > maxQuoteTs) maxQuoteTs = ts;
      if (ts < minQuoteTs) minQuoteTs = ts;
    }
  }

  return {
    maxQuoteTs,
    minQuoteTs: Number.isFinite(minQuoteTs) ? minQuoteTs : 0,
  };
}

function snapshotMetaFromChains(venueChains: VenueOptionChain[]): SnapshotMeta {
  const { maxQuoteTs, minQuoteTs } = quoteTimestamps(venueChains);
  const generatedAt = Date.now();

  return {
    generatedAt,
    maxQuoteTs,
    staleMs: minQuoteTs > 0 ? generatedAt - minQuoteTs : 0,
  };
}

function comparisonRowsMap(
  underlying: string,
  expiry: string,
  venueChains: VenueOptionChain[],
): Map<number, ComparisonRow> {
  const comparison = buildComparisonChain(underlying, expiry, venueChains);
  return new Map(comparison.rows.map((row) => [row.strike, row]));
}

function enrichedStrikesMap(rows: Map<number, ComparisonRow>): Map<number, EnrichedStrike> {
  return new Map(
    [...rows.values()]
      .sort((left, right) => left.strike - right.strike)
      .map((row) => [row.strike, enrichComparisonRow(row)]),
  );
}

export class ChainProjection {
  private venueChains = new Map<VenueId, VenueOptionChain>();
  private comparisonRows = new Map<number, ComparisonRow>();
  private enrichedStrikes = new Map<number, EnrichedStrike>();

  constructor(
    private readonly underlying: string,
    private readonly expiry: string,
  ) {}

  loadSnapshot(venueChains: VenueOptionChain[]): EnrichedChainResponse {
    this.venueChains = new Map(venueChains.map((chain) => [chain.venue, chain]));
    this.comparisonRows = comparisonRowsMap(this.underlying, this.expiry, venueChains);
    this.enrichedStrikes = enrichedStrikesMap(this.comparisonRows);

    return buildEnrichedChain(
      this.underlying,
      this.expiry,
      [...this.comparisonRows.values()],
      venueChains,
    );
  }

  buildSnapshotMeta(): SnapshotMeta {
    return snapshotMetaFromChains([...this.venueChains.values()]);
  }

  applyDeltas(deltas: VenueDelta[]): ChainProjectionDelta | null {
    if (deltas.length === 0) return null;

    const changedStrikes = new Set<number>();

    for (const delta of deltas) {
      const chain = this.venueChains.get(delta.venue);
      const contract = chain?.contracts[delta.symbol];
      if (chain == null || contract == null) return null;

      if (delta.quote != null) {
        contract.quote = { ...contract.quote, ...delta.quote };
      }
      if (delta.greeks != null) {
        contract.greeks = { ...contract.greeks, ...delta.greeks };
      }
      changedStrikes.add(contract.strike);
    }

    for (const strike of changedStrikes) {
      const row = this.comparisonRows.get(strike);
      if (row == null) return null;
      this.enrichedStrikes.set(strike, enrichComparisonRow(row));
    }

    const venueChains = [...this.venueChains.values()];
    const strikes = [...this.enrichedStrikes.values()].sort(
      (left, right) => left.strike - right.strike,
    );
    const stats = computeChainStats(strikes, venueChains);
    const spotPrice = stats.spotIndexUsd ?? stats.indexPriceUsd ?? 0;
    const gex = computeGex([...this.comparisonRows.values()], strikes, spotPrice);
    const patchStrikes = [...changedStrikes]
      .sort((left, right) => left - right)
      .map((strike) => this.enrichedStrikes.get(strike))
      .filter((strike): strike is EnrichedStrike => strike != null);

    return {
      meta: snapshotMetaFromChains(venueChains),
      deltas,
      patch: {
        stats,
        strikes: patchStrikes,
        gex,
      },
    };
  }
}
