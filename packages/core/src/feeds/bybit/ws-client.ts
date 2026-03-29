import WebSocket from 'ws';
import {
  BYBIT_INSTRUMENTS_INFO,
  BYBIT_REST_BASE_URL,
  BYBIT_SYSTEM_STATUS,
  BYBIT_TICKERS,
  BYBIT_WS_URL,
} from '../shared/endpoints.js';
import { SdkBaseAdapter, type CachedInstrument } from '../shared/sdk-base.js';
import { TopicWsClient } from '../shared/topic-ws-client.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import {
  parseBybitInstrumentsResponse,
  parseBybitRestTicker,
  parseBybitSystemStatusResponse,
  parseBybitTickersResponse,
  parseBybitWsMessage,
} from './codec.js';
import { deriveBybitHealth } from './health.js';
import {
  BYBIT_MAX_TOPICS_PER_BATCH,
  buildBybitExpiredTopics,
  buildBybitSubscriptionTopics,
  createBybitSubscriptionState,
  resetBybitSubscriptionState,
} from './planner.js';
import { buildBybitRestQuote, buildBybitWsQuote } from './state.js';
import { BYBIT_OPTION_SYMBOL_RE, type BybitInstrument } from './types.js';

const log = feedLogger('bybit');

// Bybit options don't expose per-instrument fees via public API
const BYBIT_DEFAULT_MAKER_FEE = 0.0002;
const BYBIT_DEFAULT_TAKER_FEE = 0.0005;

// Bybit closes idle connections after 30s — ping well within that window
const BYBIT_PING_INTERVAL_MS = 20_000;

/**
 * Bybit options adapter using raw WebSocket + fetch.
 *
 * REST (instrument loading + initial snapshot):
 *   GET /v5/market/instruments-info?category=option
 *   GET /v5/market/tickers?category=option&baseCoin=X
 *
 * WebSocket (live updates):
 *   wss://stream.bybit.com/v5/public/option
 *   Per-instrument topics: tickers.{symbol}
 *   Messages are snapshots — each push replaces the full state.
 *
 * REST vs WS field name differences (both verified 2026-03-20):
 *   REST: bid1Price, ask1Price, bid1Iv, ask1Iv, markIv
 *   WS:   bidPrice,  askPrice,  bidIv,  askIv,  markPriceIv
 *
 * Settlement: USDT-settled, linear. No inverse conversion.
 */
const INSTRUMENT_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const HEALTH_CHECK_INTERVAL_MS = 60 * 1000;

// Bybit requires explicit baseCoin — no wildcard like Deribit's currency:'any'.
// These are all underlyings with active options as of 2026-03-28.
const BASE_COINS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP'] as const;

