/** Pure math for options P&L computation. No side effects, no imports from stores. */

export interface Leg {
  id: string;
  type: 'call' | 'put';
  direction: 'buy' | 'sell';
  strike: number;
  expiry: string;
  quantity: number;
  /** Entry price per contract in USD */
  entryPrice: number;
  /** Best venue for this leg */
  venue: string;
  /** Greeks at entry */
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  iv: number | null;
}

export interface PayoffPoint {
  underlyingPrice: number;
  pnl: number;
}

export interface StrategyMetrics {
  maxProfit: number | null;
  maxLoss: number | null;
  breakevens: number[];
  netDebit: number;
  netDelta: number | null;
  netGamma: number | null;
  netTheta: number | null;
  netVega: number | null;
  /** Worst-case missing-leg count across the four greeks. 0 = fully reported. */
  greeksMissingLegs: number;
}

/** Total strategy P&L at expiry for a single underlying price. Used by V2 chart for zone classification. */
export function pnlAtPrice(legs: Leg[], underlyingPrice: number): number {
  let total = 0;
  for (const leg of legs) total += legPnlAtExpiry(leg, underlyingPrice);
  return total;
}

/** P&L of a single leg at expiry for a given underlying price. */
function legPnlAtExpiry(leg: Leg, underlyingPrice: number): number {
  const sign = leg.direction === 'buy' ? 1 : -1;
  let intrinsicValue: number;

  if (leg.type === 'call') {
    intrinsicValue = Math.max(0, underlyingPrice - leg.strike);
  } else {
    intrinsicValue = Math.max(0, leg.strike - underlyingPrice);
  }

  return sign * (intrinsicValue - leg.entryPrice) * leg.quantity;
}

/**
 * Half-width of the price grid used by computePayoff / computeScenarioPayoff.
 *
 * The grid must cover every theoretical break-even, otherwise findBreakevens
 * silently drops the ones that fall outside it and the V2 zone shading paints
 * a single (-∞, upperBE) region that probes positive in the actual profit
 * tail — turning the whole loss zone green. A long straddle at a near-the-
 * money strike with rich premium hits this case (BEs at strike ± Σpremium,
 * which can sit ~30% outside spot for long-DTE ATM contracts).
 *
 * Σ|entryPrice × qty| is an upper bound on how far any BE can be from the
 * nearest strike, so anchoring the half-width on (max strike-to-spot distance
 * + Σ premium × margin) guarantees both BEs land inside with room to spare.
 */
function computeRangeHalf(
  legs: Leg[],
  spotPrice: number,
  minStrike: number,
  maxStrike: number,
): number {
  const totalPremium = legs.reduce(
    (s, l) => s + Math.abs(l.entryPrice) * l.quantity,
    0,
  );
  const maxStrikeDistFromSpot = Math.max(
    Math.abs(maxStrike - spotPrice),
    Math.abs(minStrike - spotPrice),
  );
  return Math.max(
    (maxStrike - minStrike) * 1.5,
    spotPrice * 0.3,
    maxStrikeDistFromSpot + totalPremium * 1.5,
  );
}

