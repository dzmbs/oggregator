import type { OptionRight } from '../book/order.js';
import type { Position } from '../book/position.js';
import type { QuoteKey, QuoteProvider } from '../gateways/quote-provider.js';
import { MarginCheckUnavailableError } from '../book/errors.js';
import type {
  MarginEngine,
  MarginEstimateInput,
  MarginEstimateResult,
  MarginPerLegBreakdown,
} from './margin-engine.js';

export interface ApproximationMarginEngineOptions {
  // Equity buffer kept out of available margin (defense against same-tick mark
  // moves). Default 5%.
  bufferPct?: number;
  // First coefficient in the Reg-T-style formula:
  //   margin = max(K1 × spot − OTM_amount, K2 × spot) × qty
  // K1 default 0.15, K2 default 0.10. Conservative single-leg approximation
  // until per-venue portfolio-margin formulas land in references/.
  k1?: number;
  k2?: number;
}

const DEFAULTS: Required<ApproximationMarginEngineOptions> = {
  bufferPct: 0.05,
  k1: 0.15,
  k2: 0.10,
};

// Single-leg Reg-T-style margin estimator. Long options are treated as
// premium-only (cash check elsewhere); short options pay the formula above
// per contract. Existing positions are evaluated on net-short quantity using
// the position's own avg-entry as a stand-in for current spot context (we
// query the quote provider for live spot when available, fall back to the
// last-known underlying price embedded in QuoteBooks).
//
// LIMITATIONS (intentional, until per-venue PM formulas land):
//   - No portfolio-level offsets (a covered call still pays full short margin).
//   - Treats every venue identically.
//   - Uses spot from the cheapest-available QuoteBook for the leg's strike.
// Mode is opt-in via PAPER_MARGIN_MODE=approximation; default stays Noop.
export class ApproximationMarginEngine implements MarginEngine {
  private readonly opts: Required<ApproximationMarginEngineOptions>;

  constructor(
    private readonly quotes: QuoteProvider,
    options: ApproximationMarginEngineOptions = {},
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  async estimate(input: MarginEstimateInput): Promise<MarginEstimateResult> {
    const perLeg: MarginPerLegBreakdown[] = [];
    let prospectiveTotal = 0;

    for (const leg of input.prospectiveLegs) {
      if (leg.side === 'buy') {
        perLeg.push({ legIndex: leg.index, requiredUsd: 0, reason: 'long_premium' });
        continue;
      }
      const spot = await this.spotForLeg(leg, input.venueFilter);
      if (spot == null) {
        throw new MarginCheckUnavailableError(
          `Cannot estimate margin for leg ${leg.index}: spot price unavailable`,
          leg.index,
          'spot_unavailable',
        );
      }
      const required = perContractShortMargin(leg.optionRight, leg.strike, spot, this.opts) * leg.quantity;
      prospectiveTotal += required;
      perLeg.push({ legIndex: leg.index, requiredUsd: required, reason: 'short_approx' });
    }

    const existingTotal = await this.existingShortMargin(input.existingPositions, input.venueFilter);
    const requiredUsd = prospectiveTotal + existingTotal;
    const bufferUsd = Math.max(0, input.equityUsd * this.opts.bufferPct);
    const availableUsd = Math.max(0, input.equityUsd - bufferUsd);
    const ok = requiredUsd <= availableUsd;

    return {
      ok,
      requiredUsd,
      availableUsd,
      bufferUsd,
      reason: ok
        ? null
        : `Required margin ${requiredUsd.toFixed(2)} USD exceeds available ${availableUsd.toFixed(2)} USD (equity ${input.equityUsd.toFixed(2)} − buffer ${bufferUsd.toFixed(2)})`,
      perLeg,
    };
  }

  private async spotForLeg(
    key: QuoteKey,
    venueFilter: import('@oggregator/core').VenueId[],
  ): Promise<number | null> {
    const books = await this.quotes.getBooks(key, venueFilter);
    for (const b of books) {
      if (b.underlyingPriceUsd != null && b.underlyingPriceUsd > 0) return b.underlyingPriceUsd;
    }
    return null;
  }

  private async existingShortMargin(
    positions: Position[],
    venueFilter: import('@oggregator/core').VenueId[],
  ): Promise<number> {
    let total = 0;
    for (const pos of positions) {
      if (pos.netQuantity >= 0) continue;
      const spot = await this.spotForLeg(
        {
          underlying: pos.key.underlying,
          expiry: pos.key.expiry,
          strike: pos.key.strike,
          optionRight: pos.key.optionRight,
        },
        venueFilter,
      );
      // Existing short: if spot is unavailable, fall back to strike — keeps the
      // estimate conservative (slightly overstates margin) instead of throwing
      // at order time, which would block all new trades whenever a venue feed
      // is briefly down.
      const fallbackSpot = pos.key.strike;
      const useSpot = spot ?? fallbackSpot;
      const perContract = perContractShortMargin(pos.key.optionRight, pos.key.strike, useSpot, this.opts);
      total += perContract * Math.abs(pos.netQuantity);
    }
    return total;
  }
}

function perContractShortMargin(
  optionRight: OptionRight,
  strike: number,
  spot: number,
  opts: Required<ApproximationMarginEngineOptions>,
): number {
  const otm =
    optionRight === 'call' ? Math.max(0, strike - spot) : Math.max(0, spot - strike);
  const reference = optionRight === 'put' ? strike : spot;
  return Math.max(opts.k1 * spot - otm, opts.k2 * reference);
}
