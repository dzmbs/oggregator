/**
 * Cross-venue data audit — compares our stored quotes against live exchange REST APIs.
 *
 * Usage:
 *   pnpm tsx src/scripts/audit-venues.ts [underlying] [expiry]
 *   pnpm tsx src/scripts/audit-venues.ts BTC
 *   pnpm tsx src/scripts/audit-venues.ts BTC 2026-03-28
 *
 * Requires the backend to be running on localhost:3100.
 * Fetches ground truth from all 5 exchange REST APIs and compares per-venue
 * bid, ask, and markIv against what our enriched chain response stores.
 *
 * Tolerances (live WS snapshot vs fresh REST query are never perfectly synchronous):
 *   bid/ask:  ±3% of our value
 *   markIv:   ±2 percentage points (0.02 in fraction form)
 *   delta:    ±5 points (0.05)
 */

import WebSocket from 'ws';

// ── Config ────────────────────────────────────────────────────────────────────

const SERVER = 'http://localhost:3100';
const BID_ASK_TOL = 0.03;
const IV_TOL = 0.02;
const DELTA_TOL = 0.05;

// Only compare strikes within this fraction of spot — deep OTM has zero liquidity
// and produces too many noise mismatches (one-sided markets, stale quotes).
const STRIKE_BAND = 0.12;

// ── ANSI colours ──────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

// ── Exchange raw types (plain interfaces, no library needed for a dev script) ──

interface OurVenueQuote {
  bid: number | null;
  ask: number | null;
  markIv: number | null;
  delta: number | null;
  [k: string]: unknown;
}
interface OurSide {
  venues: Record<string, OurVenueQuote>;
  bestIv: number | null;
  bestVenue: string | null;
}
interface OurStrike {
  strike: number;
  call: OurSide;
  put: OurSide;
}
interface OurChain {
  underlying: string;
  expiry: string;
  stats: { forwardPriceUsd: number | null; indexPriceUsd: number | null };
  strikes: OurStrike[];
}
interface HealthBody {
  status: string;
}
interface ExpiriesBody {
  expiries: string[];
}

// Deribit book summary item
interface DItem {
  instrument_name: string;
  bid_price?: number | null;
  ask_price?: number | null;
  mark_iv?: number | null;
  underlying_price?: number | null;
}
// OKX ticker item
interface OkxTItem {
  instId: string;
  bidPx?: string;
  askPx?: string;
}
// OKX opt-summary item
interface OkxSItem {
  instId: string;
  markVol?: string;
  deltaBS?: string;
  fwdPx?: string;
}
// Bybit ticker item
interface BybitTItem {
  symbol: string;
  bidPrice?: string;
  askPrice?: string;
  markPriceIv?: string;
  delta?: string;
}
// Binance ticker item
interface BnTItem {
  symbol: string;
  bidPrice?: string;
  askPrice?: string;
}
// Binance mark item
interface BnMItem {
  symbol: string;
  markIV?: string;
  delta?: string;
}
// Derive ticker item
interface DrvItem {
  b?: string | null;
  a?: string | null;
  option_pricing?: { i?: string | null; d?: string | null } | null;
  [k: string]: unknown;
}

