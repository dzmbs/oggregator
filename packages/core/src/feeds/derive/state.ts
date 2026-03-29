import { EMPTY_GREEKS } from '../../core/types.js';
import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import type { DeriveInstrument, DeriveTicker } from './types.js';

export interface DeriveInstrumentDetails {
  base: string;
  expiryRaw: string;
  strike: number;
  right: 'call' | 'put';
}

export interface DeriveState {
  expiryDates: Map<string, Set<string>>;
}

export function createDeriveState(): DeriveState {
  return {
    expiryDates: new Map<string, Set<string>>(),
  };
}

export function deriveInstrumentDetails(
  instrument: DeriveInstrument,
): DeriveInstrumentDetails | null {
  const name = instrument.instrument_name;
  const details = instrument.option_details;

  if (details != null) {
    const base = details.index.split('-')[0] ?? name.split('-')[0];
    const strike = Number(details.strike);
    const right = details.option_type === 'C' ? 'call' : 'put';
    const expiryDate = new Date(details.expiry * 1000);
    const yyyy = expiryDate.getUTCFullYear().toString();
    const mm = (expiryDate.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = expiryDate.getUTCDate().toString().padStart(2, '0');

    return {
      base: base ?? name.split('-')[0] ?? '',
      expiryRaw: `${yyyy}${mm}${dd}`,
      strike,
      right,
    };
  }

  const parts = name.match(/^(\w+)-(\d{8})-(\d+)-([CP])$/);
  if (parts == null) return null;

  return {
    base: parts[1]!,
    expiryRaw: parts[2]!,
    strike: Number(parts[3]),
    right: parts[4] === 'C' ? 'call' : 'put',
  };
}

export function registerDeriveExpiry(state: DeriveState, base: string, expiryRaw: string): void {
  const expiries = state.expiryDates.get(base) ?? new Set<string>();
  expiries.add(expiryRaw);
  state.expiryDates.set(base, expiries);
}

export function registerDeriveInstrument(
  state: DeriveState,
  instruments: CachedInstrument[],
  instrumentMap: Map<string, CachedInstrument>,
  symbolIndex: Map<string, string>,
  instrument: CachedInstrument,
): void {
  instruments.push(instrument);
  instrumentMap.set(instrument.exchangeSymbol, instrument);
  symbolIndex.set(instrument.symbol, instrument.exchangeSymbol);
  registerDeriveExpiry(state, instrument.base, instrument.expiry.replace(/-/g, ''));
}

export function buildDeriveQuote(
  ticker: DeriveTicker,
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  const optionPricing = ticker.option_pricing;
  const stats = ticker.stats;

  return {
    bidPrice: safeNum(ticker.b ?? ticker.best_bid_price),
    askPrice: safeNum(ticker.a ?? ticker.best_ask_price),
    bidSize: safeNum(ticker.B ?? ticker.best_bid_amount),
    askSize: safeNum(ticker.A ?? ticker.best_ask_amount),
    markPrice: safeNum(optionPricing?.m ?? ticker.M ?? ticker.mark_price),
    lastPrice: null,
    underlyingPrice: safeNum(ticker.I ?? ticker.index_price),
    indexPrice: safeNum(ticker.I ?? ticker.index_price),
    volume24h: safeNum(stats?.c),
    openInterest: safeNum(stats?.oi),
    openInterestUsd: null,
    volume24hUsd: safeNum(stats?.v),
    greeks:
      optionPricing != null
        ? {
            delta: safeNum(optionPricing.d ?? optionPricing.delta),
            gamma: safeNum(optionPricing.g ?? optionPricing.gamma),
            theta: safeNum(optionPricing.t ?? optionPricing.theta),
            vega: safeNum(optionPricing.v ?? optionPricing.vega),
            rho: safeNum(optionPricing.r ?? optionPricing.rho),
            markIv: safeNum(optionPricing.i ?? optionPricing.iv),
            bidIv: safeNum(optionPricing.bi ?? optionPricing.bid_iv),
            askIv: safeNum(optionPricing.ai ?? optionPricing.ask_iv),
          }
        : { ...EMPTY_GREEKS },
    timestamp: Number(ticker.t ?? ticker.timestamp) || Date.now(),
  };
}
