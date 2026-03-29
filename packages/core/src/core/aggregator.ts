import type { VenueOptionChain, ComparisonChain, ComparisonRow } from './types.js';

export function buildComparisonChain(
  underlying: string,
  expiry: string,
  venueChains: VenueOptionChain[],
): ComparisonChain {
  const strikeMap = new Map<number, ComparisonRow>();

  for (const vc of venueChains) {
    for (const contract of Object.values(vc.contracts)) {
      let row = strikeMap.get(contract.strike);
      if (!row) {
        row = { strike: contract.strike, call: {}, put: {} };
        strikeMap.set(contract.strike, row);
      }

      if (contract.right === 'call') {
        row.call[contract.venue] = contract;
      } else {
        row.put[contract.venue] = contract;
      }
    }
  }

  const rows = Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);

  return {
    underlying,
    expiry,
    asOf: Date.now(),
    rows,
  };
}
