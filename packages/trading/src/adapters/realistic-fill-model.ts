import type {
  FillModel,
  FillModelInput,
  FillModelQuote,
} from '../gateways/fill-model.js';
import type { QuoteBook, QuoteBookLevel } from '../gateways/quote-provider.js';

export interface RealisticFillModelOptions {
  // Multiplier on half-spread when sizing the L1-overflow penalty. Higher =
  // more punishing for size > L1. 1.0 means a 1× top-size order pays a full
  // half-spread on top of L1. Tuned conservatively for crypto options books.
  spreadPenaltyK?: number;
  // Hard cap on slippage as a fraction of the L1 reference price. Prevents
  // pathological numbers when half-spread is huge or the book is one-sided.
  maxSlippagePct?: number;
  // When the venue does not surface bidSize/askSize (Deribit/OKX), assume this
  // many contracts of L1 depth before applying the spread penalty. Picked to
  // be conservative — favors the user with a small free L1, then degrades.
  assumedTopSizeWhenMissing?: number;
}

const DEFAULT_OPTIONS: Required<RealisticFillModelOptions> = {
  spreadPenaltyK: 1.0,
  maxSlippagePct: 0.05,
  assumedTopSizeWhenMissing: 1,
};

// Three-tier degradation against a single venue's book:
//   1. quantity ≤ topSize  → fill at L1, zero slippage.
//   2. L2 ladder available → VWAP-walk down/up the book.
//   3. otherwise            → spread-multiplier penalty proportional to
//                             (qty / topSize), capped at maxSlippagePct.
// Returns a partial fill when the available depth (ladder cum-size) is less
// than the requested quantity.
export class RealisticFillModel implements FillModel {
  private readonly opts: Required<RealisticFillModelOptions>;

  constructor(options: RealisticFillModelOptions = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
  }

  quote(input: FillModelInput): FillModelQuote {
    const { side, requestedQuantity, book } = input;
    const reference = side === 'buy' ? book.askUsd : book.bidUsd;
    if (reference == null || reference <= 0) {
      return { priceUsd: 0, filledQuantity: 0, slippageUsd: 0, partial: true };
    }

    const topSize = this.resolveTopSize(side, book);
    if (requestedQuantity <= topSize) {
      return {
        priceUsd: reference,
        filledQuantity: requestedQuantity,
        slippageUsd: 0,
        partial: false,
      };
    }

    const ladder = side === 'buy' ? book.askLevels : book.bidLevels;
    if (ladder && ladder.length > 0) {
      return this.walkLadder(side, requestedQuantity, ladder, reference);
    }

    return this.spreadPenalty(side, requestedQuantity, book, reference, topSize);
  }

  private resolveTopSize(side: 'buy' | 'sell', book: QuoteBook): number {
    const raw = side === 'buy' ? book.askSize : book.bidSize;
    if (raw != null && raw > 0) return raw;
    return this.opts.assumedTopSizeWhenMissing;
  }

  private walkLadder(
    side: 'buy' | 'sell',
    requestedQuantity: number,
    ladder: QuoteBookLevel[],
    reference: number,
  ): FillModelQuote {
    const sorted = [...ladder].sort((a, b) =>
      side === 'buy' ? a.priceUsd - b.priceUsd : b.priceUsd - a.priceUsd,
    );
    let remaining = requestedQuantity;
    let notional = 0;
    let filled = 0;
    for (const level of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, level.size);
      notional += take * level.priceUsd;
      filled += take;
      remaining -= take;
    }
    if (filled <= 0) {
      return { priceUsd: 0, filledQuantity: 0, slippageUsd: 0, partial: true };
    }
    const vwap = notional / filled;
    const slippage = side === 'buy' ? vwap - reference : reference - vwap;
    return {
      priceUsd: vwap,
      filledQuantity: filled,
      slippageUsd: Math.max(0, slippage),
      partial: filled < requestedQuantity,
    };
  }

  private spreadPenalty(
    side: 'buy' | 'sell',
    requestedQuantity: number,
    book: QuoteBook,
    reference: number,
    topSize: number,
  ): FillModelQuote {
    // Half-spread is the canonical "cost to cross"; size > L1 pays a multiple
    // of it scaled by how much the order overshoots top depth.
    const halfSpread =
      book.bidUsd != null && book.askUsd != null && book.askUsd > book.bidUsd
        ? (book.askUsd - book.bidUsd) / 2
        : reference * 0.005;
    const overshoot = Math.max(0, requestedQuantity - topSize) / topSize;
    const rawPenalty = this.opts.spreadPenaltyK * halfSpread * (1 + overshoot);
    const cap = reference * this.opts.maxSlippagePct;
    const slippage = Math.min(rawPenalty, cap);
    const priceUsd = side === 'buy' ? reference + slippage : Math.max(0, reference - slippage);
    return {
      priceUsd,
      filledQuantity: requestedQuantity,
      slippageUsd: slippage,
      partial: false,
    };
  }
}
