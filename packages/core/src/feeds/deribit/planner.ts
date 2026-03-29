import type { CachedInstrument } from '../shared/sdk-base.js';

const INTERVAL_PRIORITY: Record<string, number> = { raw: 3, '100ms': 2, agg2: 1 };

export interface DeribitSubscriptionState {
  subscribedIndexes: Set<string>;
  subscribedPriceIndexes: Set<string>;
  subscribedTickers: Set<string>;
  tickerIntervals: Map<string, string>;
}

export interface DeribitSubscriptionPlan {
  indexName: string;
  bulkChannels: string[];
  tickerChannels: string[];
  channelsToUnsubscribe: string[];
}

export function createDeribitSubscriptionState(): DeribitSubscriptionState {
  return {
    subscribedIndexes: new Set<string>(),
    subscribedPriceIndexes: new Set<string>(),
    subscribedTickers: new Set<string>(),
    tickerIntervals: new Map<string, string>(),
  };
}

export function deribitIndexNameFor(underlying: string): string {
  return underlying.includes('_') ? underlying.toLowerCase() : `${underlying.toLowerCase()}_usd`;
}

export function buildDeribitSubscriptionPlan(
  state: DeribitSubscriptionState,
  underlying: string,
  instruments: CachedInstrument[],
  interval: string,
): DeribitSubscriptionPlan {
  const bulkChannels: string[] = [];
  const tickerChannels: string[] = [];
  const channelsToUnsubscribe: string[] = [];
  const indexName = deribitIndexNameFor(underlying);

  if (!state.subscribedIndexes.has(indexName)) {
    bulkChannels.push(`markprice.options.${indexName}`);
    state.subscribedIndexes.add(indexName);
  }

  if (!state.subscribedPriceIndexes.has(indexName)) {
    bulkChannels.push(`deribit_price_index.${indexName}`);
    state.subscribedPriceIndexes.add(indexName);
  }

  const requestedPriority = INTERVAL_PRIORITY[interval] ?? 1;

  for (const instrument of instruments) {
    const existingInterval = state.tickerIntervals.get(instrument.exchangeSymbol);
    const existingPriority =
      existingInterval != null ? (INTERVAL_PRIORITY[existingInterval] ?? 1) : 0;

    if (requestedPriority <= existingPriority) continue;

    if (existingInterval != null) {
      channelsToUnsubscribe.push(`ticker.${instrument.exchangeSymbol}.${existingInterval}`);
    }

    tickerChannels.push(`ticker.${instrument.exchangeSymbol}.${interval}`);
    state.subscribedTickers.add(instrument.exchangeSymbol);
    state.tickerIntervals.set(instrument.exchangeSymbol, interval);
  }

  return {
    indexName,
    bulkChannels,
    tickerChannels,
    channelsToUnsubscribe,
  };
}

export function releaseDeribitTickerSubscription(
  state: DeribitSubscriptionState,
  exchangeSymbol: string,
): string | null {
  const interval = state.tickerIntervals.get(exchangeSymbol);
  state.subscribedTickers.delete(exchangeSymbol);
  state.tickerIntervals.delete(exchangeSymbol);
  return interval != null ? `ticker.${exchangeSymbol}.${interval}` : null;
}

export function resetDeribitSubscriptionState(state: DeribitSubscriptionState): void {
  state.subscribedIndexes.clear();
  state.subscribedPriceIndexes.clear();
  state.subscribedTickers.clear();
  state.tickerIntervals.clear();
}
