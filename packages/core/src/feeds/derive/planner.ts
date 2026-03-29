import type { CachedInstrument } from '../shared/sdk-base.js';

const SUBSCRIBE_BATCH_SIZE = 100;

export interface DeriveSubscriptionState {
  subscribedTickers: Set<string>;
}

export interface DeriveSubscriptionPlan {
  channels: string[];
}

export function createDeriveSubscriptionState(): DeriveSubscriptionState {
  return {
    subscribedTickers: new Set<string>(),
  };
}

export function buildDeriveSubscriptionPlan(
  state: DeriveSubscriptionState,
  instruments: CachedInstrument[],
): DeriveSubscriptionPlan {
  const channels: string[] = [];

  for (const instrument of instruments) {
    if (state.subscribedTickers.has(instrument.exchangeSymbol)) continue;
    channels.push(deriveTickerChannel(instrument.exchangeSymbol));
    state.subscribedTickers.add(instrument.exchangeSymbol);
  }

  return { channels };
}

export async function subscribeDeriveBatches(
  channels: string[],
  subscribe: (batch: string[]) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < channels.length; index += SUBSCRIBE_BATCH_SIZE) {
    await subscribe(channels.slice(index, index + SUBSCRIBE_BATCH_SIZE));
  }
}

export function deriveTickerChannel(exchangeSymbol: string): string {
  return `ticker_slim.${exchangeSymbol}.1000`;
}

export function removeDeriveSubscribedTickers(
  state: DeriveSubscriptionState,
  exchangeSymbols: string[],
): void {
  for (const exchangeSymbol of exchangeSymbols) {
    state.subscribedTickers.delete(exchangeSymbol);
  }
}

export function resetDeriveSubscriptionState(state: DeriveSubscriptionState): void {
  state.subscribedTickers.clear();
}
