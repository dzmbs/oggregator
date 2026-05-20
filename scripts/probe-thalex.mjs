#!/usr/bin/env node
// Throwaway probe for Thalex public market data.
// Usage: node scripts/probe-thalex.mjs
// Writes captures to references/options-docs/thalex/*.json for test fixtures.
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const REST = 'https://thalex.com/api/v2';
const WS_URL = 'wss://thalex.com/ws/api/v2';
const OUT_DIR = new URL('../references/options-docs/thalex/', import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

function save(name, data) {
  writeFileSync(new URL(name, OUT_DIR), JSON.stringify(data, null, 2));
  console.log(`saved ${name}`);
}

async function fetchJson(path) {
  const res = await fetch(`${REST}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

async function main() {
  console.log('→ GET /public/instruments');
  const instrResp = await fetchJson('/public/instruments');
  const instruments = instrResp.result ?? instrResp;
  console.log(`  got ${instruments.length} instruments`);
  save('instruments.json', instruments.slice(0, 20));

  const optionsBtc = instruments.filter(
    (i) => i.type === 'option' && (i.underlying === 'BTCUSD' || i.base_currency === 'BTC' || i.instrument_name?.startsWith('BTC-')),
  );
  console.log(`  ${optionsBtc.length} BTC options`);
  if (!optionsBtc.length) throw new Error('no BTC options returned');

  const now = Date.now() / 1000;
  const near = optionsBtc
    .filter((i) => (i.expiration_timestamp ?? 0) > now)
    .sort((a, b) => a.expiration_timestamp - b.expiration_timestamp)[0] ?? optionsBtc[0];
  console.log(`  picked ${near.instrument_name} (exp=${near.expiration_timestamp}, strike=${near.strike_price})`);
  save('instrument-sample.json', near);

  console.log('→ GET /public/system_info');
  try {
    save('system-info.json', await fetchJson('/public/system_info'));
  } catch (e) {
    console.log(`  system_info failed: ${e.message}`);
  }

  console.log('→ GET /public/ticker (REST)');
  try {
    save('ticker-rest.json', await fetchJson(`/public/ticker?instrument_name=${encodeURIComponent(near.instrument_name)}`));
  } catch (e) {
    console.log(`  rest ticker failed: ${e.message}`);
  }

  console.log(`→ WS ${WS_URL}`);
  const ws = new WebSocket(WS_URL);
  const frames = [];
  const ackFrames = [];
  const tickerFrames = [];
  const indexFrames = [];
  const systemFrames = [];
  let firstTickerLogged = false;

  ws.addEventListener('open', () => {
    console.log('  WS open');
    ws.send(JSON.stringify({ method: 'public/subscribe', id: 1, params: { channels: [`ticker.${near.instrument_name}.1000ms`] } }));
    ws.send(JSON.stringify({ method: 'public/subscribe', id: 2, params: { channels: ['price_index.BTCUSD'] } }));
    ws.send(JSON.stringify({ method: 'public/subscribe', id: 3, params: { channels: ['system'] } }));
  });
  ws.addEventListener('message', (ev) => {
    const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      console.log(`  non-JSON: ${text.slice(0, 120)}`);
      return;
    }
    frames.push(msg);
    if (msg.id !== undefined) {
      ackFrames.push(msg);
      console.log(`  ack id=${msg.id}: ${JSON.stringify(msg).slice(0, 200)}`);
    } else if (typeof msg.channel_name === 'string') {
      if (msg.channel_name.startsWith('ticker.')) {
        tickerFrames.push(msg);
        if (!firstTickerLogged) {
          firstTickerLogged = true;
          console.log(`  first ticker: ${JSON.stringify(msg).slice(0, 400)}`);
        }
      } else if (msg.channel_name.startsWith('price_index.')) {
        indexFrames.push(msg);
      } else if (msg.channel_name === 'system') {
        systemFrames.push(msg);
        console.log(`  system: ${JSON.stringify(msg).slice(0, 200)}`);
      }
    }
  });
  ws.addEventListener('error', (e) => console.log(`  WS error: ${e.message ?? e}`));
  ws.addEventListener('close', (e) => console.log(`  WS closed code=${e.code} reason=${e.reason}`));

  await sleep(30_000);
  console.log(`\ncollected: ${ackFrames.length} acks, ${tickerFrames.length} tickers, ${indexFrames.length} indexes, ${systemFrames.length} system`);

  if (tickerFrames[0]) {
    const t = tickerFrames[0].notification ?? {};
    console.log(`  ticker iv=${t.iv} delta=${t.delta} mark=${t.mark_price} bid=${t.best_bid_price} ask=${t.best_ask_price}`);
    console.log(`  ticker fields: ${Object.keys(t).join(', ')}`);
    console.log(`  IV magnitude heuristic: ${t.iv > 5 ? 'PERCENT (e.g. 52.3)' : 'FRACTION (e.g. 0.52)'}`);
  }

  save('subscribe-acks.json', ackFrames);
  save('ticker-pushes.json', tickerFrames.slice(0, 5));
  save('index-pushes.json', indexFrames.slice(0, 5));
  save('system-pushes.json', systemFrames);

  console.log('→ idle 45 s to test heartbeat...');
  const beforeIdle = Date.now();
  await sleep(45_000);
  const closedDuringIdle = ws.readyState !== 1;
  console.log(`  after 45s: readyState=${ws.readyState} (${closedDuringIdle ? 'CLOSED — app heartbeat needed' : 'OPEN — native ping suffices'})`);

  ws.close();
  await sleep(500);
  process.exit(0);
}

main().catch((e) => {
  console.error('probe failed:', e);
  process.exit(1);
});
