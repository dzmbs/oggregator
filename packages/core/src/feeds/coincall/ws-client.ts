import { createHmac } from 'node:crypto';
import type WebSocket from 'ws';
import {
  COINCALL_CONFIG,
  COINCALL_INSTRUMENTS,
  COINCALL_MARKET_WS_URL,
  COINCALL_REST_BASE_URL,
  COINCALL_TIME,
} from '../shared/endpoints.js';
import { SdkBaseAdapter, type CachedInstrument, type LiveQuote } from '../shared/sdk-base.js';
import { TopicWsClient } from '../shared/topic-ws-client.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import {
  parseCoincallBsInfoMessage,
  parseCoincallInstruments,
  parseCoincallOrderBookMessage,
  parseCoincallPublicConfig,
  parseCoincallTOptionMessage,
  parseCoincallTime,
} from './codec.js';
import { deriveCoincallHealth } from './health.js';
import {
  buildBsInfoSubscribeMessage,
  buildBsInfoUnsubscribeMessage,
  buildCoincallNewBsInfoSymbols,
  buildCoincallNewOrderBookSymbols,
  buildCoincallRemovedBsInfoSymbols,
  buildCoincallRemovedOrderBookSymbols,
  buildOrderBookSubscribeMessage,
  buildOrderBookUnsubscribeMessage,
  buildTOptionSubscribeMessage,
  buildTOptionUnsubscribeMessage,
  COINCALL_MAX_SUBS_PER_BATCH,
  createCoincallSubscriptionState,
  ensureCoincallTOptionSub,
  pairRootFor,
  removeCoincallTOptionSub,
  resetCoincallSubscriptionState,
} from './planner.js';
import {
  buildCoincallInstrument,
  mergeCoincallBsInfo,
  mergeCoincallOrderBook,
  mergeCoincallTOption,
} from './state.js';
import type { CoincallOptionConfigEntry } from './types.js';

const log = feedLogger('coincall');

const ERROR_LOG_TTL_MS = 60_000;
const MAX_UNIQUE_ERRORS = 100;

interface ErrorLogEntry {
  key: string;
  lastLogged: number;
}

const errorLogCache: ErrorLogEntry[] = [];

function shouldLogValidationError(key: string): boolean {
  const now = Date.now();
  const existing = errorLogCache.find((e) => e.key === key);
  if (existing) {
    if (now - existing.lastLogged > ERROR_LOG_TTL_MS) {
      existing.lastLogged = now;
      return true;
    }
    return false;
  }
  if (errorLogCache.length >= MAX_UNIQUE_ERRORS) {
    errorLogCache.shift();
  }
  errorLogCache.push({ key, lastLogged: now });
  return true;
}

// Coincall closes idle connections after 30s — heartbeat well within.
const COINCALL_PING_INTERVAL_MS = 15_000;
const INSTRUMENT_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const HEALTH_CHECK_INTERVAL_MS = 60 * 1000;

// Full Coincall optionConfig (21 pairs). Long-tail pairs (ORDI/KAS/MNT/etc.)
// will be CoinCall-only rows in cross-venue chains. The normalization pipeline
// is generic (symbol regex matches any [A-Z]+USD, strike accepts decimals,
// IV is fractions, multiplier defaults to 1), so adding pairs costs nothing
// beyond bandwidth.
const SUPPORTED_UNDERLYINGS = [
  'BTC',
  'ETH',
  'SOL',
  'BNB',
  'DOGE',
  'XRP',
  'LTC',
  'HYPE',
  'SUI',
  'XAUT',
  'AAVE',
  'TRX',
  'MATIC',
  'ORDI',
  'MNT',
  'WLFI',
  'ENA',
  'PENDLE',
  'LIT',
  'TRUMP',
  'KAS',
] as const;

function payloadShape(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    const first = value[0];
    return {
      kind: 'array',
      length: value.length,
      firstKeys:
        first != null && typeof first === 'object' ? Object.keys(first as Record<string, unknown>) : [],
    };
  }
  if (value != null && typeof value === 'object') {
    return { kind: 'object', keys: Object.keys(value as Record<string, unknown>) };
  }
  return { kind: typeof value };
}

