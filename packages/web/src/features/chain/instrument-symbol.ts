import type { VenueId } from '@oggregator/protocol';

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

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
    default:
      throw new NotSupportedVenueError(args.venue);
  }
}

function formatDeribit({ underlying, expiry, strike, type }: ToVenueSymbolArgs): string {
  const d = new Date(`${expiry}T00:00:00Z`);
  const day = String(d.getUTCDate());
  const mon = MONTHS[d.getUTCMonth()];
  const yr = String(d.getUTCFullYear()).slice(-2);
  return `${underlying}-${day}${mon}${yr}-${String(strike)}-${type === 'call' ? 'C' : 'P'}`;
}
