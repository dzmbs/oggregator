import type { OptionRight } from '../types/common.js';

export interface CanonicalOption {
  base: string;
  quote: string;
  settle: string;
  expiry: string; // YYYY-MM-DD
  expiryCode: string; // YYMMDD
  strike: number;
  right: OptionRight;
}

/** Parse a CCXT unified option symbol into canonical parts */
export function parseOptionSymbol(symbol: string): CanonicalOption | null {
  // BTC/USD:BTC-250628-60000-C
  const match = symbol.match(/^(\w+)\/(\w+):(\w+)-(\d{6})-(\d+(?:\.\d+)?)-([CP])$/);
  if (!match) return null;

  const [, base, quote, settle, expiryCode, strikeStr, rightChar] = match as RegExpMatchArray;
  const yy = expiryCode!.slice(0, 2);
  const mm = expiryCode!.slice(2, 4);
  const dd = expiryCode!.slice(4, 6);

  return {
    base: base!,
    quote: quote!,
    settle: settle!,
    expiry: `20${yy}-${mm}-${dd}`,
    expiryCode: expiryCode!,
    strike: Number(strikeStr),
    right: rightChar === 'C' ? 'call' : 'put',
  };
}

/** Build a CCXT unified option symbol from parts */
export function formatOptionSymbol(opt: CanonicalOption): string {
  const rightChar = opt.right === 'call' ? 'C' : 'P';
  return `${opt.base}/${opt.quote}:${opt.settle}-${opt.expiryCode}-${opt.strike}-${rightChar}`;
}

/** Create a strike-level key for grouping calls+puts across venues */
export function strikeKey(base: string, expiry: string, strike: number): string {
  return `${base}:${expiry}:${strike}`;
}
