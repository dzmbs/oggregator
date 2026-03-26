export type PersistedTradeMode = 'live' | 'institutional';

export interface PersistedTradeLeg {
  instrument: string;
  direction: 'buy' | 'sell';
  price: number;
  size: number;
  ratio: number;
}

export interface PersistedTradeRecord {
  tradeUid: string;
  mode: PersistedTradeMode;
  venue: string;
  underlying: string;
  instrumentName: string;
  tradeTs: Date;
  ingestedAt: Date;
  direction: 'buy' | 'sell';
  contracts: number;
  price: number | null;
  premiumUsd: number | null;
  notionalUsd: number | null;
  referencePriceUsd: number | null;
  expiry: string | null;
  strike: number | null;
  optionType: 'call' | 'put' | null;
  iv: number | null;
  markPrice: number | null;
  isBlock: boolean;
  strategyLabel: string | null;
  legs: PersistedTradeLeg[] | null;
  raw: Record<string, unknown>;
}
