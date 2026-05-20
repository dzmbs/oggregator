import type { VenueId } from '@oggregator/core';
import type { AccountId } from './account.js';
import type { UsdAmount } from './money.js';

export type OrderId = string;
export type OrderSide = 'buy' | 'sell';
export type OptionRight = 'call' | 'put';
export type OrderKind = 'market';
export type OrderStatus = 'accepted' | 'filled' | 'rejected' | 'cancelled';
export type OrderMode = 'paper' | 'live';

export interface OrderLeg {
  index: number;
  side: OrderSide;
  optionRight: OptionRight;
  underlying: string;
  expiry: string;
  strike: number;
  quantity: number;
  preferredVenues: VenueId[] | null;
}

export interface Order {
  id: OrderId;
  clientOrderId: string;
  accountId: AccountId;
  mode: OrderMode;
  kind: OrderKind;
  status: OrderStatus;
  legs: OrderLeg[];
  submittedAt: Date;
  filledAt: Date | null;
  rejectionReason: string | null;
  totalDebitUsd: UsdAmount | null;
}

export function newOrderId(): OrderId {
  return `ord_${cryptoRandom()}`;
}

export function newClientOrderId(): string {
  return `cid_${cryptoRandom()}`;
}

function cryptoRandom(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
