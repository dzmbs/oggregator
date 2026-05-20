import type { PositionLeg } from '@oggregator/protocol';

export type { PositionLeg } from '@oggregator/protocol';

export interface MarkContext {
  underlyingPriceUsd: number | null;
  forwardPriceUsd: number | null;
  markPriceUsd: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  theta: number | null;
  yearsToExpiry: number | null;
  // True when the IV (and downstream price/greeks) came from a per-expiry
  // SVI fit because no venue quoted the strike. Surfaces in the UI so the
  // user can tell venue-mid from model-mid.
  ivFromSvi?: boolean;
}

export type MarkProvider = (leg: PositionLeg) => MarkContext;

export interface PositionStoreEvent {
  accountId: string;
  changedLegIds: string[];
}

export type PositionStoreListener = (event: PositionStoreEvent) => void;

export interface PositionStore {
  list(accountId: string): PositionLeg[];
  get(accountId: string, legId: string): PositionLeg | null;
  upsert(accountId: string, leg: PositionLeg): PositionLeg;
  remove(accountId: string, legId: string): boolean;
  subscribe(listener: PositionStoreListener): () => void;
}

export interface PortfolioPersistence {
  load(accountId: string): Promise<PositionLeg[]>;
  upsert(accountId: string, leg: PositionLeg): Promise<void>;
  remove(accountId: string, legId: string): Promise<void>;
}
