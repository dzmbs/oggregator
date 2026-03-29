import { BaseAdapter } from './base.js';
import type { VenueCapabilities, StreamHandlers } from './types.js';
import type { ChainRequest, VenueOptionChain, NormalizedOptionContract, VenueDelta, VenueStatus, VenueConnectionState, OptionGreeks, EstimatedFees } from '../../core/types.js';
import { EMPTY_GREEKS } from '../../core/types.js';
import type { VenueId, OptionRight } from '../../types/common.js';

// Fee cap: limits fee to this fraction of the option premium.
// Without it, OTM options with tiny premiums would have absurdly high fees
// relative to their price (e.g. 0.03% × $70K underlying = $21 on a $5 option).
const FEE_CAP: Record<VenueId, number> = {
  deribit: 0.125,   // 12.5% of option price
  okx:     0.125,   // 12.5% of option price
  bybit:   0.125,   // 12.5% of option price
  binance: 0.10,    // 10% of option price
  derive:  0.125,   // 12.5% of option premium
};

export interface CachedInstrument {
  symbol: string;
  exchangeSymbol: string;
  base: string;
  quote: string;
  settle: string;
  expiry: string;
  strike: number;
  right: OptionRight;
  inverse: boolean;
  contractSize: number | null;
  contractValueCurrency?: string | null;
  tickSize: number | null;
  minQty: number | null;
  makerFee: number | null;
  takerFee: number | null;
}

export interface LiveQuote {
  bidPrice: number | null;
  askPrice: number | null;
  bidSize: number | null;
  askSize: number | null;
  markPrice: number | null;
  lastPrice: number | null;
  underlyingPrice: number | null;
  indexPrice: number | null;
  volume24h: number | null;
  /** Open interest normalized to contract count. */
  openInterest: number | null;
  /** USD-denominated open interest notional, either venue-native or derived from contract metadata. */
  openInterestUsd: number | null;
  /** USD-denominated 24h volume when the venue provides it natively (Bybit turnover). */
  volume24hUsd: number | null;
  greeks: OptionGreeks;
  timestamp: number;
}

export abstract class SdkBaseAdapter extends BaseAdapter {
  abstract override readonly venue: VenueId;
  override readonly capabilities: VenueCapabilities = {
    optionChain: true,
    greeks: true,
    websocket: true,
  };

  protected instruments: CachedInstrument[] = [];
  protected quoteStore = new Map<string, LiveQuote>();
  protected instrumentMap = new Map<string, CachedInstrument>();
  protected symbolIndex = new Map<string, string>();
  protected marketsLoaded = false;
  protected requestRefCounts = new Map<string, number>();
  protected handlerRefCounts = new Map<StreamHandlers, number>();

