import type { PositionLeg } from '@oggregator/protocol';

import { naturalKeyOf } from '../../portfolio/position-fold.js';
import type { DerivePosition } from './types.js';

function parseInstrumentName(name: string): {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
} | null {
  const parts = name.split('-');
  if (parts.length !== 4) return null;
  const [underlying, dateRaw, strikeRaw, rightRaw] = parts;
  if (!underlying || !dateRaw || !strikeRaw || !rightRaw) return null;
  if (dateRaw.length !== 8) return null;
  const yy = dateRaw.slice(0, 4);
  const mm = dateRaw.slice(4, 6);
  const dd = dateRaw.slice(6, 8);
  const expiry = `${yy}-${mm}-${dd}`;
  const strike = Number(strikeRaw);
  if (!Number.isFinite(strike) || strike <= 0) return null;
  const optionRight = rightRaw.toUpperCase() === 'C' ? 'call' : rightRaw.toUpperCase() === 'P' ? 'put' : null;
  if (optionRight == null) return null;
  return { underlying, expiry, strike, optionRight };
}

export function derivePositionToLeg(pos: DerivePosition): PositionLeg | null {
  if (pos.instrument_type !== 'option') return null;
  const parsed = parseInstrumentName(pos.instrument_name);
  if (parsed == null) return null;
  const size = Number(pos.amount);
  if (!Number.isFinite(size) || size === 0) return null;
  const entryPriceUsd = Number(pos.average_price);
  if (!Number.isFinite(entryPriceUsd) || entryPriceUsd <= 0) return null;

  const legId = naturalKeyOf({
    underlying: parsed.underlying,
    expiry: parsed.expiry,
    strike: parsed.strike,
    optionRight: parsed.optionRight,
    source: 'derive',
  });
  return {
    legId,
    underlying: parsed.underlying,
    expiry: parsed.expiry,
    strike: parsed.strike,
    optionRight: parsed.optionRight,
    size,
    entryPriceUsd,
    entryIv: null,
    realizedPnlUsd: 0,
    entryTs: pos.creation_timestamp,
    venueHint: 'derive',
    source: 'derive',
  };
}

export function derivePositionsToLegs(positions: DerivePosition[]): PositionLeg[] {
  const legs: PositionLeg[] = [];
  for (const pos of positions) {
    const leg = derivePositionToLeg(pos);
    if (leg != null) legs.push(leg);
  }
  return legs;
}
