export interface OptionQuote {
  bid: { usd: number | null };
  ask: { usd: number | null };
  mark: { usd: number | null };
  bidSize: number | null;
  askSize: number | null;
  underlyingPriceUsd: number | null;
  volume24h: number | null;
  openInterest: number | null;
}

export interface OptionGreeks {
  delta: number | null;
  markIv: number | null;
}

export interface NormalizedOptionContract {
  venue: string;
  strike: number;
  right: string;
  inverse: boolean;
  contractSize: number | null;
  tickSize: number | null;
  minQty: number | null;
  makerFee: number | null;
  takerFee: number | null;
  greeks: OptionGreeks;
  quote: OptionQuote;
}

export interface ComparisonRow {
  strike: number;
  call: Record<string, NormalizedOptionContract>;
  put: Record<string, NormalizedOptionContract>;
}

export interface Comparison {
  underlying: string;
  expiry: string;
  asOf: number;
  rows: ComparisonRow[];
}

export interface VenueChain {
  venue: string;
  underlying: string;
  expiry: string;
  asOf: number;
  contracts: Record<string, NormalizedOptionContract>;
}

export interface ChainResponse {
  request: { underlying: string; expiry: string };
  venues: VenueChain[];
  comparison: Comparison;
}
