import type { CachedInstrument } from '../shared/sdk-base.js';

export const BYBIT_MAX_TOPICS_PER_BATCH = 200;

export interface BybitSubscriptionState {
  subscribedTopics: Set<string>;
}

export function createBybitSubscriptionState(): BybitSubscriptionState {
  return {
    subscribedTopics: new Set<string>(),
  };
}

export function buildBybitTopic(topicSymbol: string): string {
  return `tickers.${topicSymbol}`;
}

export function buildBybitSubscriptionTopics(
  state: BybitSubscriptionState,
  instruments: CachedInstrument[],
): string[] {
  const topics: string[] = [];

  for (const instrument of instruments) {
    const topic = buildBybitTopic(instrument.exchangeSymbol);
    if (state.subscribedTopics.has(topic)) continue;
    state.subscribedTopics.add(topic);
    topics.push(topic);
  }

  return topics;
}

export function buildBybitExpiredTopics(
  state: BybitSubscriptionState,
  expiredSymbols: string[],
): string[] {
  const topics: string[] = [];

  for (const symbol of expiredSymbols) {
    const topic = buildBybitTopic(symbol);
    if (!state.subscribedTopics.has(topic)) continue;
    state.subscribedTopics.delete(topic);
    topics.push(topic);
  }

  return topics;
}

export function resetBybitSubscriptionState(state: BybitSubscriptionState): void {
  state.subscribedTopics.clear();
}
