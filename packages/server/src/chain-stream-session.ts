import type {
  ChainRuntimeEvent,
  ChainRuntimeListener,
  ServerWsMessage,
  WsSubscriptionRequest,
} from '@oggregator/core';
import { chainEngines } from './chain-engines.js';

// WebSocket.OPEN is 1 per RFC 6455 — duck-typed socket interface doesn't carry the constant
const WS_OPEN = 1;
const MAX_SOCKET_BUFFERED_BYTES = 1_000_000;

type SessionSocket = {
  readyState: number;
  send: (data: string) => void;
  close?: (code?: number, reason?: string) => void;
  bufferedAmount?: number;
};

function send(socket: SessionSocket, message: ServerWsMessage): void {
  if (socket.readyState === WS_OPEN) {
    socket.send(JSON.stringify(message));
  }
}

export class ChainStreamSession {
  private detachEngineListener: (() => void) | null = null;
  private releaseEngine: (() => Promise<void>) | null = null;
  private disposed = false;
  private initialized = false;
  private lastSentSeq = 0;
  private bufferedEvents: ChainRuntimeEvent[] = [];
  private engineListener: ChainRuntimeListener | null = null;

  constructor(
    private readonly socket: SessionSocket,
    readonly subscriptionId: string,
    readonly request: WsSubscriptionRequest,
  ) {}

  async subscribe(): Promise<void> {
    const { runtime, release } = await chainEngines.acquire(this.request);
    if (this.disposed) {
      await release();
      return;
    }

    this.releaseEngine = release;
    this.engineListener = {
      onEvent: (event) => this.handleEngineEvent(event),
    };
    this.detachEngineListener = runtime.subscribe(this.engineListener);

    send(this.socket, {
      type: 'subscribed',
      subscriptionId: this.subscriptionId,
      request: runtime.getActiveRequest(),
      serverTime: Date.now(),
      failedVenues: runtime.getFailedVenues().length > 0 ? runtime.getFailedVenues() : undefined,
    });

    const snapshot = runtime.getSnapshot();
    if (snapshot != null) {
      this.sendEngineEvent(snapshot);
    }

    this.initialized = true;
    const buffered = this.bufferedEvents;
    this.bufferedEvents = [];
    for (const event of buffered) {
      this.sendEngineEvent(event);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.detachEngineListener?.();
    this.detachEngineListener = null;

    const release = this.releaseEngine;
    this.releaseEngine = null;
    if (release != null) {
      await release();
    }
  }

  private handleEngineEvent(event: ChainRuntimeEvent): void {
    if (this.disposed) return;
    if (!this.initialized) {
      if (event.type === 'snapshot') {
        this.bufferedEvents = this.bufferedEvents.filter(
          (buffered) => buffered.type !== 'snapshot',
        );
      }
      this.bufferedEvents.push(event);
      return;
    }

    this.sendEngineEvent(event);
  }

  private sendEngineEvent(event: ChainRuntimeEvent): void {
    if (this.disposed) return;
    if ((event.type === 'snapshot' || event.type === 'delta') && event.seq <= this.lastSentSeq) {
      return;
    }
    if (this.isSlowClient()) {
      this.disposeForSlowClient();
      return;
    }

    switch (event.type) {
      case 'snapshot':
        this.lastSentSeq = event.seq;
        send(this.socket, {
          type: 'snapshot',
          subscriptionId: this.subscriptionId,
          seq: event.seq,
          request: event.request,
          meta: event.meta,
          data: event.data,
        });
        return;

      case 'delta':
        this.lastSentSeq = event.seq;
        send(this.socket, {
          type: 'delta',
          subscriptionId: this.subscriptionId,
          seq: event.seq,
          request: event.request,
          meta: event.meta,
          deltas: event.deltas,
          patch: event.patch,
        });
        return;

      case 'status':
        send(this.socket, {
          type: 'status',
          subscriptionId: this.subscriptionId,
          venue: event.status.venue,
          state: event.status.state,
          ts: event.status.ts,
          message: event.status.message,
        });
        return;
    }
  }

  private isSlowClient(): boolean {
    return (this.socket.bufferedAmount ?? 0) >= MAX_SOCKET_BUFFERED_BYTES;
  }

  private disposeForSlowClient(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachEngineListener?.();
    this.detachEngineListener = null;
    this.socket.close?.(1013, 'slow client');

    const release = this.releaseEngine;
    this.releaseEngine = null;
    if (release != null) {
      void release();
    }
  }
}
