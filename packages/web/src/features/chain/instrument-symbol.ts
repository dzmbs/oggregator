import type { VenueId } from '@oggregator/protocol';

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

export const CHART_SUPPORTED_VENUES: readonly VenueId[] = [
  'deribit',
  'binance',
  'okx',
  'gateio',
  'bybit',
  'derive',
  'thalex',
];

export function isChartSupportedVenue(v: VenueId): boolean {
  return (CHART_SUPPORTED_VENUES as readonly string[]).includes(v);
}

export class NotSupportedVenueError extends Error {
  constructor(public readonly venue: VenueId) {
    super(`Instrument symbol formatting not implemented for venue: ${venue}`);
    this.name = 'NotSupportedVenueError';
  }
}

interface ToVenueSymbolArgs {
  venue: VenueId;
  underlying: string;
  expiry: string;
  strike: number;
  type: 'call' | 'put';
}

export function toVenueSymbol(args: ToVenueSymbolArgs): string {
  switch (args.venue) {
    case 'deribit':
      return formatDeribit(args);
    case 'binance':
      return formatBinance(args);
    case 'okx':
      return formatOkx(args);
    case 'gateio':
      return formatGateio(args);
    case 'bybit':
      return formatBybit(args);
    case 'derive':
      return formatDerive(args);
    case 'thalex':
      return formatThalex(args);
    default:
      throw new NotSupportedVenueError(args.venue);
  }
}

function parseExpiry(expiry: string): { day: number; month: number; year: number } {
  const d = new Date(`${expiry}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`toVenueSymbol: invalid expiry "${expiry}" (expected YYYY-MM-DD)`);
  }
  return { day: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear() };
}

function formatDeribit({ underlying, expiry, strike, type }: ToVenueSymbolArgs): string {
  const { day, month, year } = parseExpiry(expiry);
  const yr = String(year).slice(-2);
  return `${underlying}-${day}${MONTHS[month]}${yr}-${String(strike)}-${type === 'call' ? 'C' : 'P'}`;
}

function formatBinance({ underlying, expiry, strike, type }: ToVenueSymbolArgs): string {
  // Format: BTC-YYMMDD-STRIKE-C/P
  const { day, month, year } = parseExpiry(expiry);
  const yr = String(year).slice(-2);
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${underlying}-${yr}${mm}${dd}-${String(strike)}-${type === 'call' ? 'C' : 'P'}`;
}

function formatOkx({ underlying, expiry, strike, type }: ToVenueSymbolArgs): string {
  // Inverse format used by the chain feed: BTC-USD-YYMMDD-STRIKE-C/P
  const { day, month, year } = parseExpiry(expiry);
  const yr = String(year).slice(-2);
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${underlying}-USD-${yr}${mm}${dd}-${String(strike)}-${type === 'call' ? 'C' : 'P'}`;
}

function formatGateio({ underlying, expiry, strike, type }: ToVenueSymbolArgs): string {
  // Format: BTC_USDT-YYYYMMDD-STRIKE-C/P
  const { day, month, year } = parseExpiry(expiry);
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${underlying}_USDT-${year}${mm}${dd}-${String(strike)}-${type === 'call' ? 'C' : 'P'}`;
}

function formatBybit({ underlying, expiry, strike, type }: ToVenueSymbolArgs): string {
  // Format: BTC-DDMONYY-STRIKE-C/P-USDT (Deribit-style with USDT suffix)
  const { day, month, year } = parseExpiry(expiry);
  const yr = String(year).slice(-2);
  return `${underlying}-${day}${MONTHS[month]}${yr}-${String(strike)}-${type === 'call' ? 'C' : 'P'}-USDT`;
}

function formatDerive({ underlying, expiry, strike, type }: ToVenueSymbolArgs): string {
  // Format: BTC-YYYYMMDD-STRIKE-C/P
  const { day, month, year } = parseExpiry(expiry);
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${underlying}-${year}${mm}${dd}-${String(strike)}-${type === 'call' ? 'C' : 'P'}`;
}

function formatThalex({ underlying, expiry, strike, type }: ToVenueSymbolArgs): string {
  // Same as Deribit: BTC-DDMONYY-STRIKE-C/P (verified against
  // GET /api/v2/public/instruments — instrument_name uses this shape).
  const { day, month, year } = parseExpiry(expiry);
  const yr = String(year).slice(-2);
  return `${underlying}-${day}${MONTHS[month]}${yr}-${String(strike)}-${type === 'call' ? 'C' : 'P'}`;
}
