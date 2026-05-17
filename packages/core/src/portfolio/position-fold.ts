import type { PositionLeg, PositionLegInput } from '@oggregator/protocol';

import { solveIv } from '../feeds/thalex/bs-solver.js';
import type { MarkContext } from './types.js';

export interface FoldContext {
  // Current mark for the leg's strike/right/expiry. Used to back-solve
  // entryIv when the user/feed didn't supply one. May be null when no chain
  // snapshot is available yet — IV back-solve is then skipped.
  mark: MarkContext | null;
  // Wall-clock timestamp used as the entryTs for brand-new legs. Existing
  // legs keep their original entryTs through folds.
  nowMs: number;
  // Inject ID generation so tests can pin the new-leg id.
  generateLegId: () => string;
}

interface NaturalKey {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
  source: PositionLeg['source'];
}

export function naturalKeyOf(
  leg: Pick<PositionLeg, 'underlying' | 'expiry' | 'strike' | 'optionRight' | 'source'>,
): string {
  return `${leg.source}|${leg.underlying}|${leg.expiry}|${leg.strike}|${leg.optionRight}`;
}

export function findExistingForInput(
  legs: PositionLeg[],
  input: PositionLegInput,
): PositionLeg | null {
  const key: NaturalKey = {
    underlying: input.underlying,
    expiry: input.expiry,
    strike: input.strike,
    optionRight: input.optionRight,
    source: input.source,
  };
  return (
    legs.find(
      (l) =>
        l.underlying === key.underlying &&
        l.expiry === key.expiry &&
        l.strike === key.strike &&
        l.optionRight === key.optionRight &&
        l.source === key.source,
    ) ?? null
  );
}

// Back-solve entryIv from price + forward + T when the caller did not
// provide one. Bounded so an unreachable solver result doesn't quietly
// poison the leg's recorded IV.
function backSolveEntryIv(
  input: PositionLegInput,
  mark: MarkContext | null,
): { iv: number | null; isModel: boolean } {
  if (input.entryIv != null) return { iv: input.entryIv, isModel: false };
  if (mark == null) return { iv: null, isModel: false };
  if (mark.forwardPriceUsd == null || mark.yearsToExpiry == null) {
    return { iv: null, isModel: false };
  }
  if (!(mark.forwardPriceUsd > 0) || !(mark.yearsToExpiry > 0)) {
    return { iv: null, isModel: false };
  }
  const intrinsic =
    input.optionRight === 'call'
      ? Math.max(0, mark.forwardPriceUsd - input.strike)
      : Math.max(0, input.strike - mark.forwardPriceUsd);
  const upper = input.optionRight === 'call' ? mark.forwardPriceUsd : input.strike;
  if (input.entryPriceUsd <= intrinsic || input.entryPriceUsd >= upper) {
    return { iv: null, isModel: false };
  }
  const solved = solveIv({
    price: input.entryPriceUsd,
    forward: mark.forwardPriceUsd,
    strike: input.strike,
    tYears: mark.yearsToExpiry,
    right: input.optionRight,
    seed: mark.iv ?? null,
  });
  if (solved == null || !Number.isFinite(solved) || solved <= 0 || solved > 3) {
    return { iv: null, isModel: false };
  }
  return { iv: solved, isModel: true };
}

// Qty-weighted IV blend. Vega-weighting would be more correct in general
// but for sequential fills at the same strike/expiry vega is near-constant
// across the legs, so qty weighting is within sub-1% of vega-weighted and
// avoids dragging a pricing surface into a pure fold.
function blendIv(
  priorIv: number | null,
  priorQty: number,
  freshIv: number | null,
  freshQty: number,
): number | null {
  const a = priorIv != null ? priorIv : null;
  const b = freshIv != null ? freshIv : null;
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  const denom = priorQty + freshQty;
  if (denom <= 0) return null;
  return (a * priorQty + b * freshQty) / denom;
}

