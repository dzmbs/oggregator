import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { registerRoutes } from './routes/index.js';
import { bootstrapAdapters } from './adapters.js';
import { bootstrapServices, tradeStore } from './services.js';

let ready = false;
let shuttingDown = false;

export function isReady() {
  return ready && !shuttingDown;
}

export function isShuttingDown() {
  return shuttingDown;
}

export function startShutdown() {
  shuttingDown = true;
  ready = false;
}

const isDev = process.env['NODE_ENV'] !== 'production';

export async function buildApp(): Promise<FastifyInstance> {
  shuttingDown = false;
  ready = false;

  const app = Fastify({
    logger: isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          },
        }
      : true,
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  registerRoutes(app);

  app.addHook('onClose', async () => {
    await tradeStore.dispose();
  });

  // Serve the built web SPA in production (single-service deploy)
  const here = dirname(fileURLToPath(import.meta.url));
  const webDist = resolve(here, '../../web/dist');
  if (!isDev && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((_req, reply) => {
      return reply.sendFile('index.html');
    });
  }

  bootstrapAdapters(app.log).then(() => {
    if (shuttingDown) return;
    ready = true;
    bootstrapServices(app.log).catch((err: unknown) => {
      app.log.warn({ err: String(err) }, 'services bootstrap failed');
    });
  });

  return app;
}
