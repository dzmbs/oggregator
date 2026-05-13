#!/usr/bin/env node
import { createPrivateKey, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PROD_WS_URL = 'wss://thalex.com/ws/api/v2';
const TEST_WS_URL = 'wss://testnet.thalex.com/ws/api/v2';
const PRIVATE_CHANNELS = ['account.portfolio', 'account.summary'];
const DEFAULT_WAIT_MS = 15_000;
const DEFAULT_RPC_TIMEOUT_MS = 30_000;

function usage() {
  console.error(`Usage:
  THALEX_KID=... THALEX_PRIVATE_KEY_FILE=/path/to/key.pem [THALEX_ACCOUNT=main] [THALEX_ENV=prod|test] node scripts/probe-thalex-private.mjs

Optional:
  THALEX_PRIVATE_KEY_PEM   Inline PEM instead of THALEX_PRIVATE_KEY_FILE
  THALEX_WAIT_MS           How long to wait for subscription pushes (default: ${DEFAULT_WAIT_MS})
`);
}

function base64UrlEncode(input) {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return bytes.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function normalizePemString(input) {
  let normalized = input.trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.replace(/\r\n/g, '\n').replace(/\\n/g, '\n');
}

function parseSigningKey(privateKeyPem) {
  const normalized = normalizePemString(privateKeyPem);
  if (normalized.includes('BEGIN ENCRYPTED PRIVATE KEY')) {
    throw new Error('encrypted private keys are not supported; export an unencrypted RSA private key PEM');
  }
  if (!normalized.includes('BEGIN PRIVATE KEY') && !normalized.includes('BEGIN RSA PRIVATE KEY')) {
    throw new Error('expected a PEM private key with BEGIN/END lines');
  }

  const key = createPrivateKey(normalized);
  if (key.asymmetricKeyType !== 'rsa') {
    throw new Error(`unsupported key type "${key.asymmetricKeyType ?? 'unknown'}"; Thalex requires an RSA private key`);
  }
  return key;
}

function mintAuthToken({ kid, privateKeyPem }) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 600;
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS512', typ: 'JWT', kid }));
  const payload = base64UrlEncode(JSON.stringify({ iat, exp }));
  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA512');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(parseSigningKey(privateKeyPem));
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function loadConfig() {
  const kid = process.env.THALEX_KID?.trim();
  const account = process.env.THALEX_ACCOUNT?.trim();
  const envName = process.env.THALEX_ENV === 'test' ? 'test' : 'prod';
  const waitMsRaw = process.env.THALEX_WAIT_MS?.trim();
  const waitMs = waitMsRaw ? Number(waitMsRaw) : DEFAULT_WAIT_MS;
  const inlinePem = process.env.THALEX_PRIVATE_KEY_PEM;
  const pemFile = process.env.THALEX_PRIVATE_KEY_FILE?.trim();
  const privateKeyPem = inlinePem ?? (pemFile ? readFileSync(pemFile, 'utf8') : null);

  if (!kid || !privateKeyPem) {
    usage();
    throw new Error('THALEX_KID and one of THALEX_PRIVATE_KEY_FILE / THALEX_PRIVATE_KEY_PEM are required');
  }
  if (!Number.isFinite(waitMs) || waitMs < 0) {
    throw new Error(`invalid THALEX_WAIT_MS: ${waitMsRaw}`);
  }

  return {
    kid,
    account,
    envName,
    waitMs,
    privateKeyPem,
    wsUrl: envName === 'test' ? TEST_WS_URL : PROD_WS_URL,
  };
}

function formatCompact(value) {
  return JSON.stringify(value, null, 2);
}

async function waitForOpen(ws) {
  if (ws.readyState === 1) return;
  await new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (event) => {
      cleanup();
      reject(event.error ?? new Error('websocket open failed'));
    };
    const onClose = (event) => {
      cleanup();
      reject(new Error(`websocket closed before open (${event.code} ${event.reason || 'no reason'})`));
    };
    const cleanup = () => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
      ws.removeEventListener('close', onClose);
    };
    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onError);
    ws.addEventListener('close', onClose);
  });
}

async function main() {
  const config = loadConfig();
  const token = mintAuthToken({ kid: config.kid, privateKeyPem: config.privateKeyPem });
  const ws = new WebSocket(config.wsUrl);
  const pending = new Map();
  const pushes = [];
  let nextId = 1;

  const cleanupPending = (reason) => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    pending.clear();
  };

  const call = (method, params) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, DEFAULT_RPC_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  };

  ws.addEventListener('message', (event) => {
    const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      console.log(`non-JSON frame: ${text.slice(0, 200)}`);
      return;
    }

    if (typeof msg.id === 'number' && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) {
        entry.reject(new Error(`RPC error ${msg.error.code}: ${msg.error.message}`));
      } else {
        entry.resolve(msg.result);
      }
      return;
    }

    if (typeof msg.channel_name === 'string') {
      pushes.push(msg);
      const count = Array.isArray(msg.notification) ? msg.notification.length : 'n/a';
      console.log(`push ${msg.channel_name} snapshot=${msg.snapshot === true} entries=${count}`);
      if (msg.channel_name === 'account.portfolio' && Array.isArray(msg.notification)) {
        for (const row of msg.notification.slice(0, 5)) {
          console.log(
            `  ${row.instrument_name} position=${row.position} average_price=${row.average_price ?? 'null'} mark_price=${row.mark_price ?? 'null'}`,
          );
        }
      }
    }
  });

  ws.addEventListener('error', (event) => {
    console.log(`ws error: ${event.message ?? event.error ?? event}`);
  });

  ws.addEventListener('close', (event) => {
    cleanupPending(`websocket closed (${event.code} ${event.reason || 'no reason'})`);
  });

  await waitForOpen(ws);
  console.log(`connected ${config.wsUrl}`);

  const login = await call('public/login', {
    token,
    ...(config.account ? { account: config.account } : {}),
  });
  console.log('login result:');
  console.log(formatCompact(login));

  const portfolio = await call('private/portfolio', {});
  const portfolioRows = Array.isArray(portfolio) ? portfolio : [];
  console.log(`private/portfolio rows=${portfolioRows.length}`);
  for (const row of portfolioRows.slice(0, 10)) {
    console.log(
      `  ${row.instrument_name} position=${row.position} average_price=${row.average_price ?? 'null'} mark_price=${row.mark_price ?? 'null'}`,
    );
  }

  const summary = await call('private/account_summary', {});
  console.log('private/account_summary keys:');
  console.log(Object.keys(summary ?? {}).join(', '));

  const subscribed = await call('private/subscribe', { channels: PRIVATE_CHANNELS });
  console.log(`private/subscribe result: ${formatCompact(subscribed)}`);

  console.log(`waiting ${config.waitMs}ms for subscription pushes...`);
  await sleep(config.waitMs);

  const portfolioPushes = pushes.filter((msg) => msg.channel_name === 'account.portfolio');
  const summaryPushes = pushes.filter((msg) => msg.channel_name === 'account.summary');
  console.log(`push summary: portfolio=${portfolioPushes.length} account.summary=${summaryPushes.length}`);

  ws.close();
  await sleep(250);
}

main().catch((error) => {
  console.error(`probe failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
