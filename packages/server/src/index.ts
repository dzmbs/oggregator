import 'dotenv/config';
import type { FastifyInstance } from 'fastify';
import { buildApp, startShutdown } from './app.js';

const PORT = Number(process.env['PORT'] ?? 3100);
const FORCE_SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
  const app = await buildApp();
  registerShutdownHandlers(app);
  await app.listen({ port: PORT, host: '0.0.0.0' });
}

function registerShutdownHandlers(app: FastifyInstance) {
  let shuttingDown = false;
  let forceExitArmed = false;
  let forceExitTimer: ReturnType<typeof setTimeout> | null = null;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      app.log.warn({ signal }, 'second shutdown signal received, forcing exit');
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }
    shuttingDown = true;
    startShutdown();
    app.log.info({ signal }, 'shutdown requested');
    if (!forceExitArmed) {
      forceExitArmed = true;
      forceExitTimer = setTimeout(() => {
        app.log.error({ signal, timeoutMs: FORCE_SHUTDOWN_TIMEOUT_MS }, 'shutdown timed out, forcing exit');
        process.exit(signal === 'SIGINT' ? 130 : 143);
      }, FORCE_SHUTDOWN_TIMEOUT_MS);
      forceExitTimer.unref();
    }

    try {
      await app.close();
      if (forceExitTimer != null) {
        clearTimeout(forceExitTimer);
        forceExitTimer = null;
      }
      process.exit(0);
    } catch (err: unknown) {
      if (forceExitTimer != null) {
        clearTimeout(forceExitTimer);
        forceExitTimer = null;
      }
      app.log.error({ err }, 'graceful shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(1);
});
