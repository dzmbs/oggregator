import type { ChainRequest, VenueOptionChain } from '../../core/types.js';
import type { VenueDelta, VenueStatus } from '../../core/types.js';
import type { VenueId } from '../../types/common.js';

export interface VenueCapabilities {
  /** Whether the venue supports fetching a full option chain in one call */
  optionChain: boolean;
  /** Whether the venue provides greeks data */
  greeks: boolean;
  /** Whether the adapter uses WebSocket (true) or REST polling (false) */
  websocket: boolean;
}

export interface StreamHandlers {
  onDelta: (deltas: VenueDelta[]) => void;
  onStatus: (status: VenueStatus) => void;
}

/** Contract for all option venue adapters used by the server and coordinator. */
export interface OptionVenueAdapter {
  readonly venue: VenueId;
  readonly capabilities: VenueCapabilities;

  /** Load/refresh instrument catalog for this venue */
  loadMarkets(force?: boolean): Promise<void>;

  /** List base assets that have options (e.g. ['BTC', 'ETH', 'SOL']) */
  listUnderlyings(): Promise<string[]>;

  /** List available expiry dates for an underlying (YYYY-MM-DD format) */
  listExpiries(underlying: string): Promise<string[]>;

  /**
   * List available expiries with an exact UTC ms timestamp when the venue
   * exposes one. `expiryTs: null` falls back to the 08:00 UTC convention.
   */
  listExpiryTimestamps?(underlying: string): Promise<Array<{ expiry: string; expiryTs: number | null }>>;

  /** Fetch a snapshot of all options for an underlying+expiry */
  fetchOptionChain(request: ChainRequest): Promise<VenueOptionChain>;

  /** Subscribe to real-time updates. Returns an unsubscribe function. */
  subscribe?(request: ChainRequest, handlers: StreamHandlers): Promise<() => Promise<void>>;

  /** Remove a delta handler without tearing down venue WS connections. */
  removeDeltaHandler?(handlers: StreamHandlers): void;

  /** Cleanup connections */
  dispose?(): Promise<void>;
}