  protected abstract initClients(): void;
  protected abstract fetchInstruments(): Promise<CachedInstrument[]>;
  protected abstract subscribeChain(
    underlying: string,
    expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void>;
  protected async unsubscribeChain(
    _underlying: string,
    _expiry: string,
    _instruments: CachedInstrument[],
  ): Promise<void> {}
  protected abstract unsubscribeAll(): Promise<void>;

  // Number of nearest expiries to eagerly subscribe at boot.
  // Covers what users look at 90% of the time — data is live before the UI asks.
  protected eagerExpiryCount = 3;

  override async loadMarkets(force = false): Promise<void> {
    if (this.marketsLoaded && !force) return;
    this.initClients();
    this.instruments = await this.fetchInstruments();
    this.instrumentMap.clear();
    this.symbolIndex.clear();
    for (const inst of this.instruments) {
      this.instrumentMap.set(inst.exchangeSymbol, inst);
      this.symbolIndex.set(inst.symbol, inst.exchangeSymbol);
    }
    this.marketsLoaded = true;

    await this.eagerSubscribe();
  }

  protected async eagerSubscribe(): Promise<void> {
    const underlyings = await this.listUnderlyings();

    for (const underlying of underlyings) {
      const expiries = await this.listExpiries(underlying);
      const nearest = expiries.slice(0, this.eagerExpiryCount);

      for (const expiry of nearest) {
        const matching = this.instruments.filter(
          (i) => i.base === underlying && i.expiry === expiry,
        );
        if (matching.length > 0) {
          await this.subscribeChain(underlying, expiry, matching);
        }
      }
    }
  }

  override async listUnderlyings(): Promise<string[]> {
    return [...new Set(this.instruments.map((i) => i.base))].sort();
  }

  override async listExpiries(underlying: string): Promise<string[]> {
    const expiries = new Set<string>();
    for (const inst of this.instruments) {
      if (inst.base === underlying) expiries.add(inst.expiry);
    }
    return [...expiries].sort();
  }

  override fetchOptionChain(request: ChainRequest): Promise<VenueOptionChain> {
    const matching = this.instruments.filter(
      (i) => i.base === request.underlying && i.expiry === request.expiry,
    );
    const contracts: Record<string, NormalizedOptionContract> = {};

    for (const inst of matching) {
      const quote = this.quoteStore.get(inst.exchangeSymbol);
      contracts[inst.symbol] = this.buildContract(inst, quote ?? null);
    }

    return Promise.resolve({
      venue: this.venue,
      underlying: request.underlying,
      expiry: request.expiry,
      asOf: Date.now(),
      contracts,
    });
  }

  async subscribe(
    request: ChainRequest,
    handlers: StreamHandlers,
  ): Promise<() => Promise<void>> {
    const matching = this.instruments.filter(
      (i) => i.base === request.underlying && i.expiry === request.expiry,
    );
    const key = `${request.underlying}:${request.expiry}`;

    handlers.onStatus({ venue: this.venue, state: 'connected', ts: Date.now() });

    const handlerRefCount = this.handlerRefCounts.get(handlers) ?? 0;
    this.handlerRefCounts.set(handlers, handlerRefCount + 1);
    if (handlerRefCount === 0) {
      this.deltaHandlers.add(handlers);
    }

    const requestRefCount = this.requestRefCounts.get(key) ?? 0;
    this.requestRefCounts.set(key, requestRefCount + 1);
    if (requestRefCount === 0) {
      await this.subscribeChain(request.underlying, request.expiry, matching);
    }

    let released = false;

    return async () => {
      if (released) return;
      released = true;

      const nextHandlerRefCount = (this.handlerRefCounts.get(handlers) ?? 1) - 1;
      if (nextHandlerRefCount <= 0) {
        this.handlerRefCounts.delete(handlers);
        this.deltaHandlers.delete(handlers);
      } else {
        this.handlerRefCounts.set(handlers, nextHandlerRefCount);
      }

      const nextRequestRefCount = (this.requestRefCounts.get(key) ?? 1) - 1;
      if (nextRequestRefCount <= 0) {
        this.requestRefCounts.delete(key);
        await this.unsubscribeChain(request.underlying, request.expiry, matching);
        return;
      }

      this.requestRefCounts.set(key, nextRequestRefCount);
    };
  }

  /** Remove a handler without tearing down venue subscriptions. */
  removeDeltaHandler(handlers: StreamHandlers): void {
    this.handlerRefCounts.delete(handlers);
    this.deltaHandlers.delete(handlers);
  }

  protected activeRequestsForUnderlying(underlying: string): number {
    let count = 0;
    for (const [key, refCount] of this.requestRefCounts) {
      if (refCount <= 0) continue;
      const [requestUnderlying] = key.split(':');
      if (requestUnderlying === underlying) {
        count += refCount;
      }
    }
    return count;
  }

  async dispose(): Promise<void> {
    await this.unsubscribeAll();
  }

  // ── internal helpers ──────────────────────────────────────────

  protected deltaHandlers = new Set<StreamHandlers>();

  /** Broadcast venue connection state to all registered handlers. */
  protected emitStatus(state: VenueConnectionState, message?: string): void {
    const status: VenueStatus = { venue: this.venue, state, ts: Date.now() };
    if (message != null) status.message = message;
    for (const h of this.deltaHandlers) {
      h.onStatus(status);
    }
  }

  protected emitQuoteUpdate(exchangeSymbol: string, quote: LiveQuote): void {
    this.emitQuoteUpdates([{ exchangeSymbol, quote }]);
  }

  protected emitQuoteUpdates(updates: Array<{ exchangeSymbol: string; quote: LiveQuote }>): void {
    const deltas: VenueDelta[] = [];

    for (const update of updates) {
      this.quoteStore.set(update.exchangeSymbol, update.quote);

      if (this.deltaHandlers.size === 0) continue;

      const inst = this.instrumentMap.get(update.exchangeSymbol);
      if (!inst) continue;

      deltas.push({
        venue: this.venue,
        symbol: inst.symbol,
        ts: update.quote.timestamp,
        quote: {
          bid: this.normPrice(update.quote.bidPrice, inst),
          ask: this.normPrice(update.quote.askPrice, inst),
          mark: this.normPrice(update.quote.markPrice, inst),
          bidSize: update.quote.bidSize,
          askSize: update.quote.askSize,
          underlyingPriceUsd: update.quote.underlyingPrice,
          indexPriceUsd: update.quote.indexPrice,
          volume24h: update.quote.volume24h,
          openInterest: update.quote.openInterest,
          openInterestUsd: this.normalizeOpenInterestUsd(
            inst,
            update.quote.openInterest,
            update.quote.openInterestUsd,
            update.quote.underlyingPrice,
          ),
          volume24hUsd: update.quote.volume24hUsd,
          estimatedFees: this.estimateFees(
            inst,
            this.normPrice(update.quote.markPrice, inst).usd,
            update.quote.underlyingPrice,
          ),
          timestamp: update.quote.timestamp,
          source: 'ws',
        },
        greeks: update.quote.greeks,
      });
    }

    if (deltas.length === 0) return;

    for (const h of this.deltaHandlers) {
      h.onDelta(deltas);
    }
  }

  protected buildContract(
    inst: CachedInstrument,
    quote: LiveQuote | null,
  ): NormalizedOptionContract {
    const q = quote ?? this.emptyQuote();
    return {
      venue: this.venue,
      symbol: inst.symbol,
      exchangeSymbol: inst.exchangeSymbol,
      base: inst.base,
      settle: inst.settle,
      expiry: inst.expiry,
      strike: inst.strike,
      right: inst.right,
      inverse: inst.inverse,
      contractSize: inst.contractSize,
      tickSize: inst.tickSize,
      minQty: inst.minQty,
      makerFee: inst.makerFee,
      takerFee: inst.takerFee,
      greeks: q.greeks,
      quote: {
        bid: this.normPrice(q.bidPrice, inst),
        ask: this.normPrice(q.askPrice, inst),
        mark: this.normPrice(q.markPrice, inst),
        last: q.lastPrice != null ? this.normPrice(q.lastPrice, inst) : null,
        bidSize: q.bidSize,
        askSize: q.askSize,
        underlyingPriceUsd: q.underlyingPrice,
        indexPriceUsd: q.indexPrice,
        volume24h: q.volume24h,
        openInterest: q.openInterest,
        openInterestUsd: this.normalizeOpenInterestUsd(inst, q.openInterest, q.openInterestUsd, q.underlyingPrice),
        volume24hUsd: q.volume24hUsd,
        estimatedFees: this.estimateFees(
          inst,
          this.normPrice(q.markPrice, inst).usd,
          q.underlyingPrice,
        ),
        timestamp: q.timestamp,
        source: this.quoteStore.has(inst.exchangeSymbol) ? 'ws' : 'rest',
      },
    };
  }

  /**
   * Normalize a raw price to include USD equivalent.
   * Inverse venues (Deribit BTC/ETH, OKX BTC/ETH): premium in base asset, multiply by underlying.
   * Linear venues (Binance USDT, Bybit USDT/USDC, Derive USDC): raw === usd.
   */
  protected normPrice(raw: number | null, inst: CachedInstrument) {
    const currency = inst.inverse ? inst.base : inst.settle;
    if (raw == null) return { raw: null as null, rawCurrency: currency, usd: null as null };

    if (inst.inverse) {
      const underlyingPrice = this.quoteStore.get(inst.exchangeSymbol)?.underlyingPrice;
      const usd = underlyingPrice != null ? raw * underlyingPrice : null;
      return { raw, rawCurrency: currency, usd };
    }
    return { raw, rawCurrency: currency, usd: raw };
  }

  /**
   * Estimate per-contract fees using the venue's fee formula:
   *   fee = min(rate × underlyingPrice × contractSize, cap × optionPriceUsd)
   *
   * The cap prevents absurdly high fees on cheap OTM options. For example,
   * without cap: 0.03% × $70K = $21 on a $5 option (420% of premium).
   * With 12.5% cap: 12.5% × $5 = $0.625.
   */
  protected normalizeOpenInterestUsd(
    inst: CachedInstrument,
    openInterestContracts: number | null,
    nativeOpenInterestUsd: number | null,
    underlyingPriceUsd: number | null,
  ): number | null {
    if (nativeOpenInterestUsd != null) return nativeOpenInterestUsd;
    if (openInterestContracts == null) return null;

    const contractSize = inst.contractSize ?? 1;
    const contractValueCurrency = (inst.contractValueCurrency ?? inst.base).toUpperCase();

    if (contractValueCurrency === inst.base.toUpperCase()) {
      return underlyingPriceUsd != null ? openInterestContracts * contractSize * underlyingPriceUsd : null;
    }

    if (contractValueCurrency === 'USD' || contractValueCurrency === 'USDT' || contractValueCurrency === 'USDC') {
      return openInterestContracts * contractSize;
    }

    return null;
  }

  protected estimateFees(
    inst: CachedInstrument,
    optionPriceUsd: number | null,
    underlyingPriceUsd: number | null,
  ): EstimatedFees | null {
    if (inst.makerFee == null || inst.takerFee == null) return null;
    if (underlyingPriceUsd == null || optionPriceUsd == null) return null;

    const size = inst.contractSize ?? 1;
    const cap = FEE_CAP[this.venue];

    const makerBase = inst.makerFee * underlyingPriceUsd * size;
    const takerBase = inst.takerFee * underlyingPriceUsd * size;
    const capLimit = cap * optionPriceUsd;

    return {
      maker: Math.min(makerBase, capLimit),
      taker: Math.min(takerBase, capLimit),
    };
  }

  protected emptyQuote(): LiveQuote {
    return {
      bidPrice: null,
      askPrice: null,
      bidSize: null,
      askSize: null,
      markPrice: null,
      lastPrice: null,
      underlyingPrice: null,
      indexPrice: null,
      volume24h: null,
      openInterest: null,
      openInterestUsd: null,
      volume24hUsd: null,
      greeks: { ...EMPTY_GREEKS },
      timestamp: 0,
    };
  }

  protected removeCachedInstruments(predicate: (instrument: CachedInstrument) => boolean): CachedInstrument[] {
    const removed = this.instruments.filter(predicate);
    if (removed.length === 0) return removed;

    const removedExchangeSymbols = new Set(removed.map((instrument) => instrument.exchangeSymbol));
    const removedSymbols = new Set(removed.map((instrument) => instrument.symbol));

    this.instruments = this.instruments.filter((instrument) => !removedExchangeSymbols.has(instrument.exchangeSymbol));

    for (const exchangeSymbol of removedExchangeSymbols) {
      this.instrumentMap.delete(exchangeSymbol);
      this.quoteStore.delete(exchangeSymbol);
    }

    for (const symbol of removedSymbols) {
      this.symbolIndex.delete(symbol);
    }

    return removed;
  }

  protected sweepExpiredInstruments(now = Date.now()): CachedInstrument[] {
    const today = new Date(now).toISOString().slice(0, 10);
    return this.removeCachedInstruments((instrument) => instrument.expiry < today);
  }

  // ── symbol normalization ──────────────────────────────────────

  protected parseExpiry(raw: string): string {
    if (/^\d{6}$/.test(raw)) {
      return `20${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
    }
    if (/^\d{8}$/.test(raw)) {
      return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    }
    const m = raw.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
    if (m) {
      const months: Record<string, string> = {
        JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
        JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
      };
      return `20${m[3]!}-${months[m[2]!] ?? '01'}-${m[1]!.padStart(2, '0')}`;
    }
    if (/^\d{10,13}$/.test(raw)) {
      return new Date(Number(raw)).toISOString().slice(0, 10);
    }
    return raw;
  }

  /**
   * Canonical symbol: BASE/USD:SETTLE-YYMMDD-STRIKE-C/P
   * Quote is always USD for cross-venue matching, regardless of settle currency.
   */
  protected buildCanonicalSymbol(
    base: string,
    settle: string,
    expiry: string,
    strike: number,
    right: OptionRight,
  ): string {
    const yy = expiry.slice(2, 4);
    const mm = expiry.slice(5, 7);
    const dd = expiry.slice(8, 10);
    const rc = right === 'call' ? 'C' : 'P';
    return `${base}/USD:${settle}-${yy}${mm}${dd}-${strike}-${rc}`;
  }
}
