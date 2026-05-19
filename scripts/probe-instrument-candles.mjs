#!/usr/bin/env node
// Check whether the per-instrument chart endpoint is producing live candles
// for every venue and every wired underlying.
//
// For each (underlying, expiry) it picks the strike closest to ATM, then for
// every venue that quotes that strike it asks /api/instrument-candles and
// reports: candle count, last candle age, markLine count, last mark age, and
// a flag for whether the chart will keep moving when opened.
//
// Usage:
//   node scripts/probe-instrument-candles.mjs
//   UNDERLYINGS=BTC,ETH,LIT node scripts/probe-instrument-candles.mjs
//   API=http://localhost:3100/api node scripts/probe-instrument-candles.mjs
//   INTERVAL=15m RANGE=7d node scripts/probe-instrument-candles.mjs

const API = process.env.API ?? 'https://api.oggregator.xyz/api';
const UNDERLYINGS = (process.env.UNDERLYINGS ?? 'BTC,ETH,SOL,LIT').split(',').map((s) => s.trim()).filter(Boolean);
const INTERVAL = process.env.INTERVAL ?? '1h';  // 1m | 5m | 15m | 1h | 4h | 1d
const RANGE = process.env.RANGE ?? '1d';        // 1d | 7d | 30d | max

// Same MONTHS list as packages/web/src/features/chain/instrument-symbol.ts
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function parseExpiry(expiry) {
  const d = new Date(`${expiry}T00:00:00Z`);
  return { day: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear() };
}

