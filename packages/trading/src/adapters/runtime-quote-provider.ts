import type { VenueId } from '@oggregator/core';
import { ChainRuntimeRegistry, VENUE_IDS } from '@oggregator/core';
import type { QuoteBook, QuoteKey, QuoteProvider } from '../gateways/quote-provider.js';

const DEFAULT_FEES_TAKER_USD = 0;

export class RuntimeQuoteProvider implements QuoteProvider {
  constructor(private readonly registry: ChainRuntimeRegistry) {}

  async getBooks(key: QuoteKey, venues: VenueId[]): Promise<QuoteBook[]> {
    const requestedVenues = venues.length > 0 ? venues : [...VENUE_IDS];
    const { runtime, release } = await this.registry.acquire({
      underlying: key.underlying,
      expiry: key.expiry,
      venues: requestedVenues,
    });
    try {
      const snapshot = await runtime.fetchSnapshotData();
      const strike = snapshot.strikes.find((s) => s.strike === key.strike);
      if (!strike) return [];
      const side = key.optionRight === 'call' ? strike.call : strike.put;
      const books: QuoteBook[] = [];
      for (const [venueId, quote] of Object.entries(side.venues)) {
        const venue = venueId as VenueId;
        if (!requestedVenues.includes(venue)) continue;
        if (!quote) continue;
        books.push({
          venue,
          bidUsd: quote.bid,
          askUsd: quote.ask,
          markUsd: quote.mid,
          markIv: quote.markIv,
          underlyingPriceUsd: snapshot.stats.forwardPriceUsd ?? snapshot.stats.indexPriceUsd,
          feesTakerUsd: quote.estimatedFees?.taker ?? DEFAULT_FEES_TAKER_USD,
          bidSize: quote.bidSize,
          askSize: quote.askSize,
        });
      }
      return books;
    } finally {
      await release();
    }
  }

  async getMark(key: QuoteKey): Promise<number | null> {
    const books = await this.getBooks(key, [...VENUE_IDS]);
    const marks = books.map((b) => b.markUsd).filter((m): m is number => m != null);
    if (marks.length === 0) return null;
    return marks.reduce((sum, m) => sum + m, 0) / marks.length;
  }
}
