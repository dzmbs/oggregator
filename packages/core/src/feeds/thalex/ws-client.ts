import type WebSocket from 'ws';
import { THALEX_INSTRUMENTS, THALEX_MARKET_WS_URL, THALEX_REST_URL, THALEX_SYSTEM_INFO } from '../shared/endpoints.js';
import { SdkBaseAdapter, type CachedInstrument } from '../shared/sdk-base.js';
import { TopicWsClient } from '../shared/topic-ws-client.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import {
  parseThalexInstruments,
  parseThalexSystemInfo,
  parseThalexWsMessage,
} from './codec.js';
import { deriveThalexHealth } from './health.js';
import {
  buildThalexIndexChannel,
  buildThalexNewTickerChannels,
  buildThalexRemovedTickerChannels,
  buildThalexSubscribeMessage,
  buildThalexTickerChannel,
  buildThalexUnsubscribeMessage,
  chunkChannels,
  createThalexSubscriptionState,
  ensureThalexIndexSub,
  resetThalexSubscriptionState,
  THALEX_MAX_CHANNELS_PER_BATCH,
} from './planner.js';
import { buildThalexInstrument, mergeThalexTicker } from './state.js';

const log = feedLogger('thalex');

// Thalex native WebSocket ping from the server keeps the socket alive —
// probe captures confirmed 45s idle with no close. No app-level heartbeat.
const INSTRUMENT_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const HEALTH_CHECK_INTERVAL_MS = 60 * 1000;

// Thalex lists BTC + ETH options. Filter at fetch time so long-tail listings
// (e.g. testnet synthetics) don't bloat the instrument map.
const SUPPORTED_UNDERLYINGS = ['BTC', 'ETH'] as const;

