import type { FastifyInstance } from 'fastify';
import {
  getAllAdapters,
  getAdapter,
  getRegisteredVenues,
  buildComparisonChain,
  buildEnrichedChain,
  ClientWsMessageSchema,
  type VenueId,
  type VenueDelta,
  type VenueStatus,
  type StreamHandlers,
  type WsSubscriptionRequest,
  type ServerWsMessage,
  type SnapshotMeta,
} from '@oggregator/core';
import { isReady } from '../app.js';

// Venue feeds fire hundreds of deltas/sec. Browser needs at most 5 enriched pushes/sec.
const PUSH_INTERVAL_MS = 200;

interface SubscriptionContext {
  subscriptionId: string;
  request: WsSubscriptionRequest;
  handlers: StreamHandlers;
  pushTimer: ReturnType<typeof setInterval> | null;
  dirty: boolean;
  seq: number;
  disposed: boolean;
}

function send(socket: { readyState: number; send: (data: string) => void }, msg: ServerWsMessage) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(msg));
  }
}

export async function wsChainRoute(app: FastifyInstance) {
  app.get('/ws/chain', { websocket: true }, (socket, req) => {
    const log = req.log.child({ route: 'ws-chain' });

    if (!isReady()) {
      send(socket, {
        type: 'error', subscriptionId: null, code: 'NOT_READY',
        message: 'Server bootstrapping', retryable: true,
      });
      socket.close(1013, 'Try again later');
      return;
    }

    let ctx: SubscriptionContext | null = null;

    function buildAndPush(c: SubscriptionContext) {
      if (c.disposed || socket.readyState !== 1) return;

      const { request } = c;

      const chainPromises = request.venues.map((venueId) => {
        try { return getAdapter(venueId).fetchOptionChain(request); }
        catch { return null; }
      });

      Promise.all(chainPromises).then((results) => {
        // Stale guard: context may have been replaced while promises resolved
        if (c.disposed) return;

        const chains = results.filter((r) => r != null);
        const comparison = buildComparisonChain(request.underlying, request.expiry, chains);
        const enriched = buildEnrichedChain(request.underlying, request.expiry, comparison.rows, chains);

        let maxQuoteTs = 0;
        for (const chain of chains) {
          for (const contract of Object.values(chain.contracts)) {
            const ts = contract.quote.timestamp ?? 0;
            if (ts > maxQuoteTs) maxQuoteTs = ts;
          }
        }

        const now = Date.now();
        c.seq++;

        const meta: SnapshotMeta = {
          generatedAt: now,
          maxQuoteTs,
          staleMs: maxQuoteTs > 0 ? now - maxQuoteTs : 0,
        };

        send(socket, {
          type: 'snapshot',
          subscriptionId: c.subscriptionId,
          seq: c.seq,
          request: c.request,
          meta,
          data: enriched,
        });
      }).catch((err: unknown) => {
        log.warn({ err: String(err) }, 'chain build failed');
      });
    }

    function disposeContext(c: SubscriptionContext) {
      c.disposed = true;
      if (c.pushTimer) { clearInterval(c.pushTimer); c.pushTimer = null; }
      for (const adapter of getAllAdapters()) {
        adapter.removeDeltaHandler?.(c.handlers);
      }
    }

    async function handleSubscribe(subscriptionId: string, request: WsSubscriptionRequest) {
      if (ctx) disposeContext(ctx);

      // Only subscribe to venues that actually loaded during bootstrap
      const registered = new Set(getRegisteredVenues());
      const liveVenues = request.venues.filter((v) => registered.has(v));
      const resolvedRequest: WsSubscriptionRequest = { ...request, venues: liveVenues };

      const newCtx: SubscriptionContext = {
        subscriptionId,
        request: resolvedRequest,
        handlers: {
          onDelta: (_deltas: VenueDelta[]) => { newCtx.dirty = true; },
          onStatus: (status: VenueStatus) => {
            if (newCtx.disposed) return;
            const statusMsg: ServerWsMessage = {
              type: 'status',
              subscriptionId: newCtx.subscriptionId,
              venue: status.venue,
              state: status.state,
              ts: status.ts,
            };
            if (status.message != null) statusMsg.message = status.message;
            send(socket, statusMsg);
          },
        },
        pushTimer: null,
        dirty: false,
        seq: 0,
        disposed: false,
      };

      ctx = newCtx;

      const failedVenues: Array<{ venue: VenueId; reason: string }> = [];

      for (const v of request.venues) {
        if (!registered.has(v)) {
          failedVenues.push({ venue: v, reason: 'not loaded — failed during bootstrap' });
        }
      }

      // Async venue subscriptions — check disposed after each in case a new subscribe arrived
      for (const venueId of liveVenues) {
        if (newCtx.disposed) return;
        try {
          const adapter = getAdapter(venueId);
          if (!adapter.subscribe) continue;
          await adapter.subscribe({ underlying: request.underlying, expiry: request.expiry }, newCtx.handlers);
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : String(err);
          failedVenues.push({ venue: venueId, reason });
          log.warn({ venue: venueId, err: reason }, 'venue subscribe failed');
        }
      }

      if (newCtx.disposed) return;

      send(socket, {
        type: 'subscribed',
        subscriptionId,
        request: resolvedRequest,
        serverTime: Date.now(),
        failedVenues: failedVenues.length > 0 ? failedVenues : undefined,
      } as ServerWsMessage);

      buildAndPush(newCtx);

      newCtx.pushTimer = setInterval(() => {
        if (newCtx.dirty && !newCtx.disposed) {
          newCtx.dirty = false;
          buildAndPush(newCtx);
        }
      }, PUSH_INTERVAL_MS);

      log.info({ subscriptionId, underlying: request.underlying, expiry: request.expiry, venues: request.venues.length }, 'subscribed');
    }

    // ── Client messages ───────────────────────────────────────────

    socket.on('message', (raw) => {
      let json: unknown;
      try { json = JSON.parse(raw.toString()); }
      catch { log.debug('malformed JSON from client'); return; }

      const parsed = ClientWsMessageSchema.safeParse(json);
      if (!parsed.success) {
        send(socket, {
          type: 'error', subscriptionId: null, code: 'INVALID_MESSAGE',
          message: parsed.error.message, retryable: false,
        });
        return;
      }

      const msg = parsed.data;

      if (msg.type === 'subscribe') {
        handleSubscribe(msg.subscriptionId, msg.request).catch((err: unknown) => {
          log.error({ err: String(err) }, 'subscribe failed');
        });
        return;
      }

      if (msg.type === 'unsubscribe') {
        if (ctx) { disposeContext(ctx); ctx = null; }
      }
    });

    socket.on('close', () => {
      if (ctx) { disposeContext(ctx); ctx = null; }
      log.info('client disconnected');
    });
  });
}
