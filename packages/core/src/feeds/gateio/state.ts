import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import type { GateioContract, GateioTicker } from './types.js';
import { parseGateioSymbol } from './types.js';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function num(raw: string | number | undefined | null): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Gate.io's REST `/options/tickers` and WS `options.contract_tickers` channel do
// not expose a 24h volume field per contract. Volume is derived from the
// `options.trades` stream by accumulating sizes in a 24h sliding window.
export interface GateioVolumeWindow {
  trades: Array<{ tsMs: number; size: number }>;
  totalContracts: number;
}

export function createGateioVolumeWindow(): GateioVolumeWindow {
  return { trades: [], totalContracts: 0 };
}

function pruneVolumeWindow(window: GateioVolumeWindow, now: number): void {
  const cutoff = now - TWENTY_FOUR_HOURS_MS;
  while (window.trades.length > 0 && window.trades[0]!.tsMs < cutoff) {
    const dropped = window.trades.shift()!;
    window.totalContracts -= dropped.size;
  }
  if (window.trades.length === 0 || window.totalContracts < 0) {
    window.totalContracts = window.trades.reduce((s, t) => s + t.size, 0);
  }
}

export function gateioRecordTrade(
  window: GateioVolumeWindow,
  trade: { tsMs: number; size: number },
  now: number,
): number {
  if (trade.size > 0 && trade.tsMs > 0) {
    window.trades.push(trade);
    window.totalContracts += trade.size;
  }
  pruneVolumeWindow(window, now);
  return window.totalContracts;
}

export function gateioPruneVolumeWindow(window: GateioVolumeWindow, now: number): number {
  pruneVolumeWindow(window, now);
  return window.totalContracts;
}

function positiveOrNull(raw: number | undefined | null): number | null {
  if (raw == null) return null;
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

export function buildGateioInstrument(c: GateioContract): CachedInstrument {
  if (c.is_active === false) {
    throw new Error(`gateio: inactive contract ${c.name}`);
  }
  const parsed = parseGateioSymbol(c.name);
  const yy = parsed.expiry.slice(2, 4);
  const mm = parsed.expiry.slice(5, 7);
  const dd = parsed.expiry.slice(8, 10);
  const rc = parsed.right === 'call' ? 'C' : 'P';

  return {
    symbol: `${parsed.base}/USD:USDT-${yy}${mm}${dd}-${parsed.strike}-${rc}`,
    exchangeSymbol: c.name,
    base: parsed.base,
    quote: 'USDT',
    settle: 'USDT',
    expiry: parsed.expiry,
    expirationTimestamp: c.expiration_time * 1000,
    strike: parsed.strike,
    right: parsed.right,
    inverse: false,
    contractSize: num(c.multiplier),
    contractValueCurrency: parsed.base,
    tickSize: num(c.order_price_round ?? null),
    minQty: c.order_size_min ?? null,
    makerFee: num(c.maker_fee_rate),
    takerFee: num(c.taker_fee_rate),
  };
}

function applyTickerFields(prev: LiveQuote, t: GateioTicker, timestampMs: number): LiveQuote {
  return {
    ...prev,
    bidPrice: num(t.bid1_price) ?? prev.bidPrice,
    askPrice: num(t.ask1_price) ?? prev.askPrice,
    bidSize: positiveOrNull(t.bid1_size ?? null) ?? prev.bidSize,
    askSize: positiveOrNull(t.ask1_size ?? null) ?? prev.askSize,
    markPrice: num(t.mark_price) ?? prev.markPrice,
    lastPrice: num(t.last_price) ?? prev.lastPrice,
    underlyingPrice: num(t.underlying_price) ?? prev.underlyingPrice,
    indexPrice: num(t.index_price) ?? prev.indexPrice,
    openInterest: positiveOrNull(t.position_size ?? null) ?? prev.openInterest,
    greeks: {
      ...prev.greeks,
      markIv: num(t.mark_iv) ?? prev.greeks.markIv,
      bidIv: num(t.bid_iv) ?? prev.greeks.bidIv,
      askIv: num(t.ask_iv) ?? prev.greeks.askIv,
      delta: num(t.delta) ?? prev.greeks.delta,
      gamma: num(t.gamma) ?? prev.greeks.gamma,
      vega: num(t.vega) ?? prev.greeks.vega,
      theta: num(t.theta) ?? prev.greeks.theta,
      rho: num(t.rho) ?? prev.greeks.rho,
    },
    timestamp: timestampMs > 0 ? timestampMs : prev.timestamp,
  };
}

export function mergeGateioRestTicker(
  prev: LiveQuote,
  ticker: GateioTicker,
  timestampMs: number,
): LiveQuote {
  return applyTickerFields(prev, ticker, timestampMs);
}

export function mergeGateioWsContractTicker(
  prev: LiveQuote,
  ticker: GateioTicker,
  timestampMs: number,
): LiveQuote {
  return applyTickerFields(prev, ticker, timestampMs);
}

export interface GateioTradeVolume {
  volumeContracts: number;
  contractSize: number | null;
}

export function mergeGateioTrade(
  prev: LiveQuote,
  trade: { price: string; timestampMs: number },
  volume: GateioTradeVolume | null = null,
): LiveQuote {
  const lastPrice = num(trade.price);
  let volume24h = prev.volume24h;
  let volume24hUsd = prev.volume24hUsd;
  if (volume != null && volume.contractSize != null) {
    volume24h = volume.volumeContracts * volume.contractSize;
    volume24hUsd = prev.underlyingPrice != null ? volume24h * prev.underlyingPrice : null;
  }
  return {
    ...prev,
    lastPrice: lastPrice ?? prev.lastPrice,
    volume24h,
    volume24hUsd,
    timestamp: trade.timestampMs > 0 ? trade.timestampMs : prev.timestamp,
  };
}

export function mergeGateioUnderlyingTicker(
  prev: LiveQuote,
  indexPriceStr: string | undefined | null,
  timestampMs: number,
): LiveQuote {
  const price = num(indexPriceStr ?? null);
  if (price == null) return prev;
  return {
    ...prev,
    indexPrice: price,
    underlyingPrice: price,
    volume24hUsd: prev.volume24h != null ? prev.volume24h * price : prev.volume24hUsd,
    timestamp: timestampMs > 0 ? timestampMs : prev.timestamp,
  };
}

export function applyGateioVolume(
  prev: LiveQuote,
  volumeContracts: number,
  contractSize: number | null,
): LiveQuote {
  if (contractSize == null) return prev;
  const volume24h = volumeContracts * contractSize;
  return {
    ...prev,
    volume24h,
    volume24hUsd: prev.underlyingPrice != null ? volume24h * prev.underlyingPrice : prev.volume24hUsd,
  };
}
