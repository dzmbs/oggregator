// ── Branded type helper ───────────────────────────────────────────

declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

export type UnixMs = Brand<number, 'UnixMs'>;

// ── Venue & option primitives ─────────────────────────────────────
// VenueId and VENUE_IDS owned by @oggregator/protocol, re-exported here
// so core internals don't need a direct protocol import everywhere.

export type { VenueId } from '@oggregator/protocol';
export { VENUE_IDS } from '@oggregator/protocol';

export type OptionRight = 'call' | 'put';

export type DataSource = 'rest' | 'ws' | 'poll';