function toVenueSymbol(venue, underlying, expiry, strike, type) {
  const { day, month, year } = parseExpiry(expiry);
  const yr = String(year).slice(-2);
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const cp = type === 'call' ? 'C' : 'P';
  switch (venue) {
    case 'deribit':  return `${underlying}-${day}${MONTHS[month]}${yr}-${strike}-${cp}`;
    case 'binance':  return `${underlying}-${yr}${mm}${dd}-${strike}-${cp}`;
    case 'okx':      return `${underlying}-USD-${yr}${mm}${dd}-${strike}-${cp}`;
    case 'gateio':   return `${underlying}_USDT-${year}${mm}${dd}-${strike}-${cp}`;
    case 'bybit':    return `${underlying}-${day}${MONTHS[month]}${yr}-${strike}-${cp}-USDT`;
    case 'derive':   return `${underlying}-${year}${mm}${dd}-${strike}-${cp}`;
    case 'thalex':   return `${underlying}-${day}${MONTHS[month]}${yr}-${strike}-${cp}`;
    case 'coincall': return `${underlying}USD-${day}${MONTHS[month]}${yr}-${strike}-${cp}`;
    default: throw new Error(`unknown venue ${venue}`);
  }
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

function ageMin(tsMs) {
  if (tsMs == null) return null;
  return Math.round((Date.now() - tsMs) / 60_000);
}

function pad(s, n) { return String(s).padEnd(n); }

function pickNearAtm(chain) {
  if (!chain?.strikes?.length) return null;
  // Use index price if available, else median strike
  const ix = chain.stats?.indexPriceUsd ?? chain.stats?.forwardPriceUsd ?? null;
  if (ix != null) {
    let best = chain.strikes[0];
    let bestD = Math.abs(best.strike - ix);
    for (const s of chain.strikes) {
      const d = Math.abs(s.strike - ix);
      if (d < bestD) { best = s; bestD = d; }
    }
    return { row: best, indexPrice: ix };
  }
  return { row: chain.strikes[Math.floor(chain.strikes.length / 2)], indexPrice: null };
}

async function probeUnderlying(underlying) {
  console.log(`\n══════════ ${underlying} ══════════`);

  const exp = await fetchJson(`${API}/expiries?underlying=${underlying}`);
  if (exp.status !== 200 || !exp.body?.expiries?.length) {
    console.log(`  ✘ no expiries (${exp.status})`);
    return;
  }
  // Skip the soonest if it's same-day or 0-day expiry — pick first that's >2d out
  const now = Date.now();
  const expiries = exp.body.expiries;
  const target =
    expiries.find((e) => new Date(`${e}T08:00:00Z`).getTime() - now > 2 * 24 * 3600_000) ??
    expiries[0];

  const chain = await fetchJson(`${API}/chains?underlying=${underlying}&expiry=${target}`);
  if (chain.status !== 200 || !chain.body?.strikes?.length) {
    console.log(`  ✘ no chain for ${target} (${chain.status})`);
    return;
  }
  const ix = chain.body.stats?.indexPriceUsd ?? chain.body.stats?.forwardPriceUsd ?? null;
  console.log(`  expiry=${target}  index=${ix ?? '?'}  strikes=${chain.body.strikes.length}`);

  // For each venue, pick the closest-to-ATM strike that venue actually quotes.
  const sortedByDist = ix != null
    ? [...chain.body.strikes].sort((a, b) => Math.abs(a.strike - ix) - Math.abs(b.strike - ix))
    : chain.body.strikes;

  const venueChoice = new Map(); // venue -> { strike, type }
  for (const row of sortedByDist) {
    for (const [venue, q] of Object.entries(row.call?.venues ?? {})) {
      if (q && !venueChoice.has(venue)) venueChoice.set(venue, { strike: row.strike, type: 'call' });
    }
    for (const [venue, q] of Object.entries(row.put?.venues ?? {})) {
      if (q && !venueChoice.has(venue)) venueChoice.set(venue, { strike: row.strike, type: 'put' });
    }
  }
  if (venueChoice.size === 0) {
    console.log('  ✘ no venue quotes any strike');
    return;
  }

  const venues = [...venueChoice.keys()].sort();
  console.log(`  ${pad('venue', 10)} ${pad('symbol', 32)} ${pad('candles', 8)} ${pad('lastBar', 9)} ${pad('marks', 6)} ${pad('lastMark', 9)} live?`);
  for (const venue of venues) {
    const { strike, type } = venueChoice.get(venue);
    let sym;
    try {
      sym = toVenueSymbol(venue, underlying, target, strike, type);
    } catch (err) {
      console.log(`  ${pad(venue, 10)} ${pad('?', 32)} symbol build failed: ${err.message}`);
      continue;
    }
    const url = `${API}/instrument-candles?venue=${venue}&symbol=${encodeURIComponent(sym)}&interval=${INTERVAL}&range=${RANGE}`;
    const r = await fetchJson(url);
    if (r.status !== 200) {
      const code = r.body?.code ?? r.body?.error ?? '';
      console.log(`  ${pad(venue, 10)} ${pad(sym, 32)} ✘ ${r.status} ${String(code).slice(0, 80)}`);
      continue;
    }
    const candles = r.body?.candles ?? [];
    const marks = r.body?.markLine ?? [];
    const lastCandle = candles[candles.length - 1] ?? null;
    const lastMark = marks[marks.length - 1] ?? null;
    const cAge = lastCandle ? ageMin(lastCandle.ts) : null;
    const mAge = lastMark ? ageMin(lastMark.ts) : null;

    // "Alive" = at least one of {trade candle, mark line} has a bucket within
    // the last hour (using 1h interval; tweak if INTERVAL changes).
    const live =
      (cAge != null && cAge < 90) ||
      (mAge != null && mAge < 10);

    console.log(
      `  ${pad(venue, 10)} ${pad(sym, 32)} ${pad(candles.length, 8)} ${pad(cAge != null ? cAge + 'm' : '—', 9)} ${pad(marks.length, 6)} ${pad(mAge != null ? mAge + 'm' : '—', 9)} ${live ? '✓' : '✘'}`,
    );
  }
}

async function main() {
  console.log(`API=${API}  interval=${INTERVAL}  range=${RANGE}`);
  for (const u of UNDERLYINGS) {
    try {
      await probeUnderlying(u);
    } catch (err) {
      console.log(`  ${u}: probe failed → ${err.message}`);
    }
  }
  console.log('\ndone.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