export function foldManualLeg(
  existing: PositionLeg | null,
  input: PositionLegInput,
  ctx: FoldContext,
): PositionLeg | null {
  // Brand-new leg.
  if (existing == null || existing.size === 0) {
    const { iv, isModel } = backSolveEntryIv(input, ctx.mark);
    const leg: PositionLeg = {
      legId: input.legId ?? ctx.generateLegId(),
      underlying: input.underlying,
      expiry: input.expiry,
      strike: input.strike,
      optionRight: input.optionRight,
      size: input.size,
      entryPriceUsd: input.entryPriceUsd,
      entryIv: iv,
      ...(isModel ? { entryIvIsModel: true } : {}),
      realizedPnlUsd: 0,
      entryTs: input.entryTs ?? ctx.nowMs,
      venueHint: input.venueHint,
      source: input.source,
    };
    return leg;
  }

  const priorSign = Math.sign(existing.size);
  const freshSign = Math.sign(input.size);
  const sameDirection = priorSign === freshSign;

  if (sameDirection) {
    const newSize = existing.size + input.size;
    const priorAbs = Math.abs(existing.size);
    const freshAbs = Math.abs(input.size);
    const newAbs = Math.abs(newSize);
    const newEntry =
      (existing.entryPriceUsd * priorAbs + input.entryPriceUsd * freshAbs) / newAbs;

    // Back-solve the fresh fill's IV when the caller didn't provide one so
    // the blend uses a real number on both sides whenever the mark context
    // is rich enough. Falls back to the existing null-handling in blendIv
    // when back-solve isn't possible.
    const freshBacksolved = backSolveEntryIv(input, ctx.mark);
    const resolvedFreshIv = input.entryIv ?? freshBacksolved.iv;
    const freshContributedModel = input.entryIv == null && freshBacksolved.isModel;
    const blendedIv = blendIv(existing.entryIv, priorAbs, resolvedFreshIv, freshAbs);

    // entryIvIsModel becomes sticky only when no explicit venue IV came in
    // on this fill. If the user provided an explicit entryIv, the blended
    // result is anchored to real data and the flag should clear.
    const nextIsModel =
      input.entryIv != null
        ? false
        : (existing.entryIvIsModel === true || freshContributedModel);

    const { entryIvIsModel: _drop, ...rest } = existing;
    return {
      ...rest,
      size: newSize,
      entryPriceUsd: newEntry,
      entryIv: blendedIv,
      ...(nextIsModel ? { entryIvIsModel: true as const } : {}),
    };
  }

  // Opposite direction — close some/all/flip.
  const closingQty = Math.min(Math.abs(existing.size), Math.abs(input.size));
  // Realized PnL per contract closed: long side gains when fresh price >
  // prior avg entry; short side gains when fresh price < prior avg entry.
  // priorSign captures that directly: +1 long, -1 short.
  const realizedDelta =
    priorSign * closingQty * (input.entryPriceUsd - existing.entryPriceUsd);
  const newSize = existing.size + input.size;

  if (newSize === 0) {
    return null;
  }

  // Partial close (same sign as prior, smaller magnitude) keeps the prior
  // avg entry. Anything else — including a sign flip whose residual is
  // smaller than the original size — opens a new position at the fresh
  // price.
  const flipped = Math.sign(newSize) !== priorSign;
  if (!flipped) {
    return {
      ...existing,
      size: newSize,
      entryPriceUsd: existing.entryPriceUsd,
      realizedPnlUsd: existing.realizedPnlUsd + realizedDelta,
    };
  }

  // Sign flip: prior position fully closed, residual sits at the new fill's
  // price as the new avg entry, and the entry time resets to the new fill
  // so the reopened leg doesn't appear older than it is.
  const { iv, isModel } = backSolveEntryIv(input, ctx.mark);
  const resolvedIv = input.entryIv ?? iv;
  const flipIsModel = input.entryIv == null && isModel;
  const { entryIvIsModel: _drop, ...rest } = existing;
  return {
    ...rest,
    size: newSize,
    entryPriceUsd: input.entryPriceUsd,
    entryIv: resolvedIv,
    entryTs: input.entryTs ?? ctx.nowMs,
    ...(flipIsModel ? { entryIvIsModel: true as const } : {}),
    realizedPnlUsd: existing.realizedPnlUsd + realizedDelta,
  };
}
