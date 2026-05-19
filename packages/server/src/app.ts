import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { registerRoutes } from './routes/index.js';
import { bootstrapAdapters, disposeAdapters } from './adapters.js';
import {
  blockFlowService,
  bootstrapServices,
  disposeServiceStores,
  dvolService,
  flowService,
  indexPriceService,
  ivHistoryService,
  ivHistoryStore,
  markHistoryBuffer,
  spotCandleService,
  spotService,
  tradeStore,
} from './services.js';
import { paperTradingStore } from './trading-services.js';
import { disposePortfolioServices } from './portfolio-services.js';

export const SERVER_BOOT_TIME = Date.now();

interface WebEntryAssets {
  entryJs: string | null;
  entryCss: string | null;
}

function readWebEntryAssets(webDist: string): WebEntryAssets {
  try {
    const indexHtml = readFileSync(resolve(webDist, 'index.html'), 'utf-8');
    const jsMatch = indexHtml.match(/<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/i);
    const cssMatch = indexHtml.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]*\/assets\/index-[^"]+\.css)"/i);
    return {
      entryJs: jsMatch?.[1]?.replace(/^\//, '') ?? null,
      entryCss: cssMatch?.[1]?.replace(/^\//, '') ?? null,
    };
  } catch {
    return { entryJs: null, entryCss: null };
  }
}

export const SERVER_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, '../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

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

  await app.register(cors, {
    origin: isDev
      ? true
      : [
          'http://localhost:5173',
          'https://oggregator.xyz',
          'https://www.oggregator.xyz',
          /\.vercel\.app$/,
        ],
    credentials: false,
  });
  // gzip/deflate JSON responses; small payloads (<1KB) skip compression to
  // avoid CPU overhead on health/ready probes.
  await app.register(compress, { global: true, threshold: 1024 });
  await app.register(websocket, {
    options: {
      // Compress outbound WS frames. Snapshot/delta JSON compresses ~80%.
      perMessageDeflate: {
        zlibDeflateOptions: { level: 3 },
        threshold: 1024,
      },
    },
  });

  registerRoutes(app);

  // Tracked so onClose can await any in-flight bootstrap before disposing —
  // otherwise SIGTERM arriving mid-bootstrap would start runtimes that nobody
  // shuts down, leaving WS reconnect loops alive until forceExitTimer fires.
  let bootstrap: Promise<void> = Promise.resolve();

  app.addHook('onClose', async () => {
    // Wait for bootstrap to finish (or fail) so all runtimes that will ever
    // exist are visible before we dispose them.
    await bootstrap.catch(() => {});
    // Stop runtimes first: dispose() flips shouldReconnect=false, clears
    // timers, and closes sockets. If we did this after disposeAdapters(),
    // the runtimes' ws.on('close') handlers would reschedule reconnects.
    flowService.dispose();
    blockFlowService.dispose();
    spotService.dispose();
    spotCandleService.dispose();
    dvolService.dispose();
    indexPriceService.dispose();
    ivHistoryService.dispose();
    disposeServiceStores();
    await disposePortfolioServices();
    await disposeAdapters(app.log);
    await ivHistoryStore.dispose();
    await tradeStore.dispose();
    await paperTradingStore.dispose();
  });

  // Serve the built web SPA in production (single-service deploy)
  const here = dirname(fileURLToPath(import.meta.url));
  const webDist = resolve(here, '../../web/dist');
  if (!isDev && existsSync(webDist)) {
    const webEntryAssets = readWebEntryAssets(webDist);

    app.addHook('onSend', async (req, reply, payload) => {
      if (
        req.url === '/' ||
        req.url.endsWith('.html') ||
        req.url === '/sw.js' ||
        req.url === '/manifest.json'
      ) {
        reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
      return payload;
    });

    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
    });

    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/assets/index-') && req.url.endsWith('.js') && webEntryAssets.entryJs) {
        return reply.type('application/javascript; charset=utf-8').sendFile(webEntryAssets.entryJs);
      }
      if (req.url.startsWith('/assets/index-') && req.url.endsWith('.css') && webEntryAssets.entryCss) {
        return reply.type('text/css; charset=utf-8').sendFile(webEntryAssets.entryCss);
      }
      if (req.url.startsWith('/assets/')) {
        return reply.status(404).send({ error: 'asset_not_found' });
      }
      return reply.sendFile('index.html');
    });
  }

  bootstrap = bootstrapAdapters(app.log, {
    markHistoryBuffer,
    tradeRuntime: flowService,
  }).then(async () => {
    if (shuttingDown) return;
    ready = true;
    try {
      await bootstrapServices(app.log);
    } catch (err: unknown) {
      app.log.warn({ err: String(err) }, 'services bootstrap failed');
    }
  });

  return app;
}