interface CoincallEnvelope {
  code?: number;
  msg?: string | null;
  i18nArgs?: unknown;
  data?: unknown;
}

/**
 * Coincall options adapter.
 *
 * REST:
 *   GET /time
 *   GET /open/public/config/v1     — fee/multiplier/settle per pair
 *   GET /open/option/getInstruments/{base}
 *
 * WebSocket (wss://ws.coincall.com/options):
 *   Public market channels (bsInfo, tOption, orderBook, kline, lastTrade)
 *   all share one authenticated endpoint. Signing is required even for
 *   market data — see buildSignedWsUrl().
 *
 *   We use three complementary subscriptions per active chain:
 *     - bsInfo per instrument (markPrice, iv, delta/gamma/theta/vega, oi, up)
 *     - tOption per base+expiry (bid/ask/bs/as/biv/aiv across the chain)
 *     - orderBook per instrument as a fallback when tOption is incomplete
 *   state.ts merges them into a single LiveQuote per exchangeSymbol.
 *
 * Heartbeat: send {"action":"heartbeat"} every 15s, ack is {"c":11,"rc":1}.
 *
 * If COINCALL_API_KEY / COINCALL_API_SECRET are not present in the
 * environment, fetchInstruments throws before registerAdapter is called,
 * and the adapter is skipped for this process. Other venues keep working.
 */