// Runtime cast helpers — this script hits external APIs; we trust enough to cast
// and let missing/wrong fields surface as null via safeFloat rather than crashes.
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asObj(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Quote {
  bid: number | null;
  ask: number | null;
  markIv: number | null;
  delta: number | null;
}

// Key: `${strike}-${'call'|'put'}`
type ExchangeMap = Map<string, Quote>;

type Status = 'ok' | 'warn' | 'fail' | 'skip';

interface FieldResult {
  field: string;
  ours: number | null;
  theirs: number | null;
  pct: number | null;
  status: Status;
}

interface VenueResult {
  venue: string;
  fields: FieldResult[];
}

interface StrikeResult {
  strike: number;
  right: 'call' | 'put';
  venues: VenueResult[];
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Extract strike and right from any exchange symbol format. */
function parseSymbolKey(symbol: string): string | null {
  // Matches: ...-STRIKE-C or ...-STRIKE-P (optionally followed by -USDT etc.)
  const m = symbol.match(/-(\d+(?:\.\d+)?)-([CP])(?:-|$)/);
  if (!m) return null;
  const right = m[2] === 'C' ? 'call' : 'put';
  return `${Number(m[1])}-${right}`;
}

function strikeKey(strike: number, right: 'call' | 'put'): string {
  return `${strike}-${right}`;
}

function safeFloat(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Compare two values with a given tolerance. Returns null diff if either value is 0 or null. */
function compare(
  field: string,
  ours: number | null,
  theirs: number | null,
  tol: number,
): FieldResult {
  if (ours == null || theirs == null || ours === 0 || theirs === 0) {
    return { field, ours, theirs, pct: null, status: 'skip' };
  }

  const pct = Math.abs(ours - theirs) / Math.abs(ours);
  let status: Status;
  if (pct <= tol) {
    status = 'ok';
  } else if (pct <= tol * 3) {
    status = 'warn';
  } else {
    status = 'fail';
  }

  return { field, ours, theirs, pct, status };
}

/** Same as compare but for absolute difference (used for IV and delta). */
function compareAbs(
  field: string,
  ours: number | null,
  theirs: number | null,
  tol: number,
): FieldResult {
  if (ours == null || theirs == null || ours === 0 || theirs === 0) {
    return { field, ours, theirs, pct: null, status: 'skip' };
  }

  const diff = Math.abs(ours - theirs);
  let status: Status;
  if (diff <= tol) {
    status = 'ok';
  } else if (diff <= tol * 3) {
    status = 'warn';
  } else {
    status = 'fail';
  }

  return { field, ours, theirs, pct: diff, status };
}

// ── Backend helpers ───────────────────────────────────────────────────────────

async function waitForReady(maxWaitMs = 60_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  process.stdout.write(`${C.dim}Waiting for backend at ${SERVER}...${C.reset}`);

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SERVER}/api/health`);
      const body = asObj(await res.json()) as unknown as HealthBody;
      if (body.status === 'ok') {
        process.stdout.write(` ${C.green}ready${C.reset}\n`);
        return;
      }
    } catch {
      /* backend not up yet */
    }
    await new Promise((r) => setTimeout(r, 1_000));
    process.stdout.write('.');
  }

  throw new Error('Backend did not become ready within 60s');
}

async function getNearestExpiry(underlying: string): Promise<string> {
  const res = await fetch(`${SERVER}/api/expiries?underlying=${encodeURIComponent(underlying)}`);
  const body = asObj(await res.json()) as unknown as ExpiriesBody;
  if (!body.expiries?.length) throw new Error(`No expiries found for ${underlying}`);
  return body.expiries[0]!;
}

async function fetchOurChain(underlying: string, expiry: string): Promise<OurChain> {
  const res = await fetch(
    `${SERVER}/api/chains?underlying=${underlying}&expiry=${expiry}&venues=deribit,okx,binance,bybit,derive`,
  );
  return asObj(await res.json()) as unknown as OurChain;
}

// ── Exchange fetchers ─────────────────────────────────────────────────────────

/**
 * Convert canonical expiry (YYYY-MM-DD) to each exchange's symbol date format.
 * Exchange bulk endpoints return ALL expiries — we must filter to the one we're
 * auditing, otherwise the same strike from a different expiry overwrites our map.
 */
function toExpiryToken(expiry: string, format: 'DDMONYY' | 'YYMMDD' | 'YYYYMMDD'): string {
  const [yyyy, mm, dd] = expiry.split('-') as [string, string, string];
  if (format === 'YYYYMMDD') return `${yyyy}${mm}${dd}`;
  if (format === 'YYMMDD') return `${yyyy.slice(2)}${mm}${dd}`;
  // DDMONYY — used by Deribit and Bybit
  const MONTHS = [
    '',
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  return `${dd}${MONTHS[Number(mm)]!}${yyyy.slice(2)}`;
}

/** Deribit: bulk book summary. Prices in BTC → multiply by underlying_price for USD. */
async function fetchDeribit(currency: string, expiry: string): Promise<ExchangeMap> {
  const map: ExchangeMap = new Map();

  const expiryToken = toExpiryToken(expiry, 'DDMONYY'); // e.g. 27MAR26
  // Request both BTC and USDC to cover BTC and BTC_USDC underlyings in one pass.
  const currencies = currency === 'BTC' ? ['BTC', 'USDC'] : [currency];

  for (const cur of currencies) {
    try {
      const res = await fetch(
        `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${cur}&kind=option`,
      );
      const body = asObj(await res.json());
      const result = asArr(body['result']);

      for (const raw of result) {
        const item = asObj(raw) as unknown as DItem;
        // Skip instruments from other expiries — bulk endpoint returns everything
        if (!item.instrument_name.includes(expiryToken)) continue;
        const key = parseSymbolKey(item.instrument_name);
        if (!key || map.has(key)) continue;

        const underlying = typeof item.underlying_price === 'number' ? item.underlying_price : null;
        const bidRaw = typeof item.bid_price === 'number' ? item.bid_price : null;
        const askRaw = typeof item.ask_price === 'number' ? item.ask_price : null;
        const markIvRaw = typeof item.mark_iv === 'number' ? item.mark_iv : null;

        map.set(key, {
          // Deribit inverse options quote prices in BTC — convert to USD
          bid: bidRaw != null && underlying != null ? bidRaw * underlying : null,
          ask: askRaw != null && underlying != null ? askRaw * underlying : null,
          markIv: markIvRaw != null ? markIvRaw / 100 : null, // percentage → fraction
          delta: null, // not available in bulk book summary
        });
      }
    } catch {
      /* exchange unreachable */
    }
  }

  return map;
}

/** OKX: tickers (bid/ask in BTC) + opt-summary (IV, delta, fwdPx for USD conversion). */
async function fetchOkx(underlying: string, expiry: string): Promise<ExchangeMap> {
  const map: ExchangeMap = new Map();
  const instFamily = `${underlying}-USD`;
  const expiryToken = toExpiryToken(expiry, 'YYMMDD'); // e.g. 260327

  const [tickerRes, summaryRes] = await Promise.allSettled([
    fetch(`https://www.okx.com/api/v5/market/tickers?instType=OPTION&instFamily=${instFamily}`),
    fetch(`https://www.okx.com/api/v5/public/opt-summary?uly=${instFamily}&expTime=${expiryToken}`),
  ]);

  const summaryIndex = new Map<
    string,
    { markIv: number | null; delta: number | null; fwdPx: number | null }
  >();

  if (summaryRes.status === 'fulfilled') {
    try {
      const data = asArr(asObj(await summaryRes.value.json())['data']);
      for (const raw of data) {
        const item = asObj(raw) as unknown as OkxSItem;
        if (typeof item.instId !== 'string') continue;
        summaryIndex.set(item.instId, {
          markIv: safeFloat(item.markVol),
          delta: safeFloat(item.deltaBS),
          fwdPx: safeFloat(item.fwdPx),
        });
      }
    } catch {
      /* parse error */
    }
  }

  if (tickerRes.status === 'fulfilled') {
    try {
      const data = asArr(asObj(await tickerRes.value.json())['data']);
      for (const raw of data) {
        const item = asObj(raw) as unknown as OkxTItem;
        if (typeof item.instId !== 'string') continue;
        // Filter to target expiry — tickers returns all expiries for the instFamily
        if (!item.instId.includes(expiryToken)) continue;

        const key = parseSymbolKey(item.instId);
        if (!key) continue;

        const summary = summaryIndex.get(item.instId);
        const fwdPx = summary?.fwdPx ?? null;
        const bidRaw = safeFloat(item.bidPx);
        const askRaw = safeFloat(item.askPx);

        map.set(key, {
          // OKX BTC-USD options are inverse: prices in BTC → multiply by fwdPx for USD
          bid: bidRaw != null && fwdPx != null ? bidRaw * fwdPx : null,
          ask: askRaw != null && fwdPx != null ? askRaw * fwdPx : null,
          markIv: summary?.markIv ?? null,
          delta: summary?.delta ?? null,
        });
      }
    } catch {
      /* parse error */
    }
  }

  return map;
}

