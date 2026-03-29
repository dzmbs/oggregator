import WebSocket from 'ws';
import pino from 'pino';
import { logger } from '../../utils/logger.js';
import { backoffDelay } from '../../utils/reconnect.js';

const RETRY_AFTER_MAX_ATTEMPTS_MS = 60_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 20;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;

export interface TopicWsClientOptions {
  pingIntervalMs?: number;
  pingMessage?: string | Record<string, unknown>;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  onStatusChange?: (state: 'connected' | 'reconnecting' | 'down') => void;
  onSocket?: (socket: WebSocket) => void;
  getReplayMessages?: () => Array<string | Record<string, unknown>>;
  onOpen?: () => void | Promise<void>;
  onMessage?: (raw: WebSocket.RawData) => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
}

export class TopicWsClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private readonly log: pino.Logger;

  constructor(
    private readonly url: string,
    private readonly label: string,
    private readonly options: TopicWsClientOptions = {},
  ) {
    this.log = logger.child({ component: this.label });
  }

  get socket(): WebSocket | null {
    return this.ws;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.shouldReconnect = true;
      this.ws = new WebSocket(this.url);
      this.options.onSocket?.(this.ws);

      this.ws.on('open', () => {
        this.log.info({ url: this.url }, 'ws connected');
        this.reconnectAttempts = 0;
        this.startPing();
        this.options.onStatusChange?.('connected');

        Promise.resolve(this.replaySubscriptions())
          .then(() => this.options.onOpen?.())
          .then(() => resolve())
          .catch((error: unknown) => reject(error));
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        this.options.onMessage?.(raw);
      });

      this.ws.on('close', () => {
        this.log.warn('ws closed');
        this.cleanup();
        this.options.onClose?.();
        this.options.onStatusChange?.('reconnecting');
        if (this.shouldReconnect) this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        this.log.error({ err: error.message }, 'ws error');
        this.options.onError?.(error);
        if (this.ws?.readyState !== WebSocket.OPEN) reject(error);
      });
    });
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.cleanup();
    if (this.ws != null) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(payload: string | Record<string, unknown>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  }

  sendPong(data?: Buffer): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.pong(data);
  }

  on(event: 'ping', listener: (data: Buffer) => void): void {
    this.ws?.on(event, listener);
  }

  private replaySubscriptions(): void {
    const messages = this.options.getReplayMessages?.() ?? [];
    for (const message of messages) {
      this.send(message);
    }
  }

  private scheduleReconnect(): void {
    const maxAttempts = this.options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    const exceededMaxAttempts = this.reconnectAttempts >= maxAttempts;
    const delay = exceededMaxAttempts
      ? RETRY_AFTER_MAX_ATTEMPTS_MS
      : backoffDelay(
          this.reconnectAttempts,
          this.options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS,
        );

    this.reconnectAttempts += 1;

    if (exceededMaxAttempts) {
      this.log.error(
        { maxAttempts, delayMs: delay },
        'max reconnect attempts reached, switching to periodic retry',
      );
      this.options.onStatusChange?.('down');
    } else {
      this.log.info({ delayMs: delay, attempt: this.reconnectAttempts }, 'reconnecting');
    }

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error: unknown) {
        this.log.warn({ err: String(error) }, 'reconnect failed');
        if (this.shouldReconnect) this.scheduleReconnect();
      }
    }, delay);
  }

  private startPing(): void {
    this.stopPing();

    const pingIntervalMs = this.options.pingIntervalMs;
    const pingMessage = this.options.pingMessage;
    if (pingIntervalMs == null || pingMessage == null) return;

    this.pingTimer = setInterval(() => {
      this.send(pingMessage);
    }, pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer != null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private cleanup(): void {
    this.stopPing();
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
