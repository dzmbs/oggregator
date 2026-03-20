import WebSocket from 'ws';
import pino from 'pino';
import { logger } from '../../utils/logger.js';

/**
 * Shared JSON-RPC 2.0 over WebSocket base for Deribit and Derive.
 * Handles: connection lifecycle, heartbeat, reconnection,
 * request/response correlation, and subscription dispatch.
 */
export class JsonRpcWsClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }>();
  private subscriptionHandler: ((channel: string, data: any) => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private subscribedChannels: string[] = [];
  private log: pino.Logger;

  constructor(
    private readonly url: string,
    private readonly label: string,
    private readonly options: {
      heartbeatIntervalSec?: number;
      requestTimeoutMs?: number;
      maxReconnectAttempts?: number;
      reconnectDelayMs?: number;
      /** Override subscribe/unsubscribe method names (Derive uses 'subscribe', Deribit uses 'public/subscribe') */
      subscribeMethod?: string;
      unsubscribeMethod?: string;
      unsubscribeAllMethod?: string;
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
        resolve();
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(msg);
        } catch (e: unknown) { this.log.debug({ err: String(e) }, 'malformed WS frame'); }
      });

      this.ws.on('close', () => {
        this.log.warn('ws closed');
        this.cleanup();
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

  async call(method: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.isConnected) throw new Error(`[${this.label}] not connected`);

    const id = this.nextId++;
    const timeout = this.options.requestTimeoutMs ?? 30_000;

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

  onSubscription(handler: (channel: string, data: any) => void): void {
    this.subscriptionHandler = handler;
  }

  async subscribe(channels: string[]): Promise<void> {
    const method = this.options.subscribeMethod ?? 'public/subscribe';
    const result = await this.call(method, { channels });
    for (const ch of channels) {
      if (!this.subscribedChannels.includes(ch)) {
        this.subscribedChannels.push(ch);
      }
    }
    return result;
  }

  async unsubscribe(channels: string[]): Promise<void> {
    if (!this.isConnected) return;
    const method = this.options.unsubscribeMethod ?? 'public/unsubscribe';
    try {
      await this.call(method, { channels });
    } catch (e: unknown) { this.log.debug({ err: String(e) }, 'unsubscribe failed'); }
    this.subscribedChannels = this.subscribedChannels.filter(c => !channels.includes(c));
  }

  async unsubscribeAll(): Promise<void> {
    if (!this.isConnected) return;
    const method = this.options.unsubscribeAllMethod ?? 'public/unsubscribe_all';
    try {
      await this.call(method, {});
    } catch (e: unknown) { this.log.debug({ err: String(e) }, 'unsubscribe_all failed'); }
    this.subscribedChannels = [];
  }

  // ─── message dispatch ─────────────────────────────────────────

  private handleMessage(msg: any): void {
    if (msg.id != null && this.pending.has(msg.id)) {
      const { resolve, reject, timer } = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(timer);

      if (msg.error) {
        reject(new Error(`[${this.label}] RPC error ${msg.error.code}: ${msg.error.message}`));
      } else {
        resolve(msg.result);
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
      const channel = msg.params.channel as string;
      const data = msg.params.data;
      if (channel && this.subscriptionHandler) {
        this.subscriptionHandler(channel, data);
      }
      return;
    }
  }

  // ─── heartbeat ────────────────────────────────────────────────

  private startHeartbeat(): void {
    const interval = this.options.heartbeatIntervalSec ?? 30;
    this.call('public/set_heartbeat', { interval }).catch(() => {
      // Derive doesn't support set_heartbeat — use ping/pong instead
      this.heartbeatTimer = setInterval(() => {
        if (this.isConnected) this.ws!.ping();
      }, interval * 1000);
    });
  }

  // ─── reconnection ────────────────────────────────────────────

  private scheduleReconnect(): void {
    const maxAttempts = this.options.maxReconnectAttempts ?? 20;
    if (this.reconnectAttempts >= maxAttempts) {
      this.log.error({ maxAttempts }, 'max reconnect attempts reached');
      return;
    }

    const baseDelay = this.options.reconnectDelayMs ?? 1000;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), 30_000);
    this.reconnectAttempts++;

    this.log.info({ delayMs: delay, attempt: this.reconnectAttempts }, 'reconnecting');
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        if (this.subscribedChannels.length > 0) {
          const method = this.options.subscribeMethod ?? 'public/subscribe';
          this.log.info({ count: this.subscribedChannels.length }, 're-subscribing to channels');
          await this.call(method, { channels: [...this.subscribedChannels] });
        }
      } catch (e: unknown) {
        this.log.warn({ err: String(e) }, 'reconnect failed');
        if (this.shouldReconnect) this.scheduleReconnect();
      }
    }, delay);
  }

  private cleanup(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    for (const [id, { reject, timer }] of this.pending) {
      clearTimeout(timer);
      reject(new Error(`[${this.label}] connection closed`));
    }
    this.pending.clear();
  }
}