/** Binance: ticker (bid/ask USDT) + mark (IV fraction, delta). Merged by symbol. */
async function fetchBinance(expiry: string): Promise<ExchangeMap> {
  const map: ExchangeMap = new Map();
  const expiryToken = toExpiryToken(expiry, 'YYMMDD'); // e.g. 260327

  const [tickerRes, markRes] = await Promise.allSettled([
    fetch('https://eapi.binance.com/eapi/v1/ticker'),
    fetch('https://eapi.binance.com/eapi/v1/mark'),
  ]);

  const bidAsk = new Map<string, { bid: number | null; ask: number | null }>();

  if (tickerRes.status === 'fulfilled') {
    try {
      for (const raw of asArr(await tickerRes.value.json())) {
        const item = asObj(raw) as unknown as BnTItem;
        if (typeof item.symbol !== 'string') continue;
        if (!item.symbol.includes(expiryToken)) continue; // skip other expiries
        bidAsk.set(item.symbol, { bid: safeFloat(item.bidPrice), ask: safeFloat(item.askPrice) });
      }
    } catch {
      /* parse error */
    }
  }

  if (markRes.status === 'fulfilled') {
    try {
      for (const raw of asArr(await markRes.value.json())) {
        const item = asObj(raw) as unknown as BnMItem;
        if (typeof item.symbol !== 'string') continue;
        if (!item.symbol.includes(expiryToken)) continue; // skip other expiries

        const key = parseSymbolKey(item.symbol);
        if (!key) continue;

        const prices = bidAsk.get(item.symbol);
        map.set(key, {
          bid: prices?.bid ?? null,
          ask: prices?.ask ?? null,
          markIv: safeFloat(item.markIV), // already a fraction
          delta: safeFloat(item.delta),
        });
      }
    } catch {
      /* parse error */
    }
  }

  return map;
}

