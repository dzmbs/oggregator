import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import {
  registerAdapter,
  type ChainRequest,
  type VenueOptionChain,
  type StreamHandlers,
  type VenueDelta,
  EMPTY_GREEKS,
} from '@oggregator/core';
import type { OptionVenueAdapter, VenueCapabilities } from '@oggregator/core';
import type { VenueId } from '@oggregator/protocol';
import { wsChainRoute } from './ws-chain.js';

// ── Fake adapter ───────────────────────────────────────────────

class FakeAdapter implements OptionVenueAdapter {
  readonly venue: VenueId;
  readonly capabilities: VenueCapabilities = { optionChain: true, greeks: true, websocket: true };
  private handlers = new Set<StreamHandlers>();
  fetchCalls = 0;

  constructor(venue: VenueId) {
    this.venue = venue;
  }

  async loadMarkets() {}
  async listUnderlyings() {
    return ['BTC'];
  }
  async listExpiries() {
    return ['2026-03-27'];
  }

  async fetchOptionChain(req: ChainRequest): Promise<VenueOptionChain> {
    this.fetchCalls += 1;
    return {
      venue: this.venue,
      underlying: req.underlying,
      expiry: req.expiry,
      asOf: Date.now(),
      contracts: {
        'BTC/USD:USDC-260327-70000-C': {
          venue: this.venue,
          symbol: 'BTC/USD:USDC-260327-70000-C',
          exchangeSymbol: 'BTC-260327-70000-C',
          base: 'BTC',
          settle: 'USDC',
          expiry: '2026-03-27',
          strike: 70000,
          right: 'call',
          inverse: false,
          contractSize: 1,
          tickSize: 0.01,
          minQty: 0.1,
          makerFee: 0.0003,
          takerFee: 0.0003,
          greeks: { ...EMPTY_GREEKS, markIv: 0.5, delta: 0.5 },
          quote: {
            bid: { raw: 300, rawCurrency: 'USDC', usd: 300 },
            ask: { raw: 350, rawCurrency: 'USDC', usd: 350 },
            mark: { raw: 325, rawCurrency: 'USDC', usd: 325 },
            last: null,
            bidSize: 10,
            askSize: 20,
            underlyingPriceUsd: 70000,
            indexPriceUsd: 70000,
            volume24h: 100,
            openInterest: 500,
            estimatedFees: null,
            timestamp: Date.now(),
            source: 'ws',
          },
        },
      },
    };
  }

  async subscribe(_req: ChainRequest, handlers: StreamHandlers) {
    this.handlers.add(handlers);
    handlers.onStatus({ venue: this.venue, state: 'connected', ts: Date.now() });
    return async () => {
      this.handlers.delete(handlers);
    };
  }

  removeDeltaHandler(handlers: StreamHandlers) {
    this.handlers.delete(handlers);
  }

  fireDelta() {
    const delta: VenueDelta = {
      venue: this.venue,
      symbol: 'BTC/USD:USDC-260327-70000-C',
      ts: Date.now(),
    };
    for (const h of this.handlers) h.onDelta([delta]);
  }
}

// ── Test setup — uses injectWS, no real TCP port ───────────────

let app: ReturnType<typeof Fastify>;
let fakeAdapter: FakeAdapter;

import * as appModule from '../app.js';

beforeAll(async () => {
  fakeAdapter = new FakeAdapter('deribit');
  registerAdapter(fakeAdapter);

  app = Fastify({ logger: false });
  await app.register(websocket);
  Object.defineProperty(appModule, 'isReady', { value: () => true });
  await app.register(wsChainRoute);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ── Helpers ────────────────────────────────────────────────────

function subscribe(ws: { send: (data: string) => void }, id: string, venues = ['deribit']) {
  ws.send(
    JSON.stringify({
      type: 'subscribe',
      subscriptionId: id,
      request: { underlying: 'BTC', expiry: '2026-03-27', venues },
    }),
  );
}

function collectMessages(
  ws: { on: (event: string, cb: (data: unknown) => void) => void },
  count: number,
  timeoutMs = 2000,
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve) => {
    const msgs: Array<Record<string, unknown>> = [];
    const timer = setTimeout(() => resolve(msgs), timeoutMs);
    ws.on('message', (raw: unknown) => {
      msgs.push(JSON.parse(String(raw)) as Record<string, unknown>);
      if (msgs.length >= count) {
        clearTimeout(timer);
        resolve(msgs);
      }
    });
  });
}

