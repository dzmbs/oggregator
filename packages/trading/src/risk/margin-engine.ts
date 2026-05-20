import type { VenueId } from '@oggregator/core';
import type { UsdAmount } from '../book/money.js';
import type { OptionRight, OrderSide } from '../book/order.js';
import type { Position } from '../book/position.js';

export interface MarginEstimateLeg {
  index: number;
  side: OrderSide;
  optionRight: OptionRight;
  underlying: string;
  expiry: string;
  strike: number;
  quantity: number;
  preferredVenues: VenueId[] | null;
}

export interface MarginPerLegBreakdown {
  legIndex: number;
  requiredUsd: UsdAmount;
  reason: string;
}

export interface MarginEstimateInput {
  prospectiveLegs: MarginEstimateLeg[];
  existingPositions: Position[];
  equityUsd: UsdAmount;
  venueFilter: VenueId[];
}

export interface MarginEstimateResult {
  ok: boolean;
  // Total initial margin the engine projects for the *combined* portfolio
  // (existing positions + prospective legs). Caller compares against availableUsd.
  requiredUsd: UsdAmount;
  // Equity the engine treats as available margin, after subtracting the buffer.
  availableUsd: UsdAmount;
  bufferUsd: UsdAmount;
  reason: string | null;
  perLeg: MarginPerLegBreakdown[];
}

// Strategy interface for projecting initial-margin requirements before an
// order executes. Implementations:
//   - NoopMarginEngine: always passes (default; matches today's behavior).
//   - ApproximationMarginEngine: single-leg Reg-T-style approximation, gated
//     behind PAPER_MARGIN_MODE=approximation. NOT venue-accurate; explicitly
//     labeled as such until per-venue formulas land in references/.
export interface MarginEngine {
  estimate(input: MarginEstimateInput): Promise<MarginEstimateResult>;
}
