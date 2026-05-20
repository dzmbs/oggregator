import type { QuoteBook } from './quote-provider.js';

export interface FillModelInput {
  side: 'buy' | 'sell';
  requestedQuantity: number;
  book: QuoteBook;
}

export interface FillModelQuote {
  // Effective per-contract price after slippage. Always set when filledQuantity > 0.
  priceUsd: number;
  // Quantity actually fillable from this venue's book at this point in time.
  // May equal requestedQuantity (full fill) or be smaller (partial).
  filledQuantity: number;
  // Per-contract slippage vs the venue's L1 reference (ask for buy, bid for sell).
  // Positive when the model paid worse than L1; zero for OptimisticFillModel.
  slippageUsd: number;
  // True when filledQuantity < requestedQuantity.
  partial: boolean;
}

// Strategy interface: given a requested side+quantity against a single venue's
// quote book, return the price/qty/slippage the paper engine should use.
// The PaperFillEngine still picks which venue to route to; the FillModel only
// owns the depth/slippage semantics for that venue.
export interface FillModel {
  quote(input: FillModelInput): FillModelQuote;
}