export class CoincallWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'coincall';

  private wsClient: TopicWsClient | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  private readonly subscriptions = createCoincallSubscriptionState();
  private optionConfig: Record<string, CoincallOptionConfigEntry> = {};
  // pairRoot (e.g. "BTCUSD") + expiry (YYYY-MM-DD) → expirationTimestamp ms.
  // Populated when building instruments so tOption subs know the `end` param.
  private readonly expiryTsIndex = new Map<string, number>();
  private connectPromise: Promise<void> | null = null;

  protected initClients(): void {}

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    const apiKey = process.env['COINCALL_API_KEY'];
    const apiSecret = process.env['COINCALL_API_SECRET'];
    if (!apiKey || !apiSecret) {
      throw new Error(
        'COINCALL_API_KEY/COINCALL_API_SECRET missing — Coincall public WS requires signed auth',
      );
    }

    const configRaw = await this.fetchApi(COINCALL_CONFIG);
    const config = parseCoincallPublicConfig(configRaw);
    if (config == null) {
      throw new Error('coincall /open/public/config/v1 returned unparseable payload');
    }
    this.optionConfig = config.optionConfig;

    const instruments: CachedInstrument[] = [];
    for (const base of SUPPORTED_UNDERLYINGS) {
      if (!this.optionConfig[`${base}USD`]) continue;
      try {
        const raw = await this.fetchApi(`${COINCALL_INSTRUMENTS}/${base}`);
        const parsed = parseCoincallInstruments(raw);
        if (parsed == null) {
          log.warn({ base }, 'instruments validation failed');
          continue;
        }
        for (const item of parsed) {
          const inst = buildCoincallInstrument(item, this.optionConfig, {
            buildCanonicalSymbol: (b, s, e, k, r) => this.buildCanonicalSymbol(b, s, e, k, r),
            parseExpiry: (raw) => this.parseExpiry(raw),
          });
          if (inst == null) continue;
          instruments.push(inst);
          this.expiryTsIndex.set(this.expiryKey(inst.base, inst.expiry), item.expirationTimestamp);
        }
      } catch (err: unknown) {
        log.warn({ base, err: String(err) }, 'failed to load instruments');
      }
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

    const activeSymbols = new Set<string>();
    const newInstruments: CachedInstrument[] = [];

    for (const base of SUPPORTED_UNDERLYINGS) {
      if (!this.optionConfig[`${base}USD`]) continue;
      try {
        const raw = await this.fetchApi(`${COINCALL_INSTRUMENTS}/${base}`);
        const parsed = parseCoincallInstruments(raw);
        if (parsed == null) continue;
        for (const item of parsed) {
          if (item.isActive) activeSymbols.add(item.symbolName);
          if (this.instrumentMap.has(item.symbolName)) continue;
          if (!item.isActive) continue;
          const inst = buildCoincallInstrument(item, this.optionConfig, {
            buildCanonicalSymbol: (b, s, e, k, r) => this.buildCanonicalSymbol(b, s, e, k, r),
            parseExpiry: (raw) => this.parseExpiry(raw),
          });
          if (inst == null) continue;
          // Skip already-expired instruments so sweepExpiredState() can't re-add them.
          if (this.isExpiredInstrument(inst)) continue;
          newInstruments.push(inst);
          this.expiryTsIndex.set(this.expiryKey(inst.base, inst.expiry), item.expirationTimestamp);
        }
      } catch (err: unknown) {
        log.warn({ base, err: String(err) }, 'instrument refresh failed');
        for (const inst of this.instruments) {
          if (inst.base === base) activeSymbols.add(inst.exchangeSymbol);
        }
      }
    }

    const expired = this.instruments.filter((i) => !activeSymbols.has(i.exchangeSymbol));
    if (expired.length > 0) {
      const expiredSymbols = expired.map((i) => i.exchangeSymbol);
      const removedBsInfo = buildCoincallRemovedBsInfoSymbols(this.subscriptions, expiredSymbols);
      const removedOrderBook = buildCoincallRemovedOrderBookSymbols(this.subscriptions, expiredSymbols);
      if (this.wsClient?.isConnected) {
        for (const sym of removedBsInfo) this.wsClient.send(buildBsInfoUnsubscribeMessage(sym));
        for (const sym of removedOrderBook) this.wsClient.send(buildOrderBookUnsubscribeMessage(sym));
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

    // tOption first: it carries bid/ask/biv/aiv for the whole chain. Sending it
    // ahead of the bsInfo flood means the snapshot lands before per-instrument
    // greeks start triggering emits with null bidIv/askIv.
    const pairRoot = pairRootFor(underlying);
    const expiryTs = this.expiryTsIndex.get(this.expiryKey(underlying, expiry));
    if (expiryTs == null) {
      log.warn({ underlying, expiry }, 'missing tOption expiry timestamp for Coincall chain');
    }
    if (expiryTs != null && ensureCoincallTOptionSub(this.subscriptions, pairRoot, expiryTs)) {
      this.wsClient?.send(buildTOptionSubscribeMessage(pairRoot, expiryTs));
    }

    const newBsInfoSymbols = buildCoincallNewBsInfoSymbols(this.subscriptions, instruments);
    const requestKey = `${underlying}:${expiry}`;
    const shouldUseOrderBook = (this.requestRefCounts.get(requestKey) ?? 0) > 0;
    const newOrderBookSymbols = shouldUseOrderBook
      ? buildCoincallNewOrderBookSymbols(this.subscriptions, instruments)
      : [];

    for (const batchStart of indexBatches(newBsInfoSymbols.length, COINCALL_MAX_SUBS_PER_BATCH)) {
      for (let i = batchStart.start; i < batchStart.end; i++) {
        const symbol = newBsInfoSymbols[i]!;
        this.wsClient?.send(buildBsInfoSubscribeMessage(symbol));
      }
    }
    for (const batchStart of indexBatches(newOrderBookSymbols.length, COINCALL_MAX_SUBS_PER_BATCH)) {
      for (let i = batchStart.start; i < batchStart.end; i++) {
        const symbol = newOrderBookSymbols[i]!;
        this.wsClient?.send(buildOrderBookSubscribeMessage(symbol));
      }
    }

    log.info(
      {
        underlying,
        expiry,
        bsInfo: newBsInfoSymbols.length,
        orderBook: newOrderBookSymbols.length,
        tOption: expiryTs != null ? 1 : 0,
      },
      'subscribed to chain',
    );
  }

  protected override async unsubscribeChain(
    underlying: string,
    expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    if (!this.wsClient?.isConnected) return;
    if (this.activeRequestsForUnderlying(underlying) > 0) return;

    const removed = buildCoincallRemovedBsInfoSymbols(
      this.subscriptions,
      instruments.map((i) => i.exchangeSymbol),
    );
    for (const sym of removed) {
      this.wsClient.send(buildBsInfoUnsubscribeMessage(sym));
    }

    const removedOrderBook = buildCoincallRemovedOrderBookSymbols(
      this.subscriptions,
      instruments.map((i) => i.exchangeSymbol),
    );
    for (const sym of removedOrderBook) {
      this.wsClient.send(buildOrderBookUnsubscribeMessage(sym));
    }

    const pairRoot = pairRootFor(underlying);
    const expiryTs = this.expiryTsIndex.get(this.expiryKey(underlying, expiry));
    if (expiryTs != null && removeCoincallTOptionSub(this.subscriptions, pairRoot, expiryTs)) {
      this.wsClient.send(buildTOptionUnsubscribeMessage(pairRoot, expiryTs));
    }
  }

  protected async unsubscribeAll(): Promise<void> {
    if (!this.wsClient?.isConnected) {
      resetCoincallSubscriptionState(this.subscriptions);
      return;
    }
    for (const sym of this.subscriptions.bsInfoSymbols) {
      this.wsClient.send(buildBsInfoUnsubscribeMessage(sym));
    }
    for (const sym of this.subscriptions.orderBookSymbols) {
      this.wsClient.send(buildOrderBookUnsubscribeMessage(sym));
    }
    for (const key of this.subscriptions.tOptionKeys) {
      const [pairRoot, tsRaw] = key.split(':');
      const ts = Number(tsRaw);
      if (pairRoot && Number.isFinite(ts)) {
        this.wsClient.send(buildTOptionUnsubscribeMessage(pairRoot, ts));
      }
    }
    resetCoincallSubscriptionState(this.subscriptions);
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
    const url = buildSignedWsUrl();
    if (this.wsClient == null) {
      this.wsClient = new TopicWsClient(url, 'coincall-ws', {
        pingIntervalMs: COINCALL_PING_INTERVAL_MS,
        pingMessage: { action: 'heartbeat' },
        onStatusChange: (state) => {
          this.emitStatus(
            state === 'connected' ? 'connected' : state === 'down' ? 'down' : 'reconnecting',
          );
        },
        getReplayMessages: () => {
          // Replay tOption first so chain-level bid/ask/biv/aiv snapshots land
          // before bsInfo emits start overwriting quotes with null IV spreads.
          const messages: Array<Record<string, unknown>> = [];
          for (const key of this.subscriptions.tOptionKeys) {
            const [pairRoot, tsRaw] = key.split(':');
            const ts = Number(tsRaw);
            if (pairRoot && Number.isFinite(ts)) {
              messages.push(buildTOptionSubscribeMessage(pairRoot, ts));
            }
          }
          for (const sym of this.subscriptions.bsInfoSymbols) {
            messages.push(buildBsInfoSubscribeMessage(sym));
          }
          for (const sym of this.subscriptions.orderBookSymbols) {
            messages.push(buildOrderBookSubscribeMessage(sym));
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
    const rawText = raw.toString();
    try {
      json = JSON.parse(rawText);
    } catch (err: unknown) {
      log.debug({ err: String(err) }, 'malformed WS frame');
      return;
    }
    if (json == null || typeof json !== 'object') return;

    const envelope = json as Record<string, unknown>;
    const dt = envelope['dt'];
    const rc = envelope['rc'];
    const debugWs = process.env['COINCALL_DEBUG_WS'] === '1';

    if (debugWs && (dt === 4 || envelope['c'] === 20)) {
      log.debug({ dt, c: envelope['c'], rc, shape: payloadShape(envelope['d']), raw: rawText }, 'Coincall WS frame');
    }

    if (typeof rc === 'number' && rc !== 1) {
      log.warn(
        { rc, c: envelope['c'], dt, shape: payloadShape(envelope['d']) },
        'Coincall WS request returned non-success rc',
      );
    }

    if (dt === 3) {
      const msg = parseCoincallBsInfoMessage(json);
      if (msg == null) {
        const errKey = `bsInfo:${JSON.stringify(payloadShape(envelope['d']))}`;
        if (shouldLogValidationError(errKey)) {
          log.warn({ shape: payloadShape(envelope['d']) }, 'Coincall bsInfo validation failed');
        }
        return;
      }
      const inst = this.instrumentMap.get(msg.d.s);
      if (inst == null) return;
      const previous = this.quoteStore.get(msg.d.s);
      const quote = mergeCoincallBsInfo(msg.d, inst, previous, this.emptyQuote());
      this.emitQuoteUpdate(msg.d.s, quote);
      return;
    }

    if (dt === 4) {
      const msg = parseCoincallTOptionMessage(json);
      if (msg == null) {
        const errKey = `tOption:${JSON.stringify(payloadShape(envelope['d']))}`;
        if (shouldLogValidationError(errKey)) {
          log.warn({ shape: payloadShape(envelope['d']) }, 'Coincall tOption validation failed');
        }
        return;
      }
      const updates: Array<{ exchangeSymbol: string; quote: LiveQuote }> = [];
      for (const entry of msg.d) {
        const inst = this.instrumentMap.get(entry.s);
        if (inst == null) continue;
        const previous = this.quoteStore.get(entry.s);
        const quote = mergeCoincallTOption(entry, inst, previous, this.emptyQuote());
        updates.push({ exchangeSymbol: entry.s, quote });
      }
      if (updates.length === 0 && msg.d.length > 0) {
        log.debug(
          {
            firstSymbol: msg.d[0]?.s,
            shape: payloadShape(msg.d),
          },
          'Coincall tOption entries did not match known instruments',
        );
      }
      if (updates.length > 0) this.emitQuoteUpdates(updates);
      return;
    }

    if (dt === 5) {
      const msg = parseCoincallOrderBookMessage(json);
      if (msg == null) {
        const errKey = `orderBook:${JSON.stringify(payloadShape(envelope['d']))}`;
        if (shouldLogValidationError(errKey)) {
          log.warn({ shape: payloadShape(envelope['d']) }, 'Coincall orderBook validation failed');
        }
        return;
      }
      const inst = this.instrumentMap.get(msg.d.s);
      if (inst == null) return;
      const previous = this.quoteStore.get(msg.d.s);
      const quote = mergeCoincallOrderBook(msg.d, inst, previous, this.emptyQuote());
      this.emitQuoteUpdate(msg.d.s, quote);
      return;
    }

    // Heartbeat ack ({c:11, rc:1}) and subscribe acks ({c:20 shape variants})
    // are ignored intentionally — TopicWsClient handles reconnect, and we
    // trust our local subscription state as the source of truth.
  }

  // ── REST helpers ─────────────────────────────────────────────

  private async fetchApi(path: string): Promise<unknown> {
    const res = await fetch(`${COINCALL_REST_BASE_URL}${path}`);
    if (!res.ok) throw new Error(`coincall ${path} returned ${res.status}`);
    const body = (await res.json()) as CoincallEnvelope;
    if (body.code !== 0) {
      throw new Error(`coincall ${path} code=${body.code} msg=${body.msg ?? ''}`);
    }
    return body.data;
  }

  private async refreshHealth(): Promise<void> {
    try {
      const [timeRaw, configRaw] = await Promise.all([
        this.fetchApi(COINCALL_TIME),
        this.fetchApi(COINCALL_CONFIG),
      ]);
      const health = deriveCoincallHealth(
        parseCoincallTime(timeRaw),
        parseCoincallPublicConfig(configRaw),
      );
      this.emitStatus(health.status, health.message);
    } catch (error: unknown) {
      const health = deriveCoincallHealth(null, null, error);
      this.emitStatus(health.status, health.message);
    }
  }

  private expiryKey(base: string, expiry: string): string {
    return `${base.toUpperCase()}:${expiry}`;
  }

  private sweepExpiredState(): void {
    const removed = this.sweepExpiredInstruments();
    if (removed.length === 0) return;

    const removedSymbols = removed.map((i) => i.exchangeSymbol);
    const removedBsInfo = buildCoincallRemovedBsInfoSymbols(this.subscriptions, removedSymbols);
    const removedOrderBook = buildCoincallRemovedOrderBookSymbols(this.subscriptions, removedSymbols);

    if (this.wsClient?.isConnected) {
      for (const sym of removedBsInfo) this.wsClient.send(buildBsInfoUnsubscribeMessage(sym));
      for (const sym of removedOrderBook) this.wsClient.send(buildOrderBookUnsubscribeMessage(sym));
    }

    // Drop tOption subs for any (pairRoot, expiryTs) pair that no longer has
    // live instruments — otherwise Coincall keeps streaming chain-level ticks
    // for a settled expiry until the next chain-level unsubscribe.
    const remainingPairExpiries = new Set<string>();
    for (const inst of this.instruments) {
      const ts = this.expiryTsIndex.get(this.expiryKey(inst.base, inst.expiry));
      if (ts != null) remainingPairExpiries.add(`${pairRootFor(inst.base)}:${ts}`);
    }
    for (const inst of removed) {
      const ts = this.expiryTsIndex.get(this.expiryKey(inst.base, inst.expiry));
      if (ts == null) continue;
      const pairRoot = pairRootFor(inst.base);
      const key = `${pairRoot}:${ts}`;
      if (remainingPairExpiries.has(key)) continue;
      if (removeCoincallTOptionSub(this.subscriptions, pairRoot, ts) && this.wsClient?.isConnected) {
        this.wsClient.send(buildTOptionUnsubscribeMessage(pairRoot, ts));
      }
      this.expiryTsIndex.delete(this.expiryKey(inst.base, inst.expiry));
    }

    log.info({ count: removed.length }, 'removed expired instruments');
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

// ── module-private helpers ────────────────────────────────────

/**
 * Coincall WS signing (from official Python SDK & cc-docs):
 *   sign = HMAC-SHA256(secret, "GET/users/self/verify?uuid={apiKey}&ts={ms}"), uppercase hex
 *   url  = wss://ws.coincall.com/options
 *          ?code=10&uuid={apiKey}&ts={ms}&sign={sign}&apiKey={apiKey}
 * Built fresh every connect — `ts` becomes stale otherwise.
 */
export function buildSignedWsUrl(now: () => number = Date.now): string {
  const apiKey = process.env['COINCALL_API_KEY'];
  const apiSecret = process.env['COINCALL_API_SECRET'];
  if (!apiKey || !apiSecret) {
    throw new Error('COINCALL_API_KEY/COINCALL_API_SECRET required for Coincall WS');
  }
  const ts = now();
  const payload = `GET/users/self/verify?uuid=${apiKey}&ts=${ts}`;
  const sign = createHmac('sha256', apiSecret).update(payload).digest('hex').toUpperCase();
  // Concatenate raw (unencoded) — server verifies signature against the raw
  // query string. URLSearchParams would percent-encode the trailing `=` in
  // base64-shaped apiKey/uuid values, breaking the signature → 403.
  return (
    `${COINCALL_MARKET_WS_URL}` +
    `?code=10` +
    `&uuid=${apiKey}` +
    `&ts=${ts}` +
    `&sign=${sign}` +
    `&apiKey=${apiKey}`
  );
}

function* indexBatches(total: number, size: number): Generator<{ start: number; end: number }> {
  for (let start = 0; start < total; start += size) {
    yield { start, end: Math.min(start + size, total) };
  }
}
