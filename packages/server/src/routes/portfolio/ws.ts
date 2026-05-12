import type { FastifyInstance } from 'fastify';
import type { PortfolioWsServerMessage } from '@oggregator/protocol';

import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';

import {
  bootstrapPortfolioForAccount,
  getOrCreatePortfolioRuntime,
} from '../../portfolio-services.js';
import { getUserByApiKey } from '../../user-service.js';
import { portfolioEvents } from './events.js';

const WS_OPEN = 1;

function send(
  socket: { readyState: number; send: (data: string) => void },
  msg: PortfolioWsServerMessage,
): void {
  if (socket.readyState === WS_OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

export async function portfolioWsRoute(app: FastifyInstance) {
  app.get('/ws/portfolio', { websocket: true }, async (socket, req) => {
    let disposed = false;
    let accountId = DEFAULT_ACCOUNT_ID;

    const apiKey = new URL(req.url, 'http://localhost').searchParams.get('apiKey');
    if (apiKey) {
      const user = await getUserByApiKey(apiKey);
      if (user) accountId = user.accountId;
    }

    send(socket, {
      type: 'hello',
      accountId,
      serverTime: Date.now(),
    });

    await bootstrapPortfolioForAccount(accountId);
    const runtime = getOrCreatePortfolioRuntime(accountId);

    const initial = runtime.getSnapshot();
    if (initial != null) {
      send(socket, {
        type: 'snapshot',
        seq: initial.seq,
        metrics: initial.metrics,
        positions: initial.positions,
      });
    }

    const offRuntime = runtime.subscribe({
      onEvent: (event) => {
        if (disposed) return;
        if (event.type === 'snapshot') {
          send(socket, {
            type: 'snapshot',
            seq: event.seq,
            metrics: event.metrics,
            positions: event.positions,
          });
        } else if (event.type === 'delta') {
          send(socket, {
            type: 'delta',
            seq: event.seq,
            metrics: event.metrics,
            changedLegIds: event.changedLegIds,
          });
        } else if (event.type === 'error') {
          send(socket, { type: 'error', code: event.code, message: event.message });
        }
      },
    });

    const offBus = portfolioEvents.subscribe(accountId, (msg) => {
      if (disposed) return;
      send(socket, msg);
    });

    socket.on('close', () => {
      disposed = true;
      offRuntime();
      offBus();
    });
  });
}
