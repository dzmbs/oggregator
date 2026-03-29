import WebSocket from 'ws';
import pino from 'pino';
import { logger } from '../../utils/logger.js';
import { backoffDelay } from '../../utils/reconnect.js';

/**
 * Shared JSON-RPC 2.0 over WebSocket base for Deribit and Derive.
 * Handles: connection lifecycle, heartbeat, reconnection,
 * request/response correlation, and subscription dispatch.
 */
const RETRY_AFTER_MAX_ATTEMPTS_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_HEARTBEAT_INTERVAL_SEC = 30;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 20;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const DEFAULT_RESUBSCRIBE_BATCH_SIZE = 200;
const DEFAULT_RESUBSCRIBE_BATCH_DELAY_MS = 350;
const SEC_TO_MS = 1_000;

interface JsonRpcPendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JsonRpcMessage {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string };
  params?: { channel?: string; data?: unknown; type?: string };
}

function isConnectionClosedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('connection closed');
}

export class JsonRpcWsClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, JsonRpcPendingRequest>();
  private subscriptionHandler: ((channel: string, data: unknown) => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private subscribedChannels = new Set<string>();
  private heartbeatToken = 0;
  private log: pino.Logger;

  constructor(
    private readonly url: string,
    private readonly label: string,
    private readonly options: {
      heartbeatIntervalSec?: number;
      requestTimeoutMs?: number;
      maxReconnectAttempts?: number;
      reconnectDelayMs?: number;
      subscribeMethod?: string;
      unsubscribeMethod?: string;
      unsubscribeAllMethod?: string;
      resubscribeBatchSize?: number;
      resubscribeBatchDelayMs?: number;
      onStatusChange?: (state: 'connected' | 'reconnecting' | 'down') => void;
    } = {},
  ) {
    this.log = logger.child({ component: this.label });
  }

  // ─── connection lifecycle ─────────────────────────────────────

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.shouldReconnect = true;
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        this.log.info({ url: this.url }, 'ws connected');
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.options.onStatusChange?.('connected');
        resolve();
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(raw.toString()) as JsonRpcMessage;
          this.handleMessage(msg);
        } catch (e: unknown) { this.log.debug({ err: String(e) }, 'malformed WS frame'); }
      });

      this.ws.on('close', () => {
        this.log.warn('ws closed');
        this.cleanup();
        this.options.onStatusChange?.('reconnecting');
        if (this.shouldReconnect) this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        this.log.error({ err: err.message }, 'ws error');
        if (this.ws?.readyState !== WebSocket.OPEN) reject(err);
      });
    });
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ─── JSON-RPC request/response ────────────────────────────────

  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.isConnected) throw new Error(`[${this.label}] not connected`);

    const id = this.nextId++;
    const timeout = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[${this.label}] ${method} timed out after ${timeout}ms`));
      }, timeout);

      this.pending.set(id, { resolve, reject, timer });

      this.ws!.send(JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      }));
    });
  }

  // ─── subscriptions ────────────────────────────────────────────

  onSubscription(handler: (channel: string, data: unknown) => void): void {
    this.subscriptionHandler = handler;
  }

  async subscribe(channels: string[]): Promise<void> {
    const method = this.options.subscribeMethod ?? 'public/subscribe';
    const added: string[] = [];

    for (const channel of channels) {
      if (this.subscribedChannels.has(channel)) continue;
      this.subscribedChannels.add(channel);
      added.push(channel);
    }

    try {
      await this.call(method, { channels });
    } catch (error: unknown) {
      if (!isConnectionClosedError(error)) {
        for (const channel of added) {
          this.subscribedChannels.delete(channel);
        }
      }
      throw error;
    }
  }

  async unsubscribe(channels: string[]): Promise<void> {
    if (!this.isConnected) return;
    const method = this.options.unsubscribeMethod ?? 'public/unsubscribe';
    try {
      await this.call(method, { channels });
    } catch (e: unknown) { this.log.debug({ err: String(e) }, 'unsubscribe failed'); }
    for (const channel of channels) {
      this.subscribedChannels.delete(channel);
    }
  }

  async unsubscribeAll(): Promise<void> {
    if (!this.isConnected) return;
    const method = this.options.unsubscribeAllMethod ?? 'public/unsubscribe_all';
    try {
      await this.call(method, {});
    } catch (e: unknown) { this.log.debug({ err: String(e) }, 'unsubscribe_all failed'); }
    this.subscribedChannels.clear();
  }

  // ─── message dispatch ─────────────────────────────────────────

  private handleMessage(msg: JsonRpcMessage): void {
    if (msg.id != null && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);

      if (msg.error) {
        entry.reject(new Error(`[${this.label}] RPC error ${msg.error.code}: ${msg.error.message}`));
      } else {
        entry.resolve(msg.result);
      }
      return;
    }

    // Heartbeat test_request — must respond with public/test
    if (msg.method === 'heartbeat' && msg.params?.type === 'test_request') {
      this.ws?.send(JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'public/test',
        params: {},
      }));
      return;
    }

    if (msg.method === 'subscription' && msg.params) {
      const channel = msg.params.channel;
      const data = msg.params.data;
      if (channel != null && this.subscriptionHandler) {
        this.subscriptionHandler(channel, data);
      }
      return;
    }
  }

  // ─── heartbeat ────────────────────────────────────────────────

  private startHeartbeat(): void {
    const interval = this.options.heartbeatIntervalSec ?? DEFAULT_HEARTBEAT_INTERVAL_SEC;
    const heartbeatToken = ++this.heartbeatToken;

    this.call('public/set_heartbeat', { interval }).catch(() => {
      if (heartbeatToken !== this.heartbeatToken || !this.shouldReconnect) return;

      // Derive doesn't support set_heartbeat — use ping/pong instead.
      this.heartbeatTimer = setInterval(() => {
        if (this.isConnected) this.ws!.ping();
      }, interval * SEC_TO_MS);
    });
  }

  // ─── reconnection ────────────────────────────────────────────

  private scheduleReconnect(): void {
    const maxAttempts = this.options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    const exceededMaxAttempts = this.reconnectAttempts >= maxAttempts;
    const delay = exceededMaxAttempts
      ? RETRY_AFTER_MAX_ATTEMPTS_MS
      : backoffDelay(this.reconnectAttempts, this.options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS);

    this.reconnectAttempts += 1;

    if (exceededMaxAttempts) {
      this.log.error({ maxAttempts, delayMs: delay }, 'max reconnect attempts reached, switching to periodic retry');
      this.options.onStatusChange?.('down');
    } else {
      this.log.info({ delayMs: delay, attempt: this.reconnectAttempts }, 'reconnecting');
    }

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        await this.resubscribe();
      } catch (e: unknown) {
        this.log.warn({ err: String(e) }, 'reconnect failed');
        if (this.shouldReconnect) this.scheduleReconnect();
      }
    }, delay);
  }

  /** Re-subscribe in batches to stay within exchange rate limits on reconnect. */
  private async resubscribe(): Promise<void> {
    if (this.subscribedChannels.size === 0) return;

    const method = this.options.subscribeMethod ?? 'public/subscribe';
    const batchSize = this.options.resubscribeBatchSize ?? DEFAULT_RESUBSCRIBE_BATCH_SIZE;
    const delayMs = this.options.resubscribeBatchDelayMs ?? DEFAULT_RESUBSCRIBE_BATCH_DELAY_MS;
    const channels = [...this.subscribedChannels.values()];
    this.log.info({ count: channels.length }, 're-subscribing to channels');

    for (let i = 0; i < channels.length; i += batchSize) {
      const batch = channels.slice(i, i + batchSize);
      await this.call(method, { channels: batch });
      if (i + batchSize < channels.length) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  private cleanup(): void {
    this.heartbeatToken += 1;
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    for (const [, { reject, timer }] of this.pending) {
      clearTimeout(timer);
      reject(new Error(`[${this.label}] connection closed`));
    }
    this.pending.clear();
  }
}
