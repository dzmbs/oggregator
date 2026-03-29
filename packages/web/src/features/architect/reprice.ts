import type { EnrichedChainResponse } from '@shared/enriched';
import type { Leg } from './payoff';

interface VenueQuote {
  ask: number | null;
  bid: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  markIv: number | null;
}

type RepriceInput = Pick<Leg, 'type' | 'direction' | 'strike' | 'expiry' | 'quantity'>;

interface RepriceOptions {
  exactStrike?: boolean;
}

function nearestStrike(strikes: number[], target: number): number | null {
  if (strikes.length === 0) return null;

  return strikes.reduce((best, strike) =>
    Math.abs(strike - target) < Math.abs(best - target) ? strike : best,
  );
}

export function repriceLeg(
  chain: EnrichedChainResponse,
  activeVenues: string[],
  leg: RepriceInput,
  options: RepriceOptions = {},
): Omit<Leg, 'id'> | null {
  const availableStrikes = chain.strikes.map((entry) => entry.strike);
  const strike = options.exactStrike ? leg.strike : nearestStrike(availableStrikes, leg.strike);

  if (strike == null) return null;

  const strikeRow = chain.strikes.find((entry) => entry.strike === strike);
  if (!strikeRow) return null;

  const side = leg.type === 'call' ? strikeRow.call : strikeRow.put;
  let bestPrice: number | null = null;
  let bestVenue = '';
  let bestQuote: VenueQuote | null = null;

  for (const [venueId, quote] of Object.entries(side.venues)) {
    if (!quote || !activeVenues.includes(venueId)) continue;

    const price = leg.direction === 'buy' ? quote.ask : quote.bid;
    if (price == null || price <= 0) continue;

    if (
      bestPrice == null ||
      (leg.direction === 'buy' && price < bestPrice) ||
      (leg.direction === 'sell' && price > bestPrice)
    ) {
      bestPrice = price;
      bestVenue = venueId;
      bestQuote = quote;
    }
  }

  if (bestPrice == null || !bestQuote) return null;

  return {
    ...leg,
    strike,
    entryPrice: bestPrice,
    venue: bestVenue,
    delta: bestQuote.delta,
    gamma: bestQuote.gamma,
    theta: bestQuote.theta,
    vega: bestQuote.vega,
    iv: bestQuote.markIv,
  };
}