/** Compute total strategy P&L across a range of underlying prices. */
export function computePayoff(legs: Leg[], spotPrice: number, numPoints = 200): PayoffPoint[] {
  if (legs.length === 0) return [];

  const strikes = legs.map((l) => l.strike);
  const minStrike = Math.min(...strikes);
  const maxStrike = Math.max(...strikes);

  const rangeCenter = spotPrice;
  const rangeHalf = computeRangeHalf(legs, spotPrice, minStrike, maxStrike);
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

  // Detect unbounded P&L by slope at the range edges: if the curve is still
  // changing at the boundary, extrapolating further keeps growing / falling.
  // Bounded strategies plateau before the edge so both slopes go to ~0.
  const n = pnls.length;
  const highSlope = (pnls[n - 1] ?? 0) - (pnls[n - 2] ?? 0);
  const lowSlope = (pnls[1] ?? 0) - (pnls[0] ?? 0);
  const FLAT_EPS = 1;
  const profitUnbounded = highSlope > FLAT_EPS || lowSlope < -FLAT_EPS;
  const lossUnbounded = highSlope < -FLAT_EPS || lowSlope > FLAT_EPS;
  const maxProfit = profitUnbounded ? null : maxPnl;
  const maxLoss = lossUnbounded ? null : minPnl;

  const netDebit = legs.reduce((sum, leg) => {
    const sign = leg.direction === 'buy' ? -1 : 1;
    return sum + sign * leg.entryPrice * leg.quantity;
  }, 0);

  const sumGreek = (
    pick: (l: Leg) => number | null,
  ): { value: number | null; missing: number } => {
    let total = 0;
    let reported = 0;
    let missing = 0;
    for (const leg of legs) {
      const val = pick(leg);
      if (val == null) {
        missing++;
        continue;
      }
      reported++;
      const sign = leg.direction === 'buy' ? 1 : -1;
      total += sign * val * leg.quantity;
    }
    return { value: reported > 0 ? total : null, missing };
  };

  const delta = sumGreek((l) => l.delta);
  const gamma = sumGreek((l) => l.gamma);
  const theta = sumGreek((l) => l.theta);
  const vega = sumGreek((l) => l.vega);
  const greeksMissingLegs = Math.max(delta.missing, gamma.missing, theta.missing, vega.missing);

  return {
    maxProfit,
    maxLoss,
    breakevens: findBreakevens(payoff),
    netDebit,
    netDelta: delta.value,
    netGamma: gamma.value,
    netTheta: theta.value,
    netVega: vega.value,
    greeksMissingLegs,
  };
}

/**
 * Compute P&L at a point in time before expiry using Black-Scholes approximation.
 * Uses leg IV + shift to estimate option value at the given DTE.
 */
function bsApprox(type: 'call' | 'put', S: number, K: number, iv: number, dte: number): number {
  if (dte <= 0) return type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
  const T = dte / 365;
  const sigma = iv;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const nd1 = 0.5 * (1 + erf(d1 / Math.SQRT2));
  const nd2 = 0.5 * (1 + erf(d2 / Math.SQRT2));
  if (type === 'call') return S * nd1 - K * nd2;
  return K * (1 - nd2) - S * (1 - nd1);
}

