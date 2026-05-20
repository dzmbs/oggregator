import type { VenueQuote } from '@shared/enriched';
import { impliedVolNewtonRaphson, type OptionRight } from './blackScholes';

export interface IvInferenceContext {
  spot: number;
  strike: number;
  T: number;
  r: number;
  right: OptionRight;
}

// Venues differ in what IV they publish. Thalex sends only markIv. Coincall
// and some others publish bid/ask prices but no matching bid/ask IV. Rather
// than dropping those venues from cross-venue routing (a real aggregator
// loss — Thalex liquidity is meaningful), we invert Black-Scholes on the
// price the venue does send to recover the IV it implicitly quotes.
//
// Pure function — returns a new VenueQuote with null IV fields patched where
// possible. Leaves the quote untouched if the price itself is null or zero
// (zero prices mean "no market", not "free").
export function inferMissingIv(quote: VenueQuote, ctx: IvInferenceContext): VenueQuote {
  const patched: VenueQuote = { ...quote };

  if (patched.bidIv == null && isValidPrice(quote.bid)) {
    patched.bidIv = impliedVolNewtonRaphson({
      marketPrice: quote.bid,
      spot: ctx.spot,
      strike: ctx.strike,
      T: ctx.T,
      r: ctx.r,
      right: ctx.right,
    });
  }

  if (patched.askIv == null && isValidPrice(quote.ask)) {
    patched.askIv = impliedVolNewtonRaphson({
      marketPrice: quote.ask,
      spot: ctx.spot,
      strike: ctx.strike,
      T: ctx.T,
      r: ctx.r,
      right: ctx.right,
    });
  }

  if (patched.markIv == null && isValidPrice(quote.mid)) {
    patched.markIv = impliedVolNewtonRaphson({
      marketPrice: quote.mid,
      spot: ctx.spot,
      strike: ctx.strike,
      T: ctx.T,
      r: ctx.r,
      right: ctx.right,
    });
  }

  return patched;
}

function isValidPrice(p: number | null): p is number {
  return p != null && p > 0 && Number.isFinite(p);
}