/** Bybit: single bulk ticker endpoint — bid/ask in USDT, markPriceIv fraction, delta included. */
async function fetchBybit(underlying: string, expiry: string): Promise<ExchangeMap> {
  const map: ExchangeMap = new Map();
  const expiryToken = toExpiryToken(expiry, 'DDMONYY'); // e.g. 27MAR26

  try {
    const res = await fetch(
      `https://api.bybit.com/v5/market/tickers?category=option&baseCoin=${underlying}`,
    );
    const body = asObj(await res.json());
    if (body['retCode'] !== 0) return map;

    for (const raw of asArr(asObj(body['result'])['list'])) {
      const item = asObj(raw) as unknown as BybitTItem;
      if (typeof item.symbol !== 'string') continue;
      if (!item.symbol.includes(expiryToken)) continue; // skip other expiries

      const key = parseSymbolKey(item.symbol);
      if (!key) continue;

      map.set(key, {
        bid: safeFloat(item.bidPrice),
        ask: safeFloat(item.askPrice),
        markIv: safeFloat(item.markPriceIv), // already a fraction
        delta: safeFloat(item.delta),
      });
    }
  } catch {
    /* exchange unreachable */
  }

  return map;
}

/**
 * Derive: WebSocket JSON-RPC public/get_tickers per currency+expiry.
 * Abbreviated keys: b=bid_price, a=ask_price (corrected mapping), option_pricing.i=IV.
 */
