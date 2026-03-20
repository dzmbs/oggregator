// ── Branded type helper ───────────────────────────────────────────

declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

export type UnixMs = Brand<number, 'UnixMs'>;

// ── Venue & option primitives ─────────────────────────────────────

export type VenueId = 'deribit' | 'okx' | 'bybit' | 'binance' | 'derive';

export const VENUE_IDS: VenueId[] = ['deribit', 'okx', 'bybit', 'binance', 'derive'];

export type OptionRight = 'call' | 'put';

export type DataSource = 'rest' | 'ws' | 'poll';
