/** Pure math for options P&L computation. No side effects, no imports from stores. */

export interface Leg {
  id:        string;
  type:      "call" | "put";
  direction: "buy" | "sell";
  strike:    number;
  expiry:    string;
  quantity:  number;
  /** Entry price per contract in USD */
  entryPrice: number;
  /** Best venue for this leg */
  venue:     string;
  /** Greeks at entry */
  delta:     number | null;
  gamma:     number | null;
  theta:     number | null;
  vega:      number | null;
  iv:        number | null;
}

export interface PayoffPoint {
  underlyingPrice: number;
  pnl:             number;
}

export interface StrategyMetrics {
  maxProfit:    number | null;
  maxLoss:     number | null;
  breakevens:  number[];
  netDebit:    number;
  netDelta:    number | null;
  netGamma:    number | null;
  netTheta:    number | null;
  netVega:     number | null;
}

/** P&L of a single leg at expiry for a given underlying price. */
function legPnlAtExpiry(leg: Leg, underlyingPrice: number): number {
  const sign = leg.direction === "buy" ? 1 : -1;
  let intrinsicValue: number;

  if (leg.type === "call") {
    intrinsicValue = Math.max(0, underlyingPrice - leg.strike);
  } else {
    intrinsicValue = Math.max(0, leg.strike - underlyingPrice);
  }

  return sign * (intrinsicValue - leg.entryPrice) * leg.quantity;
}

/** Compute total strategy P&L across a range of underlying prices. */
export function computePayoff(legs: Leg[], spotPrice: number, numPoints = 200): PayoffPoint[] {
  if (legs.length === 0) return [];

  const strikes = legs.map((l) => l.strike);
  const minStrike = Math.min(...strikes);
  const maxStrike = Math.max(...strikes);

  // Range: ±30% around the strike range, centered on spot
  const rangeCenter = spotPrice;
  const rangeHalf = Math.max(
    (maxStrike - minStrike) * 1.5,
    spotPrice * 0.3,
  );
  const low = Math.max(0, rangeCenter - rangeHalf);
  const high = rangeCenter + rangeHalf;
  const step = (high - low) / numPoints;

  const points: PayoffPoint[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const price = low + i * step;
    let totalPnl = 0;
    for (const leg of legs) {
      totalPnl += legPnlAtExpiry(leg, price);
    }
    points.push({ underlyingPrice: price, pnl: totalPnl });
  }

  return points;
}

/** Find breakeven points (where P&L crosses zero). */
function findBreakevens(points: PayoffPoint[]): number[] {
  const breakevens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    if ((prev.pnl <= 0 && curr.pnl >= 0) || (prev.pnl >= 0 && curr.pnl <= 0)) {
      // Linear interpolation
      const ratio = Math.abs(prev.pnl) / (Math.abs(prev.pnl) + Math.abs(curr.pnl));
      const be = prev.underlyingPrice + ratio * (curr.underlyingPrice - prev.underlyingPrice);
      breakevens.push(Math.round(be));
    }
  }
  return breakevens;
}

/** Compute strategy-level metrics from legs. */
export function computeMetrics(legs: Leg[], spotPrice: number): StrategyMetrics {
  const payoff = computePayoff(legs, spotPrice, 500);

  const pnls = payoff.map((p) => p.pnl);
  const maxPnl = Math.max(...pnls);
  const minPnl = Math.min(...pnls);

  // Check if profit/loss is unbounded by comparing edge values.
  // If P&L keeps growing/falling at the extremes, it's unlimited.
  const firstPnl = pnls[0] ?? 0;
  const lastPnl = pnls[pnls.length - 1] ?? 0;
  const edgeMax = Math.max(firstPnl, lastPnl);
  const edgeMin = Math.min(firstPnl, lastPnl);
  const profitUnbounded = Math.abs(edgeMax - maxPnl) < 1;
  const lossUnbounded = Math.abs(edgeMin - minPnl) < 1;
  const maxProfit = profitUnbounded ? null : maxPnl;
  const maxLoss = lossUnbounded ? null : minPnl;

  const netDebit = legs.reduce((sum, leg) => {
    const sign = leg.direction === "buy" ? -1 : 1;
    return sum + sign * leg.entryPrice * leg.quantity;
  }, 0);

  const sumGreek = (pick: (l: Leg) => number | null): number | null => {
    let total = 0;
    let hasAny = false;
    for (const leg of legs) {
      const val = pick(leg);
      if (val == null) continue;
      hasAny = true;
      const sign = leg.direction === "buy" ? 1 : -1;
      total += sign * val * leg.quantity;
    }
    return hasAny ? total : null;
  };

  return {
    maxProfit: maxProfit != null ? maxPnl : null,
    maxLoss: maxLoss != null ? minPnl : null,
    breakevens: findBreakevens(payoff),
    netDebit,
    netDelta: sumGreek((l) => l.delta),
    netGamma: sumGreek((l) => l.gamma),
    netTheta: sumGreek((l) => l.theta),
    netVega: sumGreek((l) => l.vega),
  };
}

