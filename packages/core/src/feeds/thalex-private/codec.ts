import type { PositionLeg } from '@oggregator/protocol';

import { naturalKeyOf } from '../../portfolio/position-fold.js';
import { THALEX_OPTION_SYMBOL_RE } from '../thalex/types.js';
import type { ThalexPortfolioEntry } from './types.js';

const MONTH_TO_NUM: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

function parseInstrumentName(name: string): {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
} | null {
  const match = THALEX_OPTION_SYMBOL_RE.exec(name);
  if (match == null) return null;
  const [, underlying, dateRaw, strikeRaw, rightRaw] = match;
  if (underlying == null || dateRaw == null || strikeRaw == null || rightRaw == null) return null;

  const dMatch = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(dateRaw);
  if (dMatch == null) return null;
  const [, ddRaw, monRaw, yyRaw] = dMatch;
  const mon = MONTH_TO_NUM[monRaw!];
  if (mon == null) return null;
  const dd = ddRaw!.padStart(2, '0');
  const expiry = `20${yyRaw}-${mon}-${dd}`;

  const strike = Number(strikeRaw);
  if (!Number.isFinite(strike) || strike <= 0) return null;

  const optionRight = rightRaw === 'C' ? 'call' : 'put';
  return { underlying, expiry, strike, optionRight };
}

export function thalexPortfolioEntryToLeg(
  entry: ThalexPortfolioEntry,
  nowMs: number = Date.now(),
): PositionLeg | null {
  const parsed = parseInstrumentName(entry.instrument_name);
  if (parsed == null) return null;
  const size = entry.position;
  if (!Number.isFinite(size) || size === 0) return null;
  const avg = entry.average_price;
  if (avg == null || !Number.isFinite(avg) || avg <= 0) return null;

  const legId = naturalKeyOf({
    underlying: parsed.underlying,
    expiry: parsed.expiry,
    strike: parsed.strike,
    optionRight: parsed.optionRight,
    source: 'thalex',
  });
  return {
    legId,
    underlying: parsed.underlying,
    expiry: parsed.expiry,
    strike: parsed.strike,
    optionRight: parsed.optionRight,
    size,
    entryPriceUsd: avg,
    entryIv: null,
    realizedPnlUsd: 0,
    entryTs: nowMs,
    venueHint: 'thalex',
    source: 'thalex',
  };
}

export function thalexPortfolioToLegs(
  entries: ThalexPortfolioEntry[],
  nowMs: number = Date.now(),
): PositionLeg[] {
  const legs: PositionLeg[] = [];
  for (const entry of entries) {
    const leg = thalexPortfolioEntryToLeg(entry, nowMs);
    if (leg != null) legs.push(leg);
  }
  return legs;
}