function erf(x: number): number {
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

/** Compute scenario P&L with IV shift and/or DTE shift. */
export function computeScenarioPayoff(
  legs: Leg[],
  spotPrice: number,
  ivShift: number,
  dteShift: number,
  baseDte: number,
  numPoints = 200,
): PayoffPoint[] {
  if (legs.length === 0) return [];
  const strikes = legs.map((l) => l.strike);
  const minStrike = Math.min(...strikes);
  const maxStrike = Math.max(...strikes);
  const rangeCenter = spotPrice;
  const rangeHalf = computeRangeHalf(legs, spotPrice, minStrike, maxStrike);
  const low = Math.max(0, rangeCenter - rangeHalf);
  const high = rangeCenter + rangeHalf;
  const step = (high - low) / numPoints;

  const targetDte = Math.max(0, baseDte + dteShift);

  const points: PayoffPoint[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const price = low + i * step;
    let totalPnl = 0;
    for (const leg of legs) {
      const sign = leg.direction === 'buy' ? 1 : -1;
      const iv = (leg.iv ?? 0.5) + ivShift;
      const optionVal = bsApprox(leg.type, price, leg.strike, Math.max(0.01, iv), targetDte);
      totalPnl += sign * (optionVal - leg.entryPrice) * leg.quantity;
    }
    points.push({ underlyingPrice: price, pnl: totalPnl });
  }
  return points;
}

/** Detect common strategy names from leg configuration. */
export function detectStrategy(legs: Leg[]): string {
  if (legs.length === 0) return 'Empty';
  if (legs.length === 1) {
    const l = legs[0]!;
    const side = l.direction === 'buy' ? 'Long' : 'Short';
    return `${side} ${l.type === 'call' ? 'Call' : 'Put'}`;
  }

  const sorted = [...legs].sort((a, b) => a.strike - b.strike);
  const types = sorted.map((l) => l.type);
  const strikes = sorted.map((l) => l.strike);
  const sameExpiry = new Set(sorted.map((l) => l.expiry)).size === 1;

  if (legs.length === 2 && sameExpiry) {
    const [a, b] = sorted;
    if (!a || !b) return 'Custom';

    // Straddle: same strike, call + put, same direction
    if (a.strike === b.strike && a.type !== b.type && a.direction === b.direction) {
      return a.direction === 'buy' ? 'Long Straddle' : 'Short Straddle';
    }

    // Strangle: different strikes, call + put, same direction
    if (
      a.strike !== b.strike &&
      types.includes('call') &&
      types.includes('put') &&
      a.direction === b.direction
    ) {
      return a.direction === 'buy' ? 'Long Strangle' : 'Short Strangle';
    }

    // Vertical spreads: same type, different strikes, opposite directions
    if (a.type === b.type && a.direction !== b.direction) {
      const buyLeg = a.direction === 'buy' ? a : b;
      const sellLeg = a.direction === 'buy' ? b : a;
      if (a.type === 'call') {
        return buyLeg.strike < sellLeg.strike ? 'Bull Call Spread' : 'Bear Call Spread';
      }
      return buyLeg.strike > sellLeg.strike ? 'Bear Put Spread' : 'Bull Put Spread';
    }
  }

  // Butterfly: 3 legs (buy 1 / sell 2× / buy 1) — detected before 4-leg
  if (legs.length === 3 && sameExpiry) {
    const uniqueStrikes = [...new Set(strikes)];
    if (uniqueStrikes.length === 3 && types.every((t) => t === types[0])) {
      const midLeg = sorted[1];
      if (midLeg && midLeg.quantity === 2 && midLeg.direction !== sorted[0]!.direction) {
        return types[0] === 'call' ? 'Call Butterfly' : 'Put Butterfly';
      }
    }
  }

  if (legs.length === 4 && sameExpiry) {
    const calls = sorted.filter((l) => l.type === 'call');
    const puts = sorted.filter((l) => l.type === 'put');

    if (calls.length === 2 && puts.length === 2) {
      const buyPuts = puts.filter((l) => l.direction === 'buy');
      const sellPuts = puts.filter((l) => l.direction === 'sell');
      const buyCalls = calls.filter((l) => l.direction === 'buy');
      const sellCalls = calls.filter((l) => l.direction === 'sell');

      if (
        buyPuts.length === 1 &&
        sellPuts.length === 1 &&
        buyCalls.length === 1 &&
        sellCalls.length === 1
      ) {
        const bp = buyPuts[0]!.strike;
        const sp = sellPuts[0]!.strike;
        const sc = sellCalls[0]!.strike;
        const bc = buyCalls[0]!.strike;

        // Iron Condor: shorts in middle, longs as wings, no strike overlap.
        // Layout: long put < short put < short call < long call.
        if (bp < sp && sp < sc && sc < bc) return 'Iron Condor';

        // Iron Butterfly: short straddle at the body, long strangle wings.
        // Layout: long put < short put == short call < long call.
        if (bp < sp && sp === sc && sc < bc) return 'Iron Butterfly';

        // Reverse Iron Condor: longs in middle, shorts as wings.
        if (sp < bp && bp < bc && bc < sc) return 'Reverse Iron Condor';

        // Reverse Iron Butterfly: long straddle body, short strangle wings.
        if (sp < bp && bp === bc && bc < sc) return 'Reverse Iron Butterfly';

        // Straddle Spread: long straddle at one strike, short straddle at the
        // other. Two unique strikes, both options at each strike share a
        // direction. Bullish if the long straddle is at the lower strike.
        if (bp === bc && sp === sc && bp !== sp) {
          return bp < sp ? 'Long Straddle Spread' : 'Short Straddle Spread';
        }
      }
    }
  }

  return `Custom (${legs.length} legs)`;
}