// ── Tests ──────────────────────────────────────────────────────

describe('WS /ws/chain route (injectWS)', () => {
  it('sends subscribed + snapshot after subscribe', async () => {
    const ws = await app.injectWS('/ws/chain');

    subscribe(ws, 'test-1');
    const msgs = await collectMessages(ws, 3, 1000);

    const subscribed = msgs.find((m) => m['type'] === 'subscribed');
    expect(subscribed).toBeDefined();
    expect(subscribed!['subscriptionId']).toBe('test-1');

    const snapshot = msgs.find((m) => m['type'] === 'snapshot');
    expect(snapshot).toBeDefined();
    expect(snapshot!['subscriptionId']).toBe('test-1');
    expect(snapshot!['seq']).toBe(1);

    const meta = snapshot!['meta'] as Record<string, unknown>;
    expect(meta).toHaveProperty('generatedAt');
    expect(meta).toHaveProperty('staleMs');

    ws.terminate();
  });

  it('rapid subscribe(A) then subscribe(B) only delivers B snapshots', async () => {
    const ws = await app.injectWS('/ws/chain');

    subscribe(ws, 'sub-A');
    subscribe(ws, 'sub-B');

    const msgs = await collectMessages(ws, 4, 1000);

    const snapshots = msgs.filter((m) => m['type'] === 'snapshot');
    expect(snapshots.length).toBeGreaterThan(0);
    for (const s of snapshots) {
      expect(s['subscriptionId']).toBe('sub-B');
    }

    ws.terminate();
  });

  it('sends error for malformed subscribe message', async () => {
    const ws = await app.injectWS('/ws/chain');

    ws.send(JSON.stringify({ type: 'subscribe', oops: true }));
    const msgs = await collectMessages(ws, 1, 1000);

    const error = msgs.find((m) => m['type'] === 'error');
    expect(error).toBeDefined();
    expect(error!['code']).toBe('INVALID_MESSAGE');

    ws.terminate();
  });

  it('reports failed venues not registered', async () => {
    const ws = await app.injectWS('/ws/chain');

    subscribe(ws, 'test-fail', ['deribit', 'binance']);
    const msgs = await collectMessages(ws, 2, 1000);

    const subscribed = msgs.find((m) => m['type'] === 'subscribed');
    expect(subscribed).toBeDefined();

    const failed = subscribed!['failedVenues'] as Array<Record<string, unknown>>;
    expect(failed).toBeDefined();
    expect(failed.some((f) => f['venue'] === 'binance')).toBe(true);

    ws.terminate();
  });

  it('pushes delta patches when adapter fires deltas', async () => {
    const ws = await app.injectWS('/ws/chain');

    subscribe(ws, 'delta-test');
    const initial = await collectMessages(ws, 2, 1000);

    const firstSnapshot = initial.find((m) => m['type'] === 'snapshot');
    expect(firstSnapshot).toBeDefined();

    fakeAdapter.fireDelta();
    const followUp = await collectMessages(ws, 1, 500);

    const delta = followUp.find((m) => m['type'] === 'delta');
    expect(delta).toBeDefined();
    expect(delta!['seq'] as number).toBeGreaterThan(1);

    ws.terminate();
  });

  it('reuses one shared chain engine across clients watching the same chain', async () => {
    const before = fakeAdapter.fetchCalls;

    const first = await app.injectWS('/ws/chain');
    subscribe(first, 'shared-1');
    await collectMessages(first, 2, 1000);

    const fetchCallsAfterFirstClient = fakeAdapter.fetchCalls;
    const second = await app.injectWS('/ws/chain');
    subscribe(second, 'shared-2');
    await collectMessages(second, 2, 1000);

    expect(fetchCallsAfterFirstClient).toBeGreaterThanOrEqual(before);
    expect(fakeAdapter.fetchCalls).toBe(fetchCallsAfterFirstClient);

    first.terminate();
    second.terminate();
  });
});