interface ThalexRestEnvelope {
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Thalex options adapter. Public market data only — no auth needed.
 *
 * REST:
 *   GET /public/instruments   — all active instruments
 *   GET /public/system_info   — health probe
 *
 * WebSocket (wss://thalex.com/ws/api/v2):
 *   Per-instrument ticker: ticker.<instrument>.1000ms
 *   Per-underlying index:  price_index.<UNDERLYING> (e.g. price_index.BTCUSD)
 *
 * Subscribe shape is JSON-RPC style:
 *   { "method": "public/subscribe", "id": N, "params": { "channels": [...] } }
 *
 * Notifications arrive as:
 *   { "channel_name": "ticker....", "notification": { ... }, "snapshot"?: true }
 *
 * No app-level heartbeat: server pings, the `ws` client auto-pongs.
 * No known private-auth requirement for public/* channels.
 */
export class ThalexWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'thalex';

  private wsClient: TopicWsClient | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private connectPromise: Promise<void> | null = null;

  private readonly subscriptions = createThalexSubscriptionState();

  protected initClients(): void {}

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    const raw = await this.fetchApi(THALEX_INSTRUMENTS);
    const parsed = parseThalexInstruments(raw);
    if (parsed == null) {
      throw new Error('thalex /public/instruments returned unparseable payload');
    }

    const supported = new Set<string>(SUPPORTED_UNDERLYINGS);
    const instruments: CachedInstrument[] = [];

    for (const item of parsed) {
      if (item.type !== 'option') continue;
      const base = item.instrument_name.split('-')[0];
      if (!base || !supported.has(base)) continue;

      const inst = buildThalexInstrument(item, {
        buildCanonicalSymbol: (b, s, e, k, r) => this.buildCanonicalSymbol(b, s, e, k, r),
        parseExpiry: (r) => this.parseExpiry(r),
      });
      if (inst == null) continue;
      instruments.push(inst);
    }

    log.info({ count: instruments.length }, 'loaded option instruments');

    this.refreshTimer = setInterval(() => {
      void this.refreshInstruments();
    }, INSTRUMENT_REFRESH_INTERVAL_MS);
    this.healthTimer = setInterval(() => {
      void this.refreshHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
    void this.refreshHealth();

    return instruments;
  }

  private async refreshInstruments(): Promise<void> {
    this.sweepExpiredState();

    let parsed;
    try {
      const raw = await this.fetchApi(THALEX_INSTRUMENTS);
      parsed = parseThalexInstruments(raw);
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'instrument refresh failed');
      return;
    }
    if (parsed == null) return;

    const supported = new Set<string>(SUPPORTED_UNDERLYINGS);
    const activeSymbols = new Set<string>();
    const newInstruments: CachedInstrument[] = [];

    for (const item of parsed) {
      if (item.type !== 'option') continue;
      const base = item.instrument_name.split('-')[0];
      if (!base || !supported.has(base)) continue;
      activeSymbols.add(item.instrument_name);

      if (this.instrumentMap.has(item.instrument_name)) continue;
      const inst = buildThalexInstrument(item, {
        buildCanonicalSymbol: (b, s, e, k, r) => this.buildCanonicalSymbol(b, s, e, k, r),
        parseExpiry: (r) => this.parseExpiry(r),
      });
      if (inst == null) continue;
      // Skip instruments already past expiry so sweepExpiredState() can't re-add them.
      if (this.isExpiredInstrument(inst)) continue;
      newInstruments.push(inst);
    }

    const expired = this.instruments.filter((i) => !activeSymbols.has(i.exchangeSymbol));
    if (expired.length > 0) {
      const expiredSymbols = expired.map((i) => i.exchangeSymbol);
      const removed = buildThalexRemovedTickerChannels(this.subscriptions, expiredSymbols);
      if (removed.length > 0 && this.wsClient?.isConnected) {
        for (const batch of chunkChannels(removed, THALEX_MAX_CHANNELS_PER_BATCH)) {
          this.wsClient.send(buildThalexUnsubscribeMessage(this.subscriptions, batch));
        }
      }
      this.removeCachedInstruments((i) => !activeSymbols.has(i.exchangeSymbol));
      log.info({ count: expired.length }, 'removed expired instruments');
    }

    if (newInstruments.length > 0) {
      for (const inst of newInstruments) {
        this.instruments.push(inst);
        this.instrumentMap.set(inst.exchangeSymbol, inst);
        this.symbolIndex.set(inst.symbol, inst.exchangeSymbol);
      }
      log.info({ count: newInstruments.length }, 'added new instruments');
    }
  }

  // ── subscribe / unsubscribe ──────────────────────────────────

  protected async subscribeChain(
    underlying: string,
    expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    if (instruments.length === 0) return;
    await this.ensureConnected();

    // Subscribe to the underlying index once per venue session — covers
    // fallback underlyingPrice when a specific contract hasn't ticked yet.
    const indexUnderlying = `${underlying.toUpperCase()}USD`;
    const indexChannel = ensureThalexIndexSub(this.subscriptions, indexUnderlying);
    if (indexChannel != null) {
      this.wsClient?.send(buildThalexSubscribeMessage(this.subscriptions, [indexChannel]));
    }

    const newChannels = buildThalexNewTickerChannels(this.subscriptions, instruments);
    for (const batch of chunkChannels(newChannels, THALEX_MAX_CHANNELS_PER_BATCH)) {
      this.wsClient?.send(buildThalexSubscribeMessage(this.subscriptions, batch));
    }

    log.info(
      { underlying, expiry, tickers: newChannels.length, index: indexChannel != null ? 1 : 0 },
      'subscribed to chain',
    );
  }

  protected override async unsubscribeChain(
    _underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    if (!this.wsClient?.isConnected) return;
    if (this.activeRequestsForUnderlying(_underlying) > 0) return;

    const removed = buildThalexRemovedTickerChannels(
      this.subscriptions,
      instruments.map((i) => i.exchangeSymbol),
    );
    for (const batch of chunkChannels(removed, THALEX_MAX_CHANNELS_PER_BATCH)) {
      this.wsClient.send(buildThalexUnsubscribeMessage(this.subscriptions, batch));
    }
  }

  protected async unsubscribeAll(): Promise<void> {
    if (!this.wsClient?.isConnected) {
      resetThalexSubscriptionState(this.subscriptions);
      return;
    }
    const tickerChannels = Array.from(this.subscriptions.tickerChannels);
    const indexChannels = Array.from(this.subscriptions.indexUnderlyings);
    const all = [...tickerChannels, ...indexChannels];
    for (const batch of chunkChannels(all, THALEX_MAX_CHANNELS_PER_BATCH)) {
      this.wsClient.send(buildThalexUnsubscribeMessage(this.subscriptions, batch));
    }
    resetThalexSubscriptionState(this.subscriptions);
  }

  // ── WS connection ────────────────────────────────────────────

  private ensureConnected(): Promise<void> {
    if (this.wsClient?.isConnected) return Promise.resolve();
    if (this.connectPromise != null) return this.connectPromise;
    this.connectPromise = this.connectWs().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async connectWs(): Promise<void> {
    if (this.wsClient == null) {
      this.wsClient = new TopicWsClient(THALEX_MARKET_WS_URL, 'thalex-ws', {
        // No pingIntervalMs/pingMessage — Thalex server sends WS pings, and
        // the node `ws` library auto-pongs. App-level heartbeat not required.
        onStatusChange: (state) => {
          this.emitStatus(
            state === 'connected' ? 'connected' : state === 'down' ? 'down' : 'reconnecting',
          );
        },
        getReplayMessages: () => {
          const messages: Array<Record<string, unknown>> = [];
          const indexChannels = Array.from(this.subscriptions.indexUnderlyings);
          for (const batch of chunkChannels(indexChannels, THALEX_MAX_CHANNELS_PER_BATCH)) {
            messages.push(buildThalexSubscribeMessage(this.subscriptions, batch));
          }
          const tickerChannels = Array.from(this.subscriptions.tickerChannels);
          for (const batch of chunkChannels(tickerChannels, THALEX_MAX_CHANNELS_PER_BATCH)) {
            messages.push(buildThalexSubscribeMessage(this.subscriptions, batch));
          }
          return messages;
        },
        onMessage: (raw) => {
          this.handleRawMessage(raw);
        },
      });
    }
    await this.wsClient.connect();
  }

  // ── WS message handling ──────────────────────────────────────

  private handleRawMessage(raw: WebSocket.RawData): void {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString());
    } catch (err: unknown) {
      log.debug({ err: String(err) }, 'malformed WS frame');
      return;
    }

    const dispatch = parseThalexWsMessage(json);
    switch (dispatch.kind) {
      case 'ticker': {
        const { channel_name, notification } = dispatch.message;
        // channel_name = "ticker.<instrument>.<delay>" — strip the suffix.
        const parts = channel_name.split('.');
        if (parts.length < 2) return;
        const exchangeSymbol = parts.slice(1, parts.length - 1).join('.') || parts[1]!;
        const inst = this.instrumentMap.get(exchangeSymbol);
        if (inst == null) return;
        const previous = this.quoteStore.get(exchangeSymbol);
        const quote = mergeThalexTicker(notification, previous, this.emptyQuote(), inst);
        this.emitQuoteUpdate(exchangeSymbol, quote);
        return;
      }
      case 'index': {
        // price_index updates don't create quotes directly; tickers already
        // carry the spot reference. Kept for diagnostics + future cross-ref.
        return;
      }
      case 'ack': {
        log.debug({ channels: dispatch.message.result.length }, 'subscribe ack');
        return;
      }
      case 'error': {
        log.warn({ err: dispatch.message.error }, 'thalex RPC error');
        return;
      }
      case 'unknown':
      default:
        return;
    }
  }

