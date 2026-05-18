import type { VenueId } from '@oggregator/core';

export interface QuoteBookLevel {
  priceUsd: number;
  size: number;
}

export interface QuoteBook {
  venue: VenueId;
  bidUsd: number | null;
  askUsd: number | null;
  markUsd: number | null;
  /** Mark IV at quote time, when the venue publishes one. */
  markIv: number | null;
  underlyingPriceUsd: number | null;
  /** Absolute USD taker fee per contract (not a rate). */
  feesTakerUsd: number;
  // Top-of-book sizes in contracts. Null when the venue feed does not surface
  // L1 depth (e.g. Deribit/OKX option tickers do not include sizes).
  bidSize: number | null;
  askSize: number | null;
  // Optional L2 ladder. Reserved for venues that publish depth beyond L1; the
  // realistic fill model walks this when present, falls back to spread penalty
  // otherwise. Empty/undefined for L1-only venues.
  bidLevels?: QuoteBookLevel[];
  askLevels?: QuoteBookLevel[];
}

export interface QuoteKey {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
}

export interface QuoteProvider {
  /**
   * Return the best quotes across the given venues for the option.
   * Missing venues are simply absent from the returned array.
   */
  getBooks(key: QuoteKey, venues: VenueId[]): Promise<QuoteBook[]>;

  /** Current mark price in USD, best-effort across all venues. */
  getMark(key: QuoteKey): Promise<number | null>;
}
