import type { FillModel, FillModelInput, FillModelQuote } from '../gateways/fill-model.js';

// Today's behavior: take L1 at the requested size with no slippage and no
// partial-fill semantics. Kept available for tests and for users who want a
// frictionless backtest baseline.
export class OptimisticFillModel implements FillModel {
  quote(input: FillModelInput): FillModelQuote {
    const { side, requestedQuantity, book } = input;
    const reference = side === 'buy' ? book.askUsd : book.bidUsd;
    if (reference == null) {
      return { priceUsd: 0, filledQuantity: 0, slippageUsd: 0, partial: true };
    }
    return {
      priceUsd: reference,
      filledQuantity: requestedQuantity,
      slippageUsd: 0,
      partial: false,
    };
  }
}
