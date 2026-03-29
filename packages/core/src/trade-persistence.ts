import { createHash } from 'node:crypto';

import type { BlockTradeEvent, BlockTradeLeg } from './runtime/block-trades/types.js';
import type { TradeEvent } from './runtime/trades/types.js';

export interface ParsedTradeInstrument {
  expiry: string | null;
  strike: number | null;
  optionType: 'call' | 'put' | null;
}

export interface TradeAmounts {
  premiumUsd: number | null;
  notionalUsd: number | null;
  referencePriceUsd: number | null;
  contracts: number;
}

export function parseTradeInstrument(instrument: string): ParsedTradeInstrument {
  const match = instrument.match(/-(\d+(?:\.\d+)?)-([CP])(?:-|$)/);
  const optionType = match?.[2] === 'C' ? 'call' : match?.[2] === 'P' ? 'put' : null;
  const strike = match?.[1] != null ? Number(match[1]) : null;

  const humanDate = instrument.match(/\d{1,2}[A-Z]{3}\d{2}/)?.[0];
  if (humanDate) {
    return {
      expiry: parseHumanExpiry(humanDate),
      strike,
      optionType,
    };
  }

  const numericDate =
    instrument.match(/(?:^|[-_])(\d{6,8})(?:[-_]|$)/)?.[1] ?? instrument.match(/(\d{6,8})/)?.[1];
  return {
    expiry: numericDate ? parseNumericExpiry(numericDate) : null,
    strike,
    optionType,
  };
}

export function getVenueContractMultiplier(venue: string, underlying: string): number {
  if (venue !== 'okx') return 1;
  const upper = underlying.toUpperCase();
  if (upper === 'BTC') return 0.01;
  if (upper === 'ETH') return 0.1;
  return 1;
}

export function isInversePremiumVenue(venue: string): boolean {
  return venue === 'deribit' || venue === 'okx';
}

export function buildLiveTradeUid(trade: TradeEvent): string {
  if (trade.tradeId != null) {
    return `${trade.venue}:${trade.instrument}:${trade.tradeId}`;
  }
  return createHash('sha256')
    .update(
      JSON.stringify({
        mode: 'live',
        venue: trade.venue,
        payload: {
          instrument: trade.instrument,
          timestamp: trade.timestamp,
          side: trade.side,
          price: trade.price,
          size: trade.size,
          isBlock: trade.isBlock,
        },
      }),
    )
    .digest('hex');
}

export function buildBlockTradeUid(trade: BlockTradeEvent): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        mode: 'institutional',
        venue: trade.venue,
        payload: {
          tradeId: trade.tradeId,
          timestamp: trade.timestamp,
        },
      }),
    )
    .digest('hex');
}

export function computeLiveTradeAmounts(
  trade: TradeEvent,
  referencePriceUsd: number | null,
): TradeAmounts {
  const contracts = trade.size * getVenueContractMultiplier(trade.venue, trade.underlying);
  const premiumUsd = isInversePremiumVenue(trade.venue)
    ? referencePriceUsd != null && referencePriceUsd > 0
      ? trade.price * contracts * referencePriceUsd
      : null
    : trade.price * contracts;
  const notionalUsd =
    referencePriceUsd != null && referencePriceUsd > 0 ? contracts * referencePriceUsd : null;

  return {
    premiumUsd,
    notionalUsd,
    referencePriceUsd,
    contracts,
  };
}

export function computeBlockTradeAmounts(
  trade: BlockTradeEvent,
  referencePriceUsd: number | null,
): TradeAmounts {
  const multiplier = getVenueContractMultiplier(trade.venue, trade.underlying);
  const contracts = trade.totalSize * multiplier;
  const premiumUsd = trade.legs.reduce<number | null>((sum, leg) => {
    const legPriceUsd = computeLegPriceUsd(leg, referencePriceUsd);
    if (legPriceUsd == null) return null;
    return (sum ?? 0) + legPriceUsd * leg.size * leg.ratio * multiplier;
  }, 0);

  const notionalUsd =
    referencePriceUsd != null && referencePriceUsd > 0
      ? trade.legs.reduce(
          (sum, leg) => sum + leg.size * leg.ratio * multiplier * referencePriceUsd,
          0,
        )
      : null;

  return {
    premiumUsd,
    notionalUsd,
    referencePriceUsd,
    contracts,
  };
}

function computeLegPriceUsd(leg: BlockTradeLeg, referencePriceUsd: number | null): number | null {
  const isInversePrice = leg.price > 0 && leg.price < 1;
  if (isInversePrice) {
    if (referencePriceUsd == null || referencePriceUsd <= 0) return null;
    return leg.price * referencePriceUsd;
  }
  return leg.price;
}

function parseHumanExpiry(value: string): string | null {
  const match = value.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!match) return null;

  const [, rawDay, rawMonth, rawYear] = match;
  if (!rawDay || !rawMonth || !rawYear) return null;

  const month = MONTH_INDEX[rawMonth];
  if (!month) return null;

  return `20${rawYear}-${month}-${rawDay.padStart(2, '0')}`;
}

function parseNumericExpiry(value: string): string | null {
  if (value.length === 6) {
    return `20${value.slice(0, 2)}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
  }
  if (value.length === 8) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  return null;
}

const MONTH_INDEX: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};
