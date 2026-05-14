import type { FastifyBaseLogger } from 'fastify';
import {
  registerAdapter,
  DeribitWsAdapter,
  OkxWsAdapter,
  BinanceWsAdapter,
  BybitWsAdapter,
  DeriveWsAdapter,
  CoincallWsAdapter,
  ThalexWsAdapter,
  GateioWsAdapter,
} from '@oggregator/core';

const adapters = [
  new DeribitWsAdapter(),
  new OkxWsAdapter(),
  new BinanceWsAdapter(),
  new BybitWsAdapter(),
  new DeriveWsAdapter(),
  new CoincallWsAdapter(),
  new ThalexWsAdapter(),
  new GateioWsAdapter(),
];

export async function bootstrapAdapters(log: FastifyBaseLogger) {
  log.info('loading markets for all venues');

  await Promise.allSettled(
    adapters.map(async (adapter) => {
      const start = Date.now();
      try {
        await adapter.loadMarkets();
        registerAdapter(adapter);
        const underlyings = await adapter.listUnderlyings();
        log.info(
          { venue: adapter.venue, ms: Date.now() - start, underlyings: underlyings.slice(0, 5) },
          'venue loaded',
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ venue: adapter.venue, ms: Date.now() - start, err: message }, 'venue failed');
      }
    }),
  );

  log.info('all venues bootstrapped');
}

export async function disposeAdapters(log: FastifyBaseLogger) {
  log.info('disposing venue adapters');

  await Promise.allSettled(
    adapters.map(async (adapter) => {
      if (adapter.dispose == null) return;
      try {
        await adapter.dispose();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ venue: adapter.venue, err: message }, 'venue dispose failed');
      }
    }),
  );
}
