import type { PositionLeg, StrategyGroup, StrategyKind } from '@oggregator/protocol';

const SIZE_EPS = 1e-6;

function groupByUnderlyingExpiry(legs: PositionLeg[]): Map<string, PositionLeg[]> {
  const acc = new Map<string, PositionLeg[]>();
  for (const leg of legs) {
    const key = `${leg.underlying}|${leg.expiry}`;
    const bucket = acc.get(key) ?? [];
    bucket.push(leg);
    acc.set(key, bucket);
  }
  return acc;
}

function netEntryPremium(legs: PositionLeg[]): number {
  return legs.reduce((acc, l) => acc + l.entryPriceUsd * l.size, 0);
}

function debitOrCredit(netPremium: number): 'debit' | 'credit' | 'flat' {
  if (netPremium > SIZE_EPS) return 'debit';
  if (netPremium < -SIZE_EPS) return 'credit';
  return 'flat';
}

function groupIdOf(prefix: StrategyKind, legs: PositionLeg[]): string {
  const ids = legs
    .map((l) => l.legId)
    .sort()
    .join('+');
  return `${prefix}:${ids}`;
}

interface PairTrial {
  kind: StrategyKind;
  legs: PositionLeg[];
}

// Try to pair two legs into a recognized 2-leg structure. Returns null when
// the pair is not a structure we model.
function classifyPair(a: PositionLeg, b: PositionLeg): PairTrial | null {
  if (Math.abs(Math.abs(a.size) - Math.abs(b.size)) > SIZE_EPS) return null;
  const sameRight = a.optionRight === b.optionRight;
  const sameStrike = a.strike === b.strike;
  const oppositeSign = Math.sign(a.size) !== Math.sign(b.size);
  const sameSign = Math.sign(a.size) === Math.sign(b.size);

  if (sameRight && oppositeSign && !sameStrike) {
    return { kind: a.optionRight === 'call' ? 'call_spread' : 'put_spread', legs: [a, b] };
  }
  if (!sameRight && sameSign && sameStrike) {
    return { kind: 'straddle', legs: [a, b] };
  }
  if (!sameRight && sameSign && !sameStrike) {
    return { kind: 'strangle', legs: [a, b] };
  }
  return null;
}

function verticalPayoff(legs: PositionLeg[]): {
  maxProfitUsd: number;
  maxLossUsd: number;
  breakEvenSpotsUsd: number[];
} | null {
  if (legs.length !== 2) return null;
  const [a, b] = legs;
  if (a == null || b == null) return null;
  const long = a.size > 0 ? a : b;
  const short = a.size > 0 ? b : a;
  if (long.size <= 0 || short.size >= 0) return null;
  const qty = Math.abs(long.size);
  const strikeWidth = Math.abs(long.strike - short.strike);
  const net = long.entryPriceUsd * long.size + short.entryPriceUsd * short.size;
  // net > 0 = debit (we paid). net < 0 = credit (we collected).
  const maxStructurePayout = strikeWidth * qty;
  if (net >= 0) {
    // Debit vertical
    const debit = net;
    const maxProfitUsd = maxStructurePayout - debit;
    const maxLossUsd = debit;
    // BE spot: for long call spread S = lowK + debit/qty;
    //          for long put spread  S = highK - debit/qty.
    const beSpot =
      long.optionRight === 'call'
        ? Math.min(long.strike, short.strike) + debit / qty
        : Math.max(long.strike, short.strike) - debit / qty;
    return { maxProfitUsd, maxLossUsd, breakEvenSpotsUsd: [beSpot] };
  }
  const credit = -net;
  const maxProfitUsd = credit;
  const maxLossUsd = maxStructurePayout - credit;
  const beSpot =
    long.optionRight === 'call'
      ? Math.min(long.strike, short.strike) + credit / qty
      : Math.max(long.strike, short.strike) - credit / qty;
  return { maxProfitUsd, maxLossUsd, breakEvenSpotsUsd: [beSpot] };
}

