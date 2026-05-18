import { describe, expect, it } from 'vitest';

import type { PositionLegInput } from '@oggregator/protocol';

import { foldManualLeg, type FoldContext } from './position-fold.js';
import type { MarkContext, PositionLeg } from './types.js';

const T_YEARS = 0.25;
const FORWARD = 82_000;

function baseInput(partial: Partial<PositionLegInput> = {}): PositionLegInput {
  return {
    underlying: 'BTC',
    expiry: '2026-06-27',
    strike: 80_000,
    optionRight: 'put',
    size: 1,
    entryPriceUsd: 3_835,
    entryIv: 0.39,
    venueHint: null,
    source: 'manual',
    ...partial,
  };
}

function baseLeg(partial: Partial<PositionLeg> = {}): PositionLeg {
  return {
    legId: 'leg-existing',
    underlying: 'BTC',
    expiry: '2026-06-27',
    strike: 80_000,
    optionRight: 'put',
    size: 1,
    entryPriceUsd: 4_000,
    entryIv: 0.4,
    entryTs: 1_700_000_000_000,
    venueHint: null,
    source: 'manual',
    realizedPnlUsd: 0,
    ...partial,
  };
}

function baseMark(partial: Partial<MarkContext> = {}): MarkContext {
  return {
    underlyingPriceUsd: FORWARD,
    forwardPriceUsd: FORWARD,
    markPriceUsd: 3_700,
    iv: 0.38,
    delta: -0.3,
    gamma: 0,
    vega: 0,
    theta: 0,
    yearsToExpiry: T_YEARS,
    ...partial,
  };
}

const ctx = (mark: MarkContext | null = baseMark(), nowMs = 1_700_000_010_000): FoldContext => ({
  mark,
  nowMs,
  generateLegId: () => 'leg-new',
});

describe('foldManualLeg — new leg', () => {
  it('creates a fresh leg when no existing match', () => {
    const next = foldManualLeg(null, baseInput(), ctx());
    expect(next).not.toBeNull();
    expect(next?.legId).toBe('leg-new');
    expect(next?.size).toBe(1);
    expect(next?.entryPriceUsd).toBe(3_835);
    expect(next?.entryIv).toBe(0.39);
    expect(next?.realizedPnlUsd).toBe(0);
  });

  it('back-solves entryIv from current mark when input.entryIv is null', () => {
    const input = baseInput({ entryIv: null, entryPriceUsd: 3_700 });
    const next = foldManualLeg(null, input, ctx());
    expect(next?.entryIv).not.toBeNull();
    // Solver should land on a positive, finite IV in the crypto vol band.
    expect(next?.entryIv).toBeGreaterThan(0.05);
    expect(next?.entryIv).toBeLessThan(2);
    expect(next?.entryIvIsModel).toBe(true);
  });

  it('leaves entryIv null when mark context is unusable', () => {
    const input = baseInput({ entryIv: null });
    const next = foldManualLeg(null, input, ctx(null));
    expect(next?.entryIv).toBeNull();
    expect(next?.entryIvIsModel).toBeUndefined();
  });
});

describe('foldManualLeg — same direction (averaging in)', () => {
  it('vwap entry price and qty-weight entry IV when adding more', () => {
    const existing = baseLeg({ size: 2, entryPriceUsd: 4_000, entryIv: 0.4 });
    const input = baseInput({ size: 2, entryPriceUsd: 3_600, entryIv: 0.36 });
    const next = foldManualLeg(existing, input, ctx());
    expect(next?.legId).toBe('leg-existing');
    expect(next?.size).toBe(4);
    expect(next?.entryPriceUsd).toBeCloseTo(3_800, 6);
    expect(next?.entryIv).toBeCloseTo(0.38, 6);
    expect(next?.realizedPnlUsd).toBe(0);
  });

  it('keeps existing IV when the new fill has none and mark is unavailable', () => {
    // Without a mark context the fold can't back-solve the fresh fill's IV,
    // so the blend falls back to the prior IV alone.
    const existing = baseLeg({ size: 1, entryIv: 0.4 });
    const input = baseInput({ size: 1, entryPriceUsd: 3_600, entryIv: null });
    const next = foldManualLeg(existing, input, ctx(null));
    expect(next?.entryIv).toBeCloseTo(0.4, 6);
  });

  it('preserves the original entryTs on averaging', () => {
    const existing = baseLeg({ size: 1, entryTs: 1_700_000_000_000 });
    const input = baseInput({ size: 1 });
    const next = foldManualLeg(existing, input, ctx());
    expect(next?.entryTs).toBe(1_700_000_000_000);
  });
});