async function fetchDerive(currency: string, expiry: string): Promise<ExchangeMap> {
  const expiryDate = expiry.replace(/-/g, ''); // 2026-03-28 → 20260328
  const map: ExchangeMap = new Map();

  return new Promise((resolve) => {
    const ws = new WebSocket('wss://api.lyra.finance/ws');
    let settled = false;

    const done = () => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(map);
    };

    const timeout = setTimeout(done, 20_000);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'public/get_tickers',
          params: { instrument_type: 'option', currency, expiry_date: expiryDate },
        }),
      );
    });

    ws.on('message', (raw) => {
      try {
        const msg = asObj(JSON.parse(raw.toString()));
        if (msg['id'] !== 1) return;

        const tickers = asObj(asObj(msg['result'])['tickers']);
        for (const [name, ticker] of Object.entries(tickers)) {
          const item = asObj(ticker) as DrvItem;
          const key = parseSymbolKey(name);
          if (!key) continue;

          const op = item.option_pricing
            ? (asObj(item.option_pricing) as { i?: string | null; d?: string | null })
            : null;
          map.set(key, {
            bid: safeFloat(item.b), // b = best_bid_price (corrected mapping)
            ask: safeFloat(item.a), // a = best_ask_price
            markIv: safeFloat(op?.i), // already a fraction
            delta: safeFloat(op?.d),
          });
        }
      } catch {
        /* malformed frame */
      }

      clearTimeout(timeout);
      done();
    });

    ws.on('error', () => {
      clearTimeout(timeout);
      done();
    });
  });
}

// ── Comparison ────────────────────────────────────────────────────────────────

function compareQuotes(ours: Quote, theirs: Quote): FieldResult[] {
  return [
    compare('bid', ours.bid, theirs.bid, BID_ASK_TOL),
    compare('ask', ours.ask, theirs.ask, BID_ASK_TOL),
    compareAbs('markIv', ours.markIv, theirs.markIv, IV_TOL),
    compareAbs('delta', ours.delta, theirs.delta, DELTA_TOL),
  ];
}

// ── Reporter ──────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<Status, string> = {
  ok: `${C.green}✅${C.reset}`,
  warn: `${C.yellow}⚠️ ${C.reset}`,
  fail: `${C.red}❌${C.reset}`,
  skip: `${C.dim}——${C.reset}`,
};

function fmtField(r: FieldResult): string {
  if (r.status === 'skip') {
    const oursStr = r.ours != null ? fmtVal(r.field, r.ours) : 'null';
    const theirsStr = r.theirs != null ? fmtVal(r.field, r.theirs) : 'null';
    return `${C.dim}${r.field}: ${oursStr} vs ${theirsStr}${C.reset}`;
  }

  const ours = fmtVal(r.field, r.ours!);
  const theirs = fmtVal(r.field, r.theirs!);
  const diff =
    r.field === 'markIv' || r.field === 'delta'
      ? `${((r.pct ?? 0) * 100).toFixed(2)}pp`
      : `${((r.pct ?? 0) * 100).toFixed(1)}%`;

  const diffStr =
    r.status === 'ok'
      ? `${C.dim}(${diff})${C.reset}`
      : r.status === 'warn'
        ? `${C.yellow}(${diff})${C.reset}`
        : `${C.red}(${diff})${C.reset}`;

  return `${STATUS_ICON[r.status]} ${r.field}: ${ours} vs ${theirs} ${diffStr}`;
}

function fmtVal(field: string, v: number): string {
  if (field === 'bid' || field === 'ask') return `$${v.toFixed(1)}`;
  if (field === 'markIv') return `${(v * 100).toFixed(1)}%`;
  if (field === 'delta') return v.toFixed(3);
  return v.toFixed(4);
}

const VENUE_LABEL: Record<string, string> = {
  deribit: `${C.cyan}deribit${C.reset}`,
  okx: `${C.white}okx    ${C.reset}`,
  binance: `${C.yellow}binance${C.reset}`,
  bybit: `${C.yellow}bybit  ${C.reset}`,
  derive: `${C.green}derive ${C.reset}`,
};

