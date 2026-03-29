import type { BlockVenueState } from './types.js';

export function createBlockVenueState(
  transport: 'ws' | 'poll',
  pollLimit: number | null,
): BlockVenueState {
  return {
    transport,
    connected: transport === 'poll',
    lastSuccessAt: null,
    lastTradeAt: null,
    lastStatusAt: null,
    lastPollCount: null,
    pollLimit,
    hitLimitCount: 0,
    reconnects: 0,
    errors: 0,
  };
}

export function mergeBlockVenueState(
  current: BlockVenueState,
  patch: Partial<BlockVenueState>,
): BlockVenueState {
  return { ...current, ...patch };
}