describe('foldManualLeg — partial close', () => {
  it('accumulates realized PnL on reducing fill and keeps prior avg entry', () => {
    // Long 2 @ 4000, sell 1 @ 4500 → realized +500, remaining long 1 @ 4000.
    const existing = baseLeg({ size: 2, entryPriceUsd: 4_000 });
    const input = baseInput({ size: -1, entryPriceUsd: 4_500 });
    const next = foldManualLeg(existing, input, ctx());
    expect(next?.size).toBe(1);
    expect(next?.entryPriceUsd).toBe(4_000);
    expect(next?.realizedPnlUsd).toBeCloseTo(500, 6);
  });

  it('returns null when reducing to zero (fully closed)', () => {
    const existing = baseLeg({ size: 1, entryPriceUsd: 4_000 });
    const input = baseInput({ size: -1, entryPriceUsd: 3_500 });
    const next = foldManualLeg(existing, input, ctx());
    expect(next).toBeNull();
  });

  it('flips with smaller residual: long 2 + sell 3 → short 1 at the new price', () => {
    const existing = baseLeg({ size: 2, entryPriceUsd: 4_000 });
    const input = baseInput({ size: -3, entryPriceUsd: 3_500 });
    const next = foldManualLeg(existing, input, ctx());
    expect(next?.size).toBe(-1);
    expect(next?.entryPriceUsd).toBe(3_500);
    // realized = -2 * (4000 - 3500) = -1000
    expect(next?.realizedPnlUsd).toBeCloseTo(-1_000, 6);
  });
});

describe('foldManualLeg — direction flip with larger residual', () => {
  it('uses the new fill as the avg entry and accumulates realized for the closed leg', () => {
    // Long 2 @ 4000, sell 5 @ 4500 → realized +1000, residual short 3 @ 4500.
    const existing = baseLeg({ size: 2, entryPriceUsd: 4_000 });
    const input = baseInput({ size: -5, entryPriceUsd: 4_500, entryIv: 0.35 });
    const next = foldManualLeg(existing, input, ctx());
    expect(next?.size).toBe(-3);
    expect(next?.entryPriceUsd).toBe(4_500);
    expect(next?.entryIv).toBe(0.35);
    expect(next?.realizedPnlUsd).toBeCloseTo(1_000, 6);
  });

  it('resets entryTs to the new fill on a sign flip', () => {
    const existing = baseLeg({ size: 2, entryPriceUsd: 4_000, entryTs: 1_700_000_000_000 });
    const fillTs = 1_700_000_500_000;
    const input = baseInput({ size: -5, entryPriceUsd: 4_500, entryTs: fillTs });
    const next = foldManualLeg(existing, input, ctx());
    expect(next?.entryTs).toBe(fillTs);
  });

  it('falls back to ctx.nowMs when the fill input does not supply entryTs', () => {
    const existing = baseLeg({ size: 2, entryPriceUsd: 4_000, entryTs: 1_700_000_000_000 });
    const input = baseInput({ size: -5, entryPriceUsd: 4_500 });
    const next = foldManualLeg(existing, input, ctx(baseMark(), 1_700_000_999_000));
    expect(next?.entryTs).toBe(1_700_000_999_000);
  });
});

describe('foldManualLeg — entryIvIsModel stickiness', () => {
  it('clears the model flag when the new fill supplies an explicit IV', () => {
    const existing = baseLeg({
      size: 1,
      entryPriceUsd: 4_000,
      entryIv: 0.4,
      entryIvIsModel: true,
    });
    const input = baseInput({ size: 1, entryPriceUsd: 3_600, entryIv: 0.36 });
    const next = foldManualLeg(existing, input, ctx());
    expect(next?.entryIvIsModel).toBeUndefined();
  });

  it('keeps the model flag when prior was model and new fill has no IV', () => {
    const existing = baseLeg({
      size: 1,
      entryPriceUsd: 4_000,
      entryIv: 0.4,
      entryIvIsModel: true,
    });
    const input = baseInput({ size: 1, entryPriceUsd: 3_600, entryIv: null });
    const next = foldManualLeg(existing, input, ctx());
    expect(next?.entryIvIsModel).toBe(true);
  });

  it('marks the merged leg as model when the new fill back-solves IV', () => {
    const existing = baseLeg({ size: 1, entryPriceUsd: 4_000, entryIv: 0.4 });
    const input = baseInput({ size: 1, entryPriceUsd: 3_700, entryIv: null });
    const next = foldManualLeg(existing, input, ctx());
    expect(next?.entryIvIsModel).toBe(true);
    // IV is blended: prior was 0.4, fresh was back-solved (positive number).
    expect(next?.entryIv).not.toBeNull();
    expect(next?.entryIv).toBeGreaterThan(0);
  });
});

describe('foldManualLeg — short legs', () => {
  it('averages two short fills as a credit position', () => {
    const existing = baseLeg({ size: -1, entryPriceUsd: 4_660, entryIv: 0.388 });
    const input = baseInput({ size: -0.31, entryPriceUsd: 5_000, entryIv: 0.4 });
    const next = foldManualLeg(existing, input, ctx());
    expect(next?.size).toBeCloseTo(-1.31, 6);
    expect(next?.entryPriceUsd).toBeCloseTo(
      (1 * 4_660 + 0.31 * 5_000) / 1.31,
      4,
    );
    expect(next?.realizedPnlUsd).toBe(0);
  });

  it('realizes pnl when buying back part of a short', () => {
    // Short 2 @ 4660, buy 1 @ 4200 → realized +460 (bought back cheaper).
    const existing = baseLeg({ size: -2, entryPriceUsd: 4_660 });
    const input = baseInput({ size: 1, entryPriceUsd: 4_200 });
    const next = foldManualLeg(existing, input, ctx());
    expect(next?.size).toBe(-1);
    expect(next?.realizedPnlUsd).toBeCloseTo(460, 6);
  });
});