function straddleStranglePayoff(legs: PositionLeg[]): {
  maxProfitUsd: number | null;
  maxLossUsd: number | null;
  breakEvenSpotsUsd: number[];
} | null {
  if (legs.length !== 2) return null;
  const [a, b] = legs;
  if (a == null || b == null) return null;
  const sameSign = Math.sign(a.size) === Math.sign(b.size);
  if (!sameSign) return null;
  const isLong = a.size > 0;
  const qty = Math.abs(a.size);
  const call = a.optionRight === 'call' ? a : b;
  const put = a.optionRight === 'put' ? a : b;
  if (call.optionRight !== 'call' || put.optionRight !== 'put') return null;
  const netDebit = (call.entryPriceUsd + put.entryPriceUsd) * Math.abs(a.size);
  if (isLong) {
    // Long straddle/strangle: max loss = debit paid; max profit unbounded
    // on the upside and capped at strike-floor on the downside, so report
    // unbounded.
    const breakEvens = [
      put.strike - netDebit / qty,
      call.strike + netDebit / qty,
    ];
    return { maxProfitUsd: null, maxLossUsd: netDebit, breakEvenSpotsUsd: breakEvens };
  }
  // Short straddle/strangle: max profit = credit, max loss unbounded.
  const breakEvens = [
    put.strike - netDebit / qty,
    call.strike + netDebit / qty,
  ];
  return { maxProfitUsd: netDebit, maxLossUsd: null, breakEvenSpotsUsd: breakEvens };
}

function buildGroup(
  kind: StrategyKind,
  legs: PositionLeg[],
): StrategyGroup {
  const first = legs[0]!;
  const net = netEntryPremium(legs);
  const base = {
    groupId: groupIdOf(kind, legs),
    kind,
    underlying: first.underlying,
    expiry: first.expiry,
    legIds: legs.map((l) => l.legId),
    netEntryPremiumUsd: net,
    debitOrCredit: debitOrCredit(net),
  } satisfies Pick<
    StrategyGroup,
    'groupId' | 'kind' | 'underlying' | 'expiry' | 'legIds' | 'netEntryPremiumUsd' | 'debitOrCredit'
  >;

  if (kind === 'call_spread' || kind === 'put_spread') {
    const payoff = verticalPayoff(legs);
    return {
      ...base,
      maxProfitUsd: payoff?.maxProfitUsd ?? null,
      maxLossUsd: payoff?.maxLossUsd ?? null,
      breakEvenSpotsUsd: payoff?.breakEvenSpotsUsd ?? [],
    };
  }
  if (kind === 'straddle' || kind === 'strangle') {
    const payoff = straddleStranglePayoff(legs);
    return {
      ...base,
      maxProfitUsd: payoff?.maxProfitUsd ?? null,
      maxLossUsd: payoff?.maxLossUsd ?? null,
      breakEvenSpotsUsd: payoff?.breakEvenSpotsUsd ?? [],
    };
  }
  return {
    ...base,
    maxProfitUsd: null,
    maxLossUsd: null,
    breakEvenSpotsUsd: [],
  };
}

export function detectStrategyGroups(legs: PositionLeg[]): StrategyGroup[] {
  const result: StrategyGroup[] = [];
  for (const bucket of groupByUnderlyingExpiry(legs).values()) {
    const used = new Set<string>();
    // Greedy 2-leg pairing pass. Order by strike+right so deterministic.
    const sorted = [...bucket].sort((a, b) => {
      if (a.strike !== b.strike) return a.strike - b.strike;
      if (a.optionRight !== b.optionRight) return a.optionRight < b.optionRight ? -1 : 1;
      if (a.legId === b.legId) return 0;
      return a.legId < b.legId ? -1 : 1;
    });
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i]!;
      if (used.has(a.legId)) continue;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const b = sorted[j]!;
        if (used.has(b.legId)) continue;
        const trial = classifyPair(a, b);
        if (trial == null) continue;
        result.push(buildGroup(trial.kind, trial.legs));
        used.add(a.legId);
        used.add(b.legId);
        break;
      }
    }
    for (const leg of bucket) {
      if (used.has(leg.legId)) continue;
      result.push(buildGroup('naked', [leg]));
    }
  }
  return result;
}
