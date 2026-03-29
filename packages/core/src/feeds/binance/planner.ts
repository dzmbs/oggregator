import type { CachedInstrument } from '../shared/sdk-base.js';
import { buildBinanceOiStreams } from './state.js';

export interface BinanceSubscriptionState {
  subscribedStreams: Set<string>;
  pendingSubscribeStreams: Set<string>;
}

export function createBinanceSubscriptionState(): BinanceSubscriptionState {
  return {
    subscribedStreams: new Set<string>(),
    pendingSubscribeStreams: new Set<string>(),
  };
}

export function buildBinanceInitialStreams(instruments: CachedInstrument[]): string[] {
  const underlyings = new Set<string>();
  for (const instrument of instruments) {
    underlyings.add(`${instrument.base.toLowerCase()}${instrument.settle.toLowerCase()}`);
  }

  return [
    ...[...underlyings].map((underlying) => `${underlying}@optionMarkPrice`),
    '!optionSymbol',
    ...buildBinanceOiStreams(instruments),
  ];
}

export function trackBinanceStreams(state: BinanceSubscriptionState, streams: string[]): string[] {
  const accepted: string[] = [];

  for (const stream of streams) {
    if (state.subscribedStreams.has(stream) || state.pendingSubscribeStreams.has(stream)) continue;
    state.pendingSubscribeStreams.add(stream);
    accepted.push(stream);
  }

  return accepted;
}

export function buildBinanceChainStreams(
  underlying: string,
  instruments: CachedInstrument[],
): string[] {
  return [`${underlying.toLowerCase()}usdt@optionMarkPrice`, ...buildBinanceOiStreams(instruments)];
}

export function confirmBinanceSubscribedStreams(
  state: BinanceSubscriptionState,
  streams: string[],
): void {
  for (const stream of streams) {
    state.pendingSubscribeStreams.delete(stream);
    state.subscribedStreams.add(stream);
  }
}

export function rollbackBinancePendingStreams(
  state: BinanceSubscriptionState,
  streams: string[],
): void {
  for (const stream of streams) {
    state.pendingSubscribeStreams.delete(stream);
  }
}

export function removeBinanceTrackedStreams(
  state: BinanceSubscriptionState,
  streams: string[],
): void {
  for (const stream of streams) {
    state.pendingSubscribeStreams.delete(stream);
    state.subscribedStreams.delete(stream);
  }
}

export function resetBinanceSubscriptionState(state: BinanceSubscriptionState): void {
  state.pendingSubscribeStreams.clear();
  state.subscribedStreams.clear();
}
