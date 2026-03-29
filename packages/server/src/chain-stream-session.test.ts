import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainRuntimeEvent, WsSubscriptionRequest } from '@oggregator/core';

const subscribeMock = vi.fn();
const releaseMock = vi.fn(async () => {});
const getSnapshotMock = vi.fn();
const getActiveRequestMock = vi.fn();
const getFailedVenuesMock = vi.fn(() => []);

vi.mock('./chain-engines.js', () => ({
  chainEngines: {
    acquire: vi.fn(async () => ({
      runtime: {
        subscribe: subscribeMock,
        getSnapshot: getSnapshotMock,
        getActiveRequest: getActiveRequestMock,
        getFailedVenues: getFailedVenuesMock,
      },
      release: releaseMock,
    })),
  },
}));

import { ChainStreamSession } from './chain-stream-session.js';

function makeRequest(): WsSubscriptionRequest {
  return {
    underlying: 'BTC',
    expiry: '2026-03-27',
    venues: ['deribit'],
  };
}

describe('ChainStreamSession', () => {
  beforeEach(() => {
    subscribeMock.mockReset();
    releaseMock.mockClear();
    getSnapshotMock.mockReset();
    getActiveRequestMock.mockReset();
    getFailedVenuesMock.mockReset();
    getFailedVenuesMock.mockReturnValue([]);
    getActiveRequestMock.mockImplementation(() => makeRequest());
    getSnapshotMock.mockReturnValue(null);
  });

  it('closes and releases the runtime when the socket is too far behind', async () => {
    let listener: { onEvent(event: ChainRuntimeEvent): void } | null = null;
    subscribeMock.mockImplementation(
      (nextListener: { onEvent(event: ChainRuntimeEvent): void }) => {
        listener = nextListener;
        return vi.fn();
      },
    );

    const socket = {
      readyState: 1,
      bufferedAmount: 1_000_000,
      send: vi.fn(),
      close: vi.fn(),
    };

    const session = new ChainStreamSession(socket, 'sub-1', makeRequest());
    await session.subscribe();

    listener?.onEvent({
      type: 'status',
      status: {
        venue: 'deribit',
        state: 'connected',
        ts: Date.now(),
      },
    });

    expect(socket.close).toHaveBeenCalledWith(1013, 'slow client');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});
