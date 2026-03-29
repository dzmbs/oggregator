import type { NormalizedOptionContract } from '@shared/common';
import type { VenueExecution } from './types';

// Fallback fee rates for venues that don't expose fees in their instrument API
const DEFAULT_FEES: Record<string, { maker: number; taker: number }> = {
  okx: { maker: 0.0002, taker: 0.0005 },
  binance: { maker: 0.0002, taker: 0.0005 },
  bybit: { maker: 0.0002, taker: 0.0005 },
};

export function contractToExecution(
  contract: NormalizedOptionContract,
  underlyingPrice: number,
): VenueExecution {
  const defaults = DEFAULT_FEES[contract.venue];

  return {
    venue: contract.venue,
    available: contract.quote.bid.usd != null || contract.quote.ask.usd != null,
    bidPrice: contract.quote.bid.usd,
    askPrice: contract.quote.ask.usd,
    markPrice: contract.quote.mark.usd,
    bidSize: contract.quote.bidSize,
    askSize: contract.quote.askSize,
    iv: contract.greeks.markIv,
    delta: contract.greeks.delta,
    contractSize: contract.contractSize ?? 1,
    tickSize: contract.tickSize ?? 1,
    minQty: contract.minQty ?? 0.01,
    makerFee: contract.makerFee ?? defaults?.maker ?? 0.0005,
    takerFee: contract.takerFee ?? defaults?.taker ?? 0.0005,
    settleCurrency: contract.inverse ? 'BTC' : 'USD',
    inverse: contract.inverse,
    underlyingPrice,
  };
}
