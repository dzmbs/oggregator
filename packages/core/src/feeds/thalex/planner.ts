import type { CachedInstrument } from '../shared/sdk-base.js';

/**
 * Thalex ticker channels are per-instrument at a configurable delay tier.
 * 1000ms is the sweet spot: matches OKX/Bybit cadence, keeps server load
 * sane for ≥500 contracts, and the chain browser's 200ms coalesce cycle
 * doesn't benefit from sub-second ticks.
 */
export const THALEX_TICKER_DELAY = '1000ms';

// Generous per-subscribe batch. Thalex's docs don't publish an explicit
// cap, so this matches our Coincall default and is tuned empirically.
export const THALEX_MAX_CHANNELS_PER_BATCH = 200;

export interface ThalexSubscriptionState {
  // Channel names currently tracked for `public/subscribe`. Tracked in full
  // channel form (e.g. "ticker.BTC-21APR26-75000-P.1000ms") so the replay
  // path has everything it needs without re-deriving.
  tickerChannels: Set<string>;
  // Underlying names (e.g. "BTCUSD") subscribed to the price_index feed.
  // Independent set so replay can emit both channel families.
  indexUnderlyings: Set<string>;
  // Monotonic request id for RPC correlation. Thalex does not require ids
  // to be unique across connections, but keeping them monotonic makes
  // logs easier to trace.
  nextRpcId: number;
}

export function createThalexSubscriptionState(): ThalexSubscriptionState {
  return {
    tickerChannels: new Set<string>(),
    indexUnderlyings: new Set<string>(),
    nextRpcId: 1,
  };
}

export function buildThalexTickerChannel(instrumentName: string): string {
  return `ticker.${instrumentName}.${THALEX_TICKER_DELAY}`;
}

export function buildThalexIndexChannel(underlying: string): string {
  return `price_index.${underlying.toUpperCase()}`;
}

export function buildThalexSubscribeMessage(
  state: ThalexSubscriptionState,
  channels: string[],
): Record<string, unknown> {
  return {
    method: 'public/subscribe',
    id: state.nextRpcId++,
    params: { channels },
  };
}

export function buildThalexUnsubscribeMessage(
  state: ThalexSubscriptionState,
  channels: string[],
): Record<string, unknown> {
  return {
    method: 'unsubscribe',
    id: state.nextRpcId++,
    params: { channels },
  };
}

/**
 * Track instruments' ticker channels. Returns the **new** channels that
 * still need to be sent on the wire (skips duplicates).
 */
export function buildThalexNewTickerChannels(
  state: ThalexSubscriptionState,
  instruments: CachedInstrument[],
): string[] {
  const fresh: string[] = [];
  for (const inst of instruments) {
    const channel = buildThalexTickerChannel(inst.exchangeSymbol);
    if (state.tickerChannels.has(channel)) continue;
    state.tickerChannels.add(channel);
    fresh.push(channel);
  }
  return fresh;
}

export function buildThalexRemovedTickerChannels(
  state: ThalexSubscriptionState,
  exchangeSymbols: string[],
): string[] {
  const removed: string[] = [];
  for (const sym of exchangeSymbols) {
    const channel = buildThalexTickerChannel(sym);
    if (!state.tickerChannels.has(channel)) continue;
    state.tickerChannels.delete(channel);
    removed.push(channel);
  }
  return removed;
}

export function ensureThalexIndexSub(
  state: ThalexSubscriptionState,
  underlying: string,
): string | null {
  const channel = buildThalexIndexChannel(underlying);
  if (state.indexUnderlyings.has(channel)) return null;
  state.indexUnderlyings.add(channel);
  return channel;
}

export function resetThalexSubscriptionState(state: ThalexSubscriptionState): void {
  state.tickerChannels.clear();
  state.indexUnderlyings.clear();
}

export function* chunkChannels(
  channels: string[],
  size: number,
): Generator<string[]> {
  for (let i = 0; i < channels.length; i += size) {
    yield channels.slice(i, Math.min(i + size, channels.length));
  }
}
