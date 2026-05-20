import type { VenueExecution, OrderSide } from './types';

export type PerLegBadge = 'ok' | 'elevated' | 'high' | 'excessive';
export type StrategyBadge = PerLegBadge | 'unroutable';

export interface RoutingPin {
  venue: string;
  pickedSide: 'bid' | 'ask';
}

export interface StrategyRouting {
  legs: Record<string, RoutingPin>;
}

export interface VenueQuoteForLeg {
  venue: string;
  exec: VenueExecution;
}

export interface LegInput {
  legId: string;
  direction: OrderSide;
  quantity: number;
  venues: VenueQuoteForLeg[];
}

export interface PerLegRoundTripQuote {
  legId: string;
  venue: string;
  bidPrice: number | null;
  askPrice: number | null;
  bidSize: number | null;
  askSize: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  spreadCostUsd: number | null;
  entryFeeUsd: number | null;
  exitFeeUsd: number | null;
  roundTripUsd: number | null;
  roundTripPerContract: number | null;
  fillable: boolean;
  slippageWarning: boolean;
  classification: PerLegBadge | null;
}

export interface PerLegRoundTrip extends PerLegRoundTripQuote {
  pinned: boolean;
}

export interface StrategyRoundTrip {
  netEntryUsd: number;
  totalRoundTripUsd: number;
  totalEntryFeesUsd: number;
  totalExitFeesUsd: number;
  perLeg: PerLegRoundTrip[];
  worstLeg: PerLegRoundTrip | null;
  strategyClassification: StrategyBadge;
  routable: boolean;
}

const PER_LEG_THRESHOLDS = {
  ok: 2,
  elevated: 5,
  high: 7,
} as const;

export function classifyPerLeg(roundTripPerContract: number): PerLegBadge {
  if (roundTripPerContract <= PER_LEG_THRESHOLDS.ok) return 'ok';
  if (roundTripPerContract <= PER_LEG_THRESHOLDS.elevated) return 'elevated';
  if (roundTripPerContract <= PER_LEG_THRESHOLDS.high) return 'high';
  return 'excessive';
}

export function classifyStrategy(
  totalRoundTripUsd: number,
  legCount: number,
  totalQty: number,
): PerLegBadge {
  if (legCount <= 0 || totalQty <= 0) return 'ok';
  const perContract = totalRoundTripUsd / totalQty;
  return classifyPerLeg(perContract);
}

const BADGE_RANK: Record<PerLegBadge, number> = {
  ok: 0,
  elevated: 1,
  high: 2,
  excessive: 3,
};

function worstBadge(a: PerLegBadge | null, b: PerLegBadge | null): PerLegBadge | null {
  if (!a) return b;
  if (!b) return a;
  return BADGE_RANK[a] >= BADGE_RANK[b] ? a : b;
}

export function computeQuoteCost(
  exec: VenueExecution,
  direction: OrderSide,
  quantity: number,
  legId: string,
): PerLegRoundTripQuote {
  const { bidPrice, askPrice, bidSize, askSize, takerFee, contractSize } = exec;

  const entryPrice = direction === 'buy' ? askPrice : bidPrice;
  const exitPrice = direction === 'buy' ? bidPrice : askPrice;
  const sizeAtEntry = direction === 'buy' ? askSize : bidSize;

  if (entryPrice == null || exitPrice == null) {
    return {
      legId,
      venue: exec.venue,
      bidPrice,
      askPrice,
      bidSize,
      askSize,
      entryPrice,
      exitPrice,
      spreadCostUsd: null,
      entryFeeUsd: null,
      exitFeeUsd: null,
      roundTripUsd: null,
      roundTripPerContract: null,
      fillable: false,
      slippageWarning: false,
      classification: null,
    };
  }

  const spreadRaw = entryPrice - exitPrice;
  const spreadAbs = Math.abs(spreadRaw) * quantity * contractSize;
  const entryFeeUsd = entryPrice * quantity * contractSize * takerFee;
  const exitFeeUsd = exitPrice * quantity * contractSize * takerFee;
  const roundTripUsd = spreadAbs + entryFeeUsd + exitFeeUsd;
  const roundTripPerContract = quantity > 0 ? roundTripUsd / quantity : 0;

  const fillable = sizeAtEntry == null ? true : quantity <= sizeAtEntry;
  const slippageWarning =
    sizeAtEntry != null && sizeAtEntry > 0 && quantity > sizeAtEntry * 0.8;

  return {
    legId,
    venue: exec.venue,
    bidPrice,
    askPrice,
    bidSize,
    askSize,
    entryPrice,
    exitPrice,
    spreadCostUsd: spreadAbs,
    entryFeeUsd,
    exitFeeUsd,
    roundTripUsd,
    roundTripPerContract,
    fillable,
    slippageWarning,
    classification: classifyPerLeg(roundTripPerContract),
  };
}

