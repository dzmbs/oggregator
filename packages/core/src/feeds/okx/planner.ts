import type { CachedInstrument } from '../shared/sdk-base.js';

export interface OkxSubscriptionState {
  subscribedFamilies: Set<string>;
  subscribedTickers: Set<string>;
  subscribedMarkPrice: Set<string>;
}

export function createOkxSubscriptionState(): OkxSubscriptionState {
  return {
    subscribedFamilies: new Set<string>(),
    subscribedTickers: new Set<string>(),
    subscribedMarkPrice: new Set<string>(),
  };
}

export function buildOkxChainSubscriptionArgs(
  state: OkxSubscriptionState,
  underlying: string,
  instruments: CachedInstrument[],
): object[] {
  const args: object[] = [];
  const family = `${underlying}-USD`;

  if (!state.subscribedFamilies.has(family)) {
    args.push({ channel: 'opt-summary', instFamily: family });
    state.subscribedFamilies.add(family);
  }

  for (const instrument of instruments) {
    if (!state.subscribedTickers.has(instrument.exchangeSymbol)) {
      args.push({ channel: 'tickers', instId: instrument.exchangeSymbol });
      state.subscribedTickers.add(instrument.exchangeSymbol);
    }

    if (!state.subscribedMarkPrice.has(instrument.exchangeSymbol)) {
      args.push({ channel: 'mark-price', instId: instrument.exchangeSymbol });
      state.subscribedMarkPrice.add(instrument.exchangeSymbol);
    }
  }

  return args;
}

export function buildOkxInstrumentSubscriptionArgs(
  state: OkxSubscriptionState,
  instruments: CachedInstrument[],
): object[] {
  const args: object[] = [];

  for (const instrument of instruments) {
    if (!state.subscribedTickers.has(instrument.exchangeSymbol)) {
      args.push({ channel: 'tickers', instId: instrument.exchangeSymbol });
      state.subscribedTickers.add(instrument.exchangeSymbol);
    }

    if (!state.subscribedMarkPrice.has(instrument.exchangeSymbol)) {
      args.push({ channel: 'mark-price', instId: instrument.exchangeSymbol });
      state.subscribedMarkPrice.add(instrument.exchangeSymbol);
    }
  }

  return args;
}

export function buildOkxReplayArgs(state: OkxSubscriptionState): object[] {
  return [
    ...[...state.subscribedFamilies].map((family) => ({
      channel: 'opt-summary',
      instFamily: family,
    })),
    ...[...state.subscribedTickers].map((id) => ({ channel: 'tickers', instId: id })),
    ...[...state.subscribedMarkPrice].map((id) => ({ channel: 'mark-price', instId: id })),
  ];
}

export function buildOkxUnsubscribeArgs(state: OkxSubscriptionState): object[] {
  return buildOkxReplayArgs(state);
}

export function removeOkxSubscribedInstruments(
  state: OkxSubscriptionState,
  exchangeSymbols: string[],
): void {
  for (const exchangeSymbol of exchangeSymbols) {
    state.subscribedTickers.delete(exchangeSymbol);
    state.subscribedMarkPrice.delete(exchangeSymbol);
  }
}

export function resetOkxSubscriptionState(state: OkxSubscriptionState): void {
  state.subscribedFamilies.clear();
  state.subscribedTickers.clear();
  state.subscribedMarkPrice.clear();
}
