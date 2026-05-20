#!/usr/bin/env node
// Throwaway probe — pin down Coincall public WS/REST spec.
// Usage: node scripts/probe-coincall.mjs
// Writes captures to references/options-docs/coincall/*.json
// Uses Node 22 global WebSocket (no ws import to sidestep pnpm workspace resolution).

import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const OUT = new URL('../references/options-docs/coincall/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const REST_BASES = ['https://api.coincall.com'];
const WS_CANDIDATES = [
  'wss://ws.coincall.com/options',
  'wss://api.coincall.com/options',
  'wss://ws.coincall.com/public/options',
  'wss://betaapi.coincall.com/options',
  'wss://ws.coincall.com/ws/market',
  'wss://ws.coincall.com/v1/options',
];

function save(name, obj) {
  const path = new URL(name, OUT);
  writeFileSync(path, JSON.stringify(obj, null, 2));
  console.log(`  saved ${path.pathname}`);
}

async function rest(path) {
  for (const base of REST_BASES) {
    const url = `${base}${path}`;
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      const text = await r.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      console.log(`  ${url} → ${r.status}`);
      return { url, status: r.status, body: parsed };
    } catch (err) {
      console.log(`  ${url} → ${err.message}`);
    }
  }
  return null;
}

async function probeRest() {
  console.log('\n=== REST ===');
  const time = await rest('/time');
  if (time) save('time.json', time);

  const config = await rest('/open/public/config/v1');
  if (config) save('config.json', config);

  for (const base of ['BTC', 'ETH', 'SOL']) {
    const r = await rest(`/open/option/getInstruments/${base}`);
    if (r) save(`instruments-${base}.json`, r);
  }

  return { time, config };
}

async function tryOne(url, sampleSymbol) {
  console.log(`\n  trying ${url}`);
  const frames = [];
  let opened = false;
  let closeInfo = null;

  const ws = new WebSocket(url);

  return new Promise((resolve) => {
    const finish = (reason) => {
      console.log(`    done: ${reason}`);
      try { ws.close(); } catch {}
      resolve({ url, opened, closeInfo, frames, reason });
    };

    const openTimer = setTimeout(() => finish('open timeout 10s'), 10_000);
    const overallTimer = setTimeout(() => finish('overall timeout 45s'), 45_000);

    ws.addEventListener('open', async () => {
      clearTimeout(openTimer);
      opened = true;
      console.log('    open');

      const attempts = [
        { tag: 'action-bsInfo-payload', msg: { action: 'subscribe', dataType: 'bsInfo', payload: { symbol: sampleSymbol } } },
        { tag: 'action-bsInfo-params', msg: { action: 'subscribe', params: { channel: 'bsInfo', symbol: sampleSymbol } } },
        { tag: 'op-subscribe-args', msg: { op: 'subscribe', args: [`bsInfo.${sampleSymbol}`] } },
        { tag: 'subscribe-topic', msg: { action: 'subscribe', topic: `bsInfo.${sampleSymbol}` } },
        { tag: 'type-subscribe-channels', msg: { type: 'subscribe', channels: [`bsInfo.${sampleSymbol}`] } },
      ];

      for (const a of attempts) {
        const line = JSON.stringify(a.msg);
        console.log(`    → [${a.tag}] ${line}`);
        try { ws.send(line); } catch (err) { console.log(`      send err ${err.message}`); }
        frames.push({ kind: 'sent', tag: a.tag, at: Date.now(), msg: a.msg });
        await delay(1500);
      }

      await delay(2000);
      for (const hb of [{ action: 'heartbeat' }, { op: 'ping' }, { type: 'ping' }, 'ping']) {
        const line = typeof hb === 'string' ? hb : JSON.stringify(hb);
        console.log(`    → hb ${line}`);
        try { ws.send(line); } catch {}
        frames.push({ kind: 'sent', tag: 'heartbeat', at: Date.now(), msg: hb });
        await delay(1000);
      }
    });

    ws.addEventListener('message', async (ev) => {
      let raw = ev.data;
      if (raw instanceof Blob) {
        raw = await raw.text();
      } else if (raw instanceof ArrayBuffer) {
        raw = new TextDecoder().decode(raw);
      }
      let parsed = raw;
      try { parsed = JSON.parse(raw); } catch {}
      frames.push({ kind: 'recv', at: Date.now(), raw, parsed });
      const preview = typeof parsed === 'string' ? parsed.slice(0, 240) : JSON.stringify(parsed).slice(0, 240);
      console.log(`    ← ${preview}`);
    });

    ws.addEventListener('close', (ev) => {
      closeInfo = { code: ev.code, reason: ev.reason ?? '', wasClean: ev.wasClean };
      clearTimeout(overallTimer);
      finish(`close ${ev.code}`);
    });

    ws.addEventListener('error', (ev) => {
      const msg = ev.message ?? ev.error?.message ?? 'error';
      frames.push({ kind: 'error', at: Date.now(), msg });
      console.log(`    ! ${msg}`);
    });
  });
}

async function probeWs({ sampleSymbol }) {
  console.log('\n=== WS ===');
  const results = [];
  for (const url of WS_CANDIDATES) {
    const r = await tryOne(url, sampleSymbol);
    save(`ws-${url.replace(/[^a-z0-9]/gi, '_')}.json`, r);
    results.push(r);
    if (r.opened && r.frames.some((f) => f.kind === 'recv' && typeof f.parsed === 'object')) {
      console.log(`\n  *** ${url} returned data`);
      return r;
    }
  }
  // Return the first that at least opened, else null
  return results.find((r) => r.opened) ?? null;
}

function pickInstrument(instrumentsResp) {
  if (!instrumentsResp) return 'BTCUSD-27JUN25-70000-C';
  const data = instrumentsResp.body?.data ?? instrumentsResp.body;
  if (!Array.isArray(data) || data.length === 0) return 'BTCUSD-27JUN25-70000-C';
  const mid = Math.floor(data.length / 2);
  const pick = data[mid];
  const sym = pick.symbol ?? pick.instrument ?? pick.name;
  console.log(`\n  sample instrument (idx ${mid}/${data.length}): ${sym}`);
  return sym ?? 'BTCUSD-27JUN25-70000-C';
}

async function main() {
  await probeRest();
  const btcInstr = await rest('/open/option/getInstruments/BTC');
  const sampleSymbol = pickInstrument(btcInstr);
  const wsResult = await probeWs({ sampleSymbol });
  save('summary.json', {
    sampleSymbol,
    wsWinner: wsResult?.url ?? null,
    wsOpened: wsResult?.opened ?? false,
    wsClose: wsResult?.closeInfo ?? null,
    wsFrameCount: wsResult?.frames.length ?? 0,
  });
  console.log('\n=== done ===');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