export function buildLegQuotes(leg: LegInput): PerLegRoundTripQuote[] {
  return leg.venues.map((v) => computeQuoteCost(v.exec, leg.direction, leg.quantity, leg.legId));
}

export function autoPickVenue(quotes: PerLegRoundTripQuote[]): string | null {
  const valid = quotes.filter((q) => q.entryPrice != null && q.roundTripUsd != null);
  if (valid.length === 0) return null;

  const fillable = valid.filter((q) => q.fillable);
  const pool = fillable.length > 0 ? fillable : valid;

  let best = pool[0]!;
  for (const q of pool) {
    if (q.roundTripUsd! < best.roundTripUsd!) best = q;
  }
  return best.venue;
}

function findRoutingPin(
  legs: LegInput[],
  routing: StrategyRouting,
): Record<string, RoutingPin> {
  const out: Record<string, RoutingPin> = {};
  for (const leg of legs) {
    const existing = routing.legs[leg.legId];
    if (existing && leg.venues.some((v) => v.venue === existing.venue)) {
      out[leg.legId] = existing;
      continue;
    }
    const quotes = buildLegQuotes(leg);
    const venue = autoPickVenue(quotes);
    if (venue) {
      out[leg.legId] = {
        venue,
        pickedSide: leg.direction === 'buy' ? 'ask' : 'bid',
      };
    }
  }
  return out;
}

export function deriveAutoRouting(legs: LegInput[]): StrategyRouting {
  return { legs: findRoutingPin(legs, { legs: {} }) };
}

export function computeStrategyRoundTrip(
  legs: LegInput[],
  routing: StrategyRouting,
): StrategyRoundTrip {
  let netEntryUsd = 0;
  let totalRoundTripUsd = 0;
  let totalEntryFeesUsd = 0;
  let totalExitFeesUsd = 0;
  let totalQty = 0;
  let routable = true;

  const perLeg: PerLegRoundTrip[] = [];

  for (const leg of legs) {
    totalQty += leg.quantity;
    const pin = routing.legs[leg.legId];
    if (!pin) {
      routable = false;
      perLeg.push({
        legId: leg.legId,
        venue: '',
        bidPrice: null,
        askPrice: null,
        bidSize: null,
        askSize: null,
        entryPrice: null,
        exitPrice: null,
        spreadCostUsd: null,
        entryFeeUsd: null,
        exitFeeUsd: null,
        roundTripUsd: null,
        roundTripPerContract: null,
        fillable: false,
        slippageWarning: false,
        classification: null,
        pinned: false,
      });
      continue;
    }

    const venueQuote = leg.venues.find((v) => v.venue === pin.venue);
    if (!venueQuote) {
      routable = false;
      perLeg.push({
        legId: leg.legId,
        venue: pin.venue,
        bidPrice: null,
        askPrice: null,
        bidSize: null,
        askSize: null,
        entryPrice: null,
        exitPrice: null,
        spreadCostUsd: null,
        entryFeeUsd: null,
        exitFeeUsd: null,
        roundTripUsd: null,
        roundTripPerContract: null,
        fillable: false,
        slippageWarning: false,
        classification: null,
        pinned: true,
      });
      continue;
    }

    const cost = computeQuoteCost(venueQuote.exec, leg.direction, leg.quantity, leg.legId);
    if (cost.roundTripUsd == null || cost.entryPrice == null) {
      routable = false;
    } else {
      const signedEntry =
        leg.direction === 'buy'
          ? -cost.entryPrice * leg.quantity * venueQuote.exec.contractSize
          : cost.entryPrice * leg.quantity * venueQuote.exec.contractSize;
      netEntryUsd += signedEntry;
      totalRoundTripUsd += cost.roundTripUsd;
      totalEntryFeesUsd += cost.entryFeeUsd ?? 0;
      totalExitFeesUsd += cost.exitFeeUsd ?? 0;
    }
    perLeg.push({ ...cost, pinned: true });
  }

  let worstLeg: PerLegRoundTrip | null = null;
  let worstClass: PerLegBadge | null = null;
  for (const l of perLeg) {
    if (!l.classification) continue;
    if (!worstLeg || BADGE_RANK[l.classification] > BADGE_RANK[worstClass!]) {
      worstLeg = l;
      worstClass = l.classification;
    }
  }

  const strategyClassification: StrategyBadge = !routable
    ? 'unroutable'
    : classifyStrategy(totalRoundTripUsd, legs.length, totalQty);

  // The strategy's verdict should be the worse of (linear-scaled total) and (worst leg)
  // so a single toxic leg cannot be averaged away by cheap legs.
  const finalClass: StrategyBadge =
    strategyClassification === 'unroutable'
      ? 'unroutable'
      : worstClass
        ? worstBadge(strategyClassification, worstClass)!
        : strategyClassification;

  return {
    netEntryUsd,
    totalRoundTripUsd,
    totalEntryFeesUsd,
    totalExitFeesUsd,
    perLeg,
    worstLeg,
    strategyClassification: finalClass,
    routable,
  };
}