/** Detect common strategy names from leg configuration. */
export function detectStrategy(legs: Leg[]): string {
  if (legs.length === 0) return "Empty";
  if (legs.length === 1) {
    const l = legs[0]!;
    const side = l.direction === "buy" ? "Long" : "Short";
    return `${side} ${l.type === "call" ? "Call" : "Put"}`;
  }

  const sorted = [...legs].sort((a, b) => a.strike - b.strike);
  const types = sorted.map((l) => l.type);
  const strikes = sorted.map((l) => l.strike);
  const sameExpiry = new Set(sorted.map((l) => l.expiry)).size === 1;

  if (legs.length === 2 && sameExpiry) {
    const [a, b] = sorted;
    if (!a || !b) return "Custom";

    // Straddle: same strike, call + put, same direction
    if (a.strike === b.strike && a.type !== b.type && a.direction === b.direction) {
      return a.direction === "buy" ? "Long Straddle" : "Short Straddle";
    }

    // Strangle: different strikes, call + put, same direction
    if (a.strike !== b.strike && types.includes("call") && types.includes("put") && a.direction === b.direction) {
      return a.direction === "buy" ? "Long Strangle" : "Short Strangle";
    }

    // Vertical spreads: same type, different strikes, opposite directions
    if (a.type === b.type && a.direction !== b.direction) {
      const buyLeg = a.direction === "buy" ? a : b;
      const sellLeg = a.direction === "buy" ? b : a;
      if (a.type === "call") {
        return buyLeg.strike < sellLeg.strike ? "Bull Call Spread" : "Bear Call Spread";
      }
      return buyLeg.strike > sellLeg.strike ? "Bear Put Spread" : "Bull Put Spread";
    }
  }

  // Butterfly: 3 legs (buy 1 / sell 2× / buy 1) — detected before 4-leg
  if (legs.length === 3 && sameExpiry) {
    const uniqueStrikes = [...new Set(strikes)];
    if (uniqueStrikes.length === 3 && types.every((t) => t === types[0])) {
      const midLeg = sorted[1];
      if (midLeg && midLeg.quantity === 2 && midLeg.direction !== sorted[0]!.direction) {
        return types[0] === "call" ? "Call Butterfly" : "Put Butterfly";
      }
    }
  }

  if (legs.length === 4 && sameExpiry) {
    const calls = sorted.filter((l) => l.type === "call");
    const puts = sorted.filter((l) => l.type === "put");

    // Iron condor: buy put, sell put, sell call, buy call
    if (calls.length === 2 && puts.length === 2) {
      const buyPuts = puts.filter((l) => l.direction === "buy");
      const sellPuts = puts.filter((l) => l.direction === "sell");
      const buyCalls = calls.filter((l) => l.direction === "buy");
      const sellCalls = calls.filter((l) => l.direction === "sell");

      if (buyPuts.length === 1 && sellPuts.length === 1 && buyCalls.length === 1 && sellCalls.length === 1) {
        return "Iron Condor";
      }
    }
  }

  return `Custom (${legs.length} legs)`;
}