export class BybitWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'bybit';

  private wsClient: TopicWsClient | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private readonly subscriptions = createBybitSubscriptionState();

  protected initClients(): void {}

  // ── instrument loading ────────────────────────────────────────

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    const instruments: CachedInstrument[] = [];

    // Bybit returns only BTC when baseCoin is omitted — must query each explicitly.
    for (const baseCoin of BASE_COINS) {
      let cursor: string | undefined;

      do {
        const url = new URL(BYBIT_INSTRUMENTS_INFO, BYBIT_REST_BASE_URL);
        url.searchParams.set('category', 'option');
        url.searchParams.set('baseCoin', baseCoin);
        url.searchParams.set('limit', '1000');
        if (cursor) url.searchParams.set('cursor', cursor);

        const raw = await this.fetchJson(url);
        const parsed = parseBybitInstrumentsResponse(raw);

        if (parsed == null) {
          log.warn({ baseCoin }, 'instruments response validation failed');
          break;
        }

        if (parsed.retCode !== 0) {
          log.warn({ baseCoin, msg: parsed.retMsg }, 'instruments request failed');
          break;
        }

        for (const item of parsed.result.list) {
          const inst = this.parseInstrument(item);
          if (inst) instruments.push(inst);
        }

        cursor = parsed.result.nextPageCursor || undefined;
      } while (cursor);
    }

    log.info({ count: instruments.length }, 'loaded option instruments');

    await this.fetchBulkTickers(instruments);

    // Poll for new strikes/expiries every 10 minutes — Bybit has no instrument
    // lifecycle push channel unlike Deribit's instrument.state.
    this.refreshTimer = setInterval(() => {
      void this.refreshInstruments();
    }, INSTRUMENT_REFRESH_INTERVAL_MS);
    this.healthTimer = setInterval(() => {
      void this.refreshHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
    void this.refreshHealth();

    return instruments;
  }

  /**
   * Polls `get_instruments` for each baseCoin and subscribes any symbols
   * not yet in our instrument map. Called every 10 minutes to pick up new
   * strikes and expiries listed after boot without a server restart.
   *
   * Only adds instruments — expired ones are left in place and simply stop
   * receiving ticker pushes, which is harmless for a read-only display.
   */
  private async refreshInstruments(): Promise<void> {
    const activeSymbols = new Set<string>();
    const newInstruments: CachedInstrument[] = [];

    for (const baseCoin of BASE_COINS) {
      try {
        let cursor: string | undefined;

        do {
          const url = new URL(BYBIT_INSTRUMENTS_INFO, BYBIT_REST_BASE_URL);
          url.searchParams.set('category', 'option');
          url.searchParams.set('baseCoin', baseCoin);
          url.searchParams.set('limit', '1000');
          if (cursor) url.searchParams.set('cursor', cursor);

          const raw = await this.fetchJson(url);
          const parsed = parseBybitInstrumentsResponse(raw);
          if (parsed == null || parsed.retCode !== 0) break;

          for (const item of parsed.result.list) {
            if (item.status === 'Trading') activeSymbols.add(item.symbol);
            if (this.instrumentMap.has(item.symbol)) continue;
            if (item.status !== 'Trading') continue;
            const inst = this.parseInstrument(item);
            if (inst) newInstruments.push(inst);
          }

          cursor = parsed.result.nextPageCursor || undefined;
        } while (cursor);
      } catch (err: unknown) {
        log.warn({ baseCoin, err: String(err) }, 'instrument refresh failed');
        // If a baseCoin fetch fails, skip expiry detection for that coin to
        // avoid incorrectly removing instruments we just couldn't reach.
        for (const inst of this.instruments) {
          if (inst.base === baseCoin) activeSymbols.add(inst.exchangeSymbol);
        }
      }
    }

    // Remove instruments no longer present in the active set.
    const expiredSymbols = this.instruments
      .map((i) => i.exchangeSymbol)
      .filter((sym) => !activeSymbols.has(sym));

    if (expiredSymbols.length > 0) {
      const expiredTopics = buildBybitExpiredTopics(this.subscriptions, expiredSymbols);
      const expiredSymbolSet = new Set(expiredSymbols);

      for (const sym of expiredSymbols) {
        const inst = this.instrumentMap.get(sym);
        if (!inst) continue;
        this.instrumentMap.delete(sym);
        this.symbolIndex.delete(inst.symbol);
        this.quoteStore.delete(sym);
      }
      this.instruments = this.instruments.filter((i) => !expiredSymbolSet.has(i.exchangeSymbol));

      if (this.wsClient?.isConnected) {
        for (let i = 0; i < expiredTopics.length; i += BYBIT_MAX_TOPICS_PER_BATCH) {
          this.sendJson({
            op: 'unsubscribe',
            args: expiredTopics.slice(i, i + BYBIT_MAX_TOPICS_PER_BATCH),
          });
        }
      }

      log.info({ count: expiredSymbols.length }, 'removed expired instruments from refresh');
    }

    // Add and subscribe new instruments.
    if (newInstruments.length > 0) {
      for (const inst of newInstruments) {
        this.instruments.push(inst);
        this.instrumentMap.set(inst.exchangeSymbol, inst);
        this.symbolIndex.set(inst.symbol, inst.exchangeSymbol);
      }

      const newTopics = buildBybitSubscriptionTopics(this.subscriptions, newInstruments);

      if (newTopics.length > 0 && this.wsClient?.isConnected) {
        for (let i = 0; i < newTopics.length; i += BYBIT_MAX_TOPICS_PER_BATCH) {
          this.sendJson({
            op: 'subscribe',
            args: newTopics.slice(i, i + BYBIT_MAX_TOPICS_PER_BATCH),
          });
        }
      }

      log.info({ count: newInstruments.length }, 'added new instruments from refresh');
    }
  }

  private parseInstrument(item: BybitInstrument): CachedInstrument | null {
    const match = BYBIT_OPTION_SYMBOL_RE.exec(item.symbol);
    if (!match) return null;

    const base = match[1]!;
    const expiryRaw = match[2]!;
    const strikeStr = match[3]!;
    const expiry = this.parseExpiry(expiryRaw);
    // optionsType from the API ("Call"/"Put") is authoritative over the regex suffix.
    const right = item.optionsType === 'Call' ? ('call' as const) : ('put' as const);
    // item.settleCoin is authoritative — regex suffix is fallback for edge cases
    const settle = item.settleCoin || match[5] || 'USDT';

    return {
      symbol: this.buildCanonicalSymbol(base, settle, expiry, Number(strikeStr), right),
      exchangeSymbol: item.symbol,
      base,
      quote: item.quoteCoin,
      settle,
      expiry,
      strike: Number(strikeStr),
      right,
      inverse: false,
      contractSize: 1,
      contractValueCurrency: base,
      tickSize: this.safeNum(item.priceFilter.tickSize),
      minQty: this.safeNum(item.lotSizeFilter.minOrderQty),
      makerFee: BYBIT_DEFAULT_MAKER_FEE,
      takerFee: BYBIT_DEFAULT_TAKER_FEE,
    };
  }

  // ── initial REST snapshot ─────────────────────────────────────

  private async fetchBulkTickers(instruments: CachedInstrument[]): Promise<void> {
    const baseCoins = [...new Set(instruments.map((i) => i.base))];

    for (const baseCoin of baseCoins) {
      try {
        const url = new URL(BYBIT_TICKERS, BYBIT_REST_BASE_URL);
        url.searchParams.set('category', 'option');
        url.searchParams.set('baseCoin', baseCoin);

        const raw = await this.fetchJson(url);
        const parsed = parseBybitTickersResponse(raw);

        if (parsed == null) {
          log.warn({ baseCoin }, 'tickers validation failed');
          continue;
        }

        if (parsed.retCode !== 0) continue;

        for (const item of parsed.result.list) {
          const ticker = parseBybitRestTicker(item);
          if (ticker == null) continue;
          this.quoteStore.set(
            ticker.symbol,
            buildBybitRestQuote(ticker, (value) => this.safeNum(value)),
          );
        }

        log.info({ count: parsed.result.list.length, baseCoin }, 'fetched tickers');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ baseCoin, err: message }, 'failed to fetch tickers');
      }
    }
  }

  // ── WebSocket connection ──────────────────────────────────────

  protected async subscribeChain(
    _underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    const newTopics = buildBybitSubscriptionTopics(this.subscriptions, instruments);

    if (newTopics.length === 0) return;

    await this.ensureConnected();

    for (let i = 0; i < newTopics.length; i += BYBIT_MAX_TOPICS_PER_BATCH) {
      const batch = newTopics.slice(i, i + BYBIT_MAX_TOPICS_PER_BATCH);
      this.sendJson({ op: 'subscribe', args: batch });
    }

    log.info({ count: newTopics.length }, 'subscribed to option tickers');
  }

  protected override async unsubscribeChain(
    _underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    if (!this.wsClient?.isConnected) return;

    const topics = instruments
      .map((instrument) => `tickers.${instrument.exchangeSymbol}`)
      .filter((topic) => this.subscriptions.subscribedTopics.has(topic));

    if (topics.length === 0) return;

    for (let i = 0; i < topics.length; i += BYBIT_MAX_TOPICS_PER_BATCH) {
      const batch = topics.slice(i, i + BYBIT_MAX_TOPICS_PER_BATCH);
      this.sendJson({ op: 'unsubscribe', args: batch });
      for (const topic of batch) {
        this.subscriptions.subscribedTopics.delete(topic);
      }
    }
  }

  protected async unsubscribeAll(): Promise<void> {
    if (this.subscriptions.subscribedTopics.size === 0 || !this.wsClient?.isConnected) return;

    const topics = [...this.subscriptions.subscribedTopics];
    for (let i = 0; i < topics.length; i += BYBIT_MAX_TOPICS_PER_BATCH) {
      this.sendJson({ op: 'unsubscribe', args: topics.slice(i, i + BYBIT_MAX_TOPICS_PER_BATCH) });
    }
    resetBybitSubscriptionState(this.subscriptions);
  }

  private async ensureConnected(): Promise<void> {
    if (this.wsClient?.isConnected) return;
    await this.connectWs();
  }

  private connectWs(): Promise<void> {
    if (this.wsClient == null) {
      this.wsClient = new TopicWsClient(BYBIT_WS_URL, 'bybit-ws', {
        pingIntervalMs: BYBIT_PING_INTERVAL_MS,
        pingMessage: { op: 'ping' },
        onStatusChange: (state) => {
          this.emitStatus(
            state === 'connected' ? 'connected' : state === 'down' ? 'down' : 'reconnecting',
          );
        },
        getReplayMessages: () => {
          if (this.subscriptions.subscribedTopics.size === 0) return [];
          const messages: Array<Record<string, unknown>> = [];
          const topics = [...this.subscriptions.subscribedTopics];
          for (let index = 0; index < topics.length; index += BYBIT_MAX_TOPICS_PER_BATCH) {
            messages.push({
              op: 'subscribe',
              args: topics.slice(index, index + BYBIT_MAX_TOPICS_PER_BATCH),
            });
          }
          return messages;
        },
        onMessage: (raw) => {
          this.handleRawMessage(raw);
        },
        onOpen: () => {},
      });
    }

    return this.wsClient.connect();
  }

  private async refreshHealth(): Promise<void> {
    try {
      const url = new URL(BYBIT_SYSTEM_STATUS, BYBIT_REST_BASE_URL);
      const raw = await this.fetchJson(url);
      const parsed = parseBybitSystemStatusResponse(raw);
      const health = deriveBybitHealth(parsed);
      this.emitStatus(health.status, health.message);
    } catch (error: unknown) {
      const health = deriveBybitHealth(null, error);
      this.emitStatus(health.status, health.message);
    }
  }

  // ── WS message handling ───────────────────────────────────────

  private handleRawMessage(raw: WebSocket.RawData): void {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString());
    } catch (e: unknown) {
      log.debug({ err: String(e) }, 'malformed WS frame');
      return;
    }

    if (json == null || typeof json !== 'object') return;
    const obj = json as Record<string, unknown>;
    if (obj['op'] === 'subscribe' || obj['op'] === 'pong' || obj['success'] !== undefined) return;

    const msg = parseBybitWsMessage(json);
    if (msg == null) return;
    if (!msg.topic.startsWith('tickers.')) return;

    const exchangeSymbol = msg.data.symbol;
    if (!this.instrumentMap.has(exchangeSymbol)) return;

    this.emitQuoteUpdate(
      exchangeSymbol,
      buildBybitWsQuote(msg.data, msg.ts, (value) => this.safeNum(value)),
    );
  }

  // ── helpers ───────────────────────────────────────────────────

  private async fetchJson(url: URL): Promise<unknown> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Bybit ${url.pathname} returned ${res.status}`);
    return res.json();
  }

  private sendJson(payload: Record<string, unknown>): void {
    this.wsClient?.send(payload);
  }

  override async dispose(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    await this.unsubscribeAll();
    await this.wsClient?.disconnect();
    this.wsClient = null;
  }
}