  private sweepExpiredState(): void {
    const removed = this.sweepExpiredInstruments();
    if (removed.length === 0) return;

    const removedChannels = buildThalexRemovedTickerChannels(
      this.subscriptions,
      removed.map((i) => i.exchangeSymbol),
    );
    if (removedChannels.length > 0 && this.wsClient?.isConnected) {
      for (const batch of chunkChannels(removedChannels, THALEX_MAX_CHANNELS_PER_BATCH)) {
        this.wsClient.send(buildThalexUnsubscribeMessage(this.subscriptions, batch));
      }
    }

    log.info({ count: removed.length }, 'removed expired instruments');
  }

  // ── REST helpers ─────────────────────────────────────────────

  private async fetchApi(path: string): Promise<unknown> {
    const res = await fetch(`${THALEX_REST_URL}${path}`);
    if (!res.ok) throw new Error(`thalex ${path} returned ${res.status}`);
    const body = (await res.json()) as ThalexRestEnvelope;
    if (body.error != null) {
      throw new Error(`thalex ${path} error ${body.error.code}: ${body.error.message}`);
    }
    return body.result;
  }

  private async refreshHealth(): Promise<void> {
    try {
      const raw = await this.fetchApi(THALEX_SYSTEM_INFO);
      const info = parseThalexSystemInfo(raw);
      const health = deriveThalexHealth(info, this.instruments.length);
      this.emitStatus(health.status, health.message);
    } catch (error: unknown) {
      const health = deriveThalexHealth(null, this.instruments.length, error);
      this.emitStatus(health.status, health.message);
    }
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
