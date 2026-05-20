import type { VenueId } from '@oggregator/core';
import { newFillId, type Fill } from '../book/fill.js';
import type { Order, OrderLeg } from '../book/order.js';
import { NoLiquidityError } from '../book/errors.js';
import type { Clock } from '../gateways/clock.js';
import type { FillEngine } from '../gateways/fill-engine.js';
import type { FillModel } from '../gateways/fill-model.js';
import type { QuoteBook, QuoteProvider } from '../gateways/quote-provider.js';
import { OptimisticFillModel } from './optimistic-fill-model.js';

export class PaperFillEngine implements FillEngine {
  private readonly fillModel: FillModel;

  constructor(
    private readonly quotes: QuoteProvider,
    private readonly clock: Clock,
    fillModel?: FillModel,
  ) {
    this.fillModel = fillModel ?? new OptimisticFillModel();
  }

  async executeOrder(order: Order, venueFilter: VenueId[]): Promise<Fill[]> {
    const plans: Array<{
      leg: OrderLeg;
      venue: VenueId;
      priceUsd: number;
      filledQuantity: number;
      slippageUsd: number;
      partialFill: boolean;
      feesUsd: number;
      benchmarkBidUsd: number | null;
      benchmarkAskUsd: number | null;
      benchmarkMidUsd: number | null;
      iv: number | null;
      underlyingSpotUsd: number | null;
    }> = [];

    for (const leg of order.legs) {
      const venues = leg.preferredVenues ?? venueFilter;
      const books = await this.quotes.getBooks(
        {
          underlying: leg.underlying,
          expiry: leg.expiry,
          strike: leg.strike,
          optionRight: leg.optionRight,
        },
        venues,
      );

      const chosen = pickBestBook(books, leg.side);
      if (!chosen) {
        throw new NoLiquidityError(
          `No ${leg.side === 'buy' ? 'ask' : 'bid'} available for leg ${leg.index}`,
          leg.index,
        );
      }

      const quote = this.fillModel.quote({
        side: leg.side,
        requestedQuantity: leg.quantity,
        book: chosen.book,
      });
      if (quote.filledQuantity <= 0) {
        throw new NoLiquidityError(
          `Fill model returned zero size for leg ${leg.index}`,
          leg.index,
        );
      }

      const feesUsd = chosen.book.feesTakerUsd * quote.filledQuantity;

      plans.push({
        leg,
        venue: chosen.book.venue,
        priceUsd: quote.priceUsd,
        filledQuantity: quote.filledQuantity,
        slippageUsd: quote.slippageUsd,
        partialFill: quote.partial,
        feesUsd,
        benchmarkBidUsd: chosen.book.bidUsd,
        benchmarkAskUsd: chosen.book.askUsd,
        benchmarkMidUsd: chosen.book.markUsd,
        iv: chosen.book.markIv,
        underlyingSpotUsd: chosen.book.underlyingPriceUsd,
      });
    }

    const now = this.clock.now();
    return plans.map(
      (p): Fill => ({
        id: newFillId(),
        orderId: order.id,
        legIndex: p.leg.index,
        venue: p.venue,
        side: p.leg.side,
        optionRight: p.leg.optionRight,
        underlying: p.leg.underlying,
        expiry: p.leg.expiry,
        strike: p.leg.strike,
        quantity: p.filledQuantity,
        requestedQuantity: p.leg.quantity,
        priceUsd: p.priceUsd,
        iv: p.iv,
        feesUsd: p.feesUsd,
        slippageUsd: p.slippageUsd,
        partialFill: p.partialFill,
        benchmarkBidUsd: p.benchmarkBidUsd,
        benchmarkAskUsd: p.benchmarkAskUsd,
        benchmarkMidUsd: p.benchmarkMidUsd,
        underlyingSpotUsd: p.underlyingSpotUsd,
        source: 'paper',
        filledAt: now,
      }),
    );
  }
}

function pickBestBook(
  books: QuoteBook[],
  side: 'buy' | 'sell',
): { book: QuoteBook } | null {
  const priced = books.filter((b) => (side === 'buy' ? b.askUsd != null : b.bidUsd != null));
  if (priced.length === 0) return null;
  const sorted = [...priced].sort((a, b) => {
    const priceA = side === 'buy' ? a.askUsd! : -a.bidUsd!;
    const priceB = side === 'buy' ? b.askUsd! : -b.bidUsd!;
    return priceA - priceB;
  });
  return { book: sorted[0]! };
}