function printStrikeResult(sr: StrikeResult): void {
  const rightLabel = sr.right === 'call' ? 'CALL' : 'PUT ';
  console.log(`\n  ${C.bold}${sr.strike.toLocaleString()} ${rightLabel}${C.reset}`);

  for (const vr of sr.venues) {
    const label = VENUE_LABEL[vr.venue] ?? vr.venue;
    const nonSkip = vr.fields.filter((f) => f.status !== 'skip');

    if (nonSkip.length === 0) {
      console.log(`    ${label}  ${C.dim}no data from exchange${C.reset}`);
      continue;
    }

    const fieldStrs = nonSkip.map(fmtField).join('  ');
    console.log(`    ${label}  ${fieldStrs}`);
  }
}

interface Tally {
  ok: number;
  warn: number;
  fail: number;
  skip: number;
}

function printSummary(results: StrikeResult[], elapsed: number): void {
  const byVenue: Record<string, Tally> = {};
  const failures: {
    strike: number;
    right: string;
    venue: string;
    field: string;
    ours: number | null;
    theirs: number | null;
    pct: number | null;
  }[] = [];

  for (const sr of results) {
    for (const vr of sr.venues) {
      byVenue[vr.venue] ??= { ok: 0, warn: 0, fail: 0, skip: 0 };
      for (const f of vr.fields) {
        byVenue[vr.venue]![f.status]++;
        if (f.status === 'fail') {
          failures.push({
            strike: sr.strike,
            right: sr.right,
            venue: vr.venue,
            field: f.field,
            ours: f.ours,
            theirs: f.theirs,
            pct: f.pct,
          });
        }
      }
    }
  }

  const SEP = `${'─'.repeat(64)}`;
  console.log(`\n${C.bold}${SEP}`);
  console.log('SUMMARY');
  console.log(`${SEP}${C.reset}`);

  console.log(
    `\n  ${'Venue'.padEnd(10)} ${'✅ OK'.padStart(6)} ${'⚠️ Warn'.padStart(8)} ${'❌ Fail'.padStart(8)} ${'— Skip'.padStart(8)}`,
  );
  console.log(`  ${'─'.repeat(44)}`);

  for (const venue of ['deribit', 'okx', 'binance', 'bybit', 'derive']) {
    const t = byVenue[venue];
    if (!t) continue;
    console.log(
      `  ${venue.padEnd(10)} ${String(t.ok).padStart(6)} ${String(t.warn).padStart(8)} ${String(t.fail).padStart(8)} ${String(t.skip).padStart(8)}`,
    );
  }

  const tallies = Object.values(byVenue);
  const totOk = tallies.reduce((s, t) => s + t.ok, 0);
  const totWarn = tallies.reduce((s, t) => s + t.warn, 0);
  const totFail = tallies.reduce((s, t) => s + t.fail, 0);
  const totSkip = tallies.reduce((s, t) => s + t.skip, 0);

  console.log(
    `\n  Total: ${C.green}${totOk} ok${C.reset}  ${C.yellow}${totWarn} warn${C.reset}  ${C.red}${totFail} fail${C.reset}  ${C.dim}${totSkip} skipped${C.reset}  ${C.dim}(${elapsed}ms)${C.reset}`,
  );

  if (failures.length > 0) {
    console.log(`\n${C.red}${C.bold}  FAILURES:${C.reset}`);
    for (const f of failures) {
      const oursStr = f.ours != null ? fmtVal(f.field, f.ours) : 'null';
      const theirsStr = f.theirs != null ? fmtVal(f.field, f.theirs) : 'null';
      const diff =
        f.pct != null
          ? `${(f.pct * 100).toFixed(1)}${f.field === 'markIv' || f.field === 'delta' ? 'pp' : '%'}`
          : '?';
      console.log(
        `  ${C.red}❌ ${f.venue.padEnd(8)} ${f.right} ${String(f.strike).padStart(7)}  ${f.field}: ours=${oursStr} exchange=${theirsStr} (off by ${diff})${C.reset}`,
      );
    }
  } else if (totWarn === 0) {
    console.log(
      `\n  ${C.green}${C.bold}All checked fields within tolerance. Data looks good.${C.reset}`,
    );
  }

  console.log('');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const underlying = process.argv[2] ?? 'BTC';
  const expiryArg = process.argv[3];

  await waitForReady();

  const expiry = expiryArg ?? (await getNearestExpiry(underlying));
  console.log(`\n${C.bold}Auditing: ${underlying}  Expiry: ${expiry}${C.reset}`);

  console.log(`${C.dim}Fetching our chain from backend...${C.reset}`);
  const chain = await fetchOurChain(underlying, expiry);
  const spot = chain.stats.indexPriceUsd ?? chain.stats.forwardPriceUsd;

  // Focus on liquid strikes near the money
  const activeStrikes = chain.strikes.filter(
    (s) =>
      spot == null ||
      (s.strike >= spot * (1 - STRIKE_BAND) && s.strike <= spot * (1 + STRIKE_BAND)),
  );

  console.log(
    `  Spot: ${spot != null ? `$${spot.toLocaleString()}` : 'unknown'}  Strikes in band: ${activeStrikes.length} of ${chain.strikes.length} total`,
  );
  console.log(`${C.dim}Fetching ground truth from 5 exchanges in parallel...${C.reset}`);

  const fetchStart = Date.now();
  const [deribitRes, okxRes, binanceRes, bybitRes, deriveRes] = await Promise.allSettled([
    fetchDeribit(underlying, expiry),
    fetchOkx(underlying, expiry),
    fetchBinance(expiry),
    fetchBybit(underlying, expiry),
    fetchDerive(underlying, expiry),
  ]);

  const exchangeData: Record<string, ExchangeMap> = {
    deribit: deribitRes.status === 'fulfilled' ? deribitRes.value : new Map(),
    okx: okxRes.status === 'fulfilled' ? okxRes.value : new Map(),
    binance: binanceRes.status === 'fulfilled' ? binanceRes.value : new Map(),
    bybit: bybitRes.status === 'fulfilled' ? bybitRes.value : new Map(),
    derive: deriveRes.status === 'fulfilled' ? deriveRes.value : new Map(),
  };

  const fetchMs = Date.now() - fetchStart;

  // Report which exchanges failed to respond
  const failed = (['deribit', 'okx', 'binance', 'bybit', 'derive'] as const)
    .filter((v) => (exchangeData[v]?.size ?? 0) === 0)
    .join(', ');
  if (failed) console.log(`  ${C.yellow}⚠️  No data returned from: ${failed}${C.reset}`);

  console.log(`  ${C.dim}Ground truth fetched in ${fetchMs}ms${C.reset}`);

  const SEP = `${'─'.repeat(64)}`;
  console.log(`\n${C.bold}${SEP}\n Results (our value vs exchange live value)\n${SEP}${C.reset}`);

  const results: StrikeResult[] = [];

  for (const right of ['call', 'put'] as const) {
    for (const strike of activeStrikes) {
      const ourSide = right === 'call' ? strike.call : strike.put;
      const sr: StrikeResult = { strike: strike.strike, right, venues: [] };

      for (const venue of ['deribit', 'okx', 'binance', 'bybit', 'derive'] as const) {
        const ourQuote = ourSide.venues[venue];
        if (!ourQuote) continue; // venue not in our response for this expiry

        const key = strikeKey(strike.strike, right);
        const exchange = exchangeData[venue]?.get(key);

        const ours: Quote = {
          bid: ourQuote.bid,
          ask: ourQuote.ask,
          markIv: ourQuote.markIv,
          delta: ourQuote.delta,
        };

        const theirs: Quote = exchange ?? { bid: null, ask: null, markIv: null, delta: null };
        const fields = compareQuotes(ours, theirs);
        sr.venues.push({ venue, fields });
      }

      if (sr.venues.length > 0) {
        results.push(sr);
        printStrikeResult(sr);
      }
    }
  }

  printSummary(results, fetchMs);
}

main().catch((err: unknown) => {
  console.error(`${C.red}Fatal:${C.reset}`, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
