import { describe, expect, it, vi } from 'vitest';
import type { OptionVenueAdapter, StreamHandlers, VenueCapabilities } from '../feeds/shared/types.js';
import { VenueSubscriptionCoordinator } from './subscription-coordinator.js';
import type { ChainRequest, VenueDelta, VenueOptionChain, VenueStatus } from './types.js';
import type { VenueId } from '../types/common.js';

class MockAdapter implements OptionVenueAdapter {
  readonly venue: VenueId = 'deribit';
  readonly capabilities: VenueCapabilities = {
    optionChain: true,
    greeks: true,
    websocket: true,
  };

  subscribeCalls = 0;
  unsubscribeCalls = 0;
  handlers: StreamHandlers[] = [];

  async loadMarkets(): Promise<void> {}

  async listUnderlyings(): Promise<string[]> {
    return [];
  }

  async listExpiries(): Promise<string[]> {
    return [];
  }

  async fetchOptionChain(_request: ChainRequest): Promise<VenueOptionChain> {
    return {
      venue: this.venue,
      underlying: 'BTC',
      expiry: '2026-01-01',
      asOf: Date.now(),
      contracts: {},
    };
  }

  async subscribe(_request: ChainRequest, handlers: StreamHandlers): Promise<() => Promise<void>> {
    this.subscribeCalls += 1;
    this.handlers.push(handlers);

    return async () => {
      this.unsubscribeCalls += 1;
    };
  }
}

function createCoordinator(adapter: MockAdapter): VenueSubscriptionCoordinator {
  return new VenueSubscriptionCoordinator({
    getAdapter: () => adapter,
  });
}

describe('VenueSubscriptionCoordinator', () => {
  it('reuses one upstream subscription for duplicate venue interests', async () => {
    const adapter = new MockAdapter();
    const coordinator = createCoordinator(adapter);
    const request: ChainRequest = { underlying: 'BTC', expiry: '2026-01-01' };

    const first = await coordinator.acquire('deribit', request);
    const second = await coordinator.acquire('deribit', request);

    expect(adapter.subscribeCalls).toBe(1);

    await first.release();
    expect(adapter.unsubscribeCalls).toBe(0);

    await second.release();
    expect(adapter.unsubscribeCalls).toBe(1);
  });

  it('shares one handler across venue requests while releasing each request independently', async () => {
    const adapter = new MockAdapter();
    const coordinator = createCoordinator(adapter);

    const jan = await coordinator.acquire('deribit', { underlying: 'BTC', expiry: '2026-01-01' });
    const feb = await coordinator.acquire('deribit', { underlying: 'BTC', expiry: '2026-02-01' });

    expect(adapter.subscribeCalls).toBe(2);
    expect(adapter.handlers[0]).toBe(adapter.handlers[1]);

    await jan.release();
    expect(adapter.unsubscribeCalls).toBe(1);

    await feb.release();
    expect(adapter.unsubscribeCalls).toBe(2);
  });

  it('routes deltas only to listeners for the matching underlying and expiry', async () => {
    const adapter = new MockAdapter();
    const coordinator = createCoordinator(adapter);
    const onJanDelta = vi.fn<(deltas: VenueDelta[]) => void>();
    const onFebDelta = vi.fn<(deltas: VenueDelta[]) => void>();

    const jan = await coordinator.acquire(
      'deribit',
      { underlying: 'BTC', expiry: '2026-01-01' },
      { onDelta: onJanDelta },
    );
    const feb = await coordinator.acquire(
      'deribit',
      { underlying: 'BTC', expiry: '2026-02-01' },
      { onDelta: onFebDelta },
    );

    const handler = adapter.handlers[0];
    expect(handler).toBeDefined();

    handler?.onDelta([
      { venue: 'deribit', symbol: 'BTC/USD:BTC-260101-100-C', ts: 1 },
      { venue: 'deribit', symbol: 'BTC/USD:BTC-260201-100-C', ts: 2 },
    ]);

    expect(onJanDelta).toHaveBeenCalledWith([
      { venue: 'deribit', symbol: 'BTC/USD:BTC-260101-100-C', ts: 1 },
    ]);
    expect(onFebDelta).toHaveBeenCalledWith([
      { venue: 'deribit', symbol: 'BTC/USD:BTC-260201-100-C', ts: 2 },
    ]);

    await jan.release();
    await feb.release();
  });

  it('broadcasts venue status to all active listeners on the venue', async () => {
    const adapter = new MockAdapter();
    const coordinator = createCoordinator(adapter);
    const firstStatus = vi.fn<(status: VenueStatus) => void>();
    const secondStatus = vi.fn<(status: VenueStatus) => void>();

    const first = await coordinator.acquire(
      'deribit',
      { underlying: 'BTC', expiry: '2026-01-01' },
      { onStatus: firstStatus },
    );
    const second = await coordinator.acquire(
      'deribit',
      { underlying: 'ETH', expiry: '2026-01-01' },
      { onStatus: secondStatus },
    );

    const status: VenueStatus = {
      venue: 'deribit',
      state: 'reconnecting',
      ts: 123,
      message: 'transport closed',
    };

    adapter.handlers[0]?.onStatus(status);

    expect(firstStatus).toHaveBeenCalledWith(status);
    expect(secondStatus).toHaveBeenCalledWith(status);

    await first.release();
    await second.release();
  });

  it('keeps notifying other listeners when one listener throws', async () => {
    const adapter = new MockAdapter();
    const coordinator = createCoordinator(adapter);
    const healthyDelta = vi.fn<(deltas: VenueDelta[]) => void>();
    const healthyStatus = vi.fn<(status: VenueStatus) => void>();

    const first = await coordinator.acquire(
      'deribit',
      { underlying: 'BTC', expiry: '2026-01-01' },
      {
        onDelta: () => { throw new Error('boom'); },
        onStatus: () => { throw new Error('boom'); },
      },
    );
    const second = await coordinator.acquire(
      'deribit',
      { underlying: 'BTC', expiry: '2026-01-01' },
      { onDelta: healthyDelta, onStatus: healthyStatus },
    );

    adapter.handlers[0]?.onDelta([
      { venue: 'deribit', symbol: 'BTC/USD:BTC-260101-100-C', ts: 1 },
    ]);
    adapter.handlers[0]?.onStatus({ venue: 'deribit', state: 'connected', ts: 2 });

    expect(healthyDelta).toHaveBeenCalledWith([
      { venue: 'deribit', symbol: 'BTC/USD:BTC-260101-100-C', ts: 1 },
    ]);
    expect(healthyStatus).toHaveBeenCalledWith({ venue: 'deribit', state: 'connected', ts: 2 });

    await first.release();
    await second.release();
  });
});
