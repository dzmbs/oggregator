import type { Leg } from './payoff';

type DecodedLeg = Omit<Leg, 'id'>;

const NULL_GREEKS = {
  delta: null,
  gamma: null,
  theta: null,
  vega: null,
  iv: null,
} as const;

const LEG_RE = /^(b|s)(c|p)(\d+(?:\.\d+)?)@(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?$/;

function modeOf(values: string[]): string | null {
  const first = values[0];
  if (first === undefined) return null;
  const counts = new Map<string, number>();
  let best = first;
  let bestCount = 0;
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      bestCount = c;
      best = v;
    }
  }
  return best;
}

function encodeLeg(leg: Leg, defV: string | null, defE: string | null): string {
  const dir = leg.direction === 'buy' ? 'b' : 's';
  const type = leg.type === 'call' ? 'c' : 'p';
  const price = Math.round(leg.entryPrice * 100) / 100;
  let s = `${dir}${type}${leg.strike}@${price}`;
  if (leg.quantity !== 1) s += `x${leg.quantity}`;
  if (leg.venue && leg.venue !== defV) s += `!v=${leg.venue}`;
  if (leg.expiry && leg.expiry !== defE) s += `!e=${leg.expiry}`;
  return s;
}

function decodeLeg(token: string, defV: string, defE: string): DecodedLeg | null {
  const parts = token.split('!');
  const head = parts[0];
  if (head === undefined) return null;
  const m = LEG_RE.exec(head.trim());
  if (!m) return null;
  const [, dir, type, strike, price, qty] = m;
  let venue = defV;
  let expiry = defE;
  for (const override of parts.slice(1)) {
    const eq = override.indexOf('=');
    if (eq < 0) continue;
    const key = override.slice(0, eq);
    const val = override.slice(eq + 1);
    if (key === 'v') venue = val;
    else if (key === 'e') expiry = val;
  }
  return {
    direction: dir === 'b' ? ('buy' as const) : ('sell' as const),
    type: type === 'c' ? ('call' as const) : ('put' as const),
    strike: Number(strike),
    expiry,
    quantity: qty ? Number(qty) : 1,
    entryPrice: Number(price),
    venue,
    ...NULL_GREEKS,
  };
}

function decodeLegacy(encoded: string): { underlying: string; legs: DecodedLeg[] } | null {
  try {
    const data = JSON.parse(atob(encoded));
    if (!data?.u || !Array.isArray(data.l)) return null;
    const legs: DecodedLeg[] = data.l.map((l: Record<string, unknown>) => ({
      direction: l.d === 'b' ? ('buy' as const) : ('sell' as const),
      type: l.t === 'c' ? ('call' as const) : ('put' as const),
      strike: Number(l.k),
      expiry: String(l.e),
      quantity: Number(l.q) || 1,
      entryPrice: Number(l.p),
      venue: String(l.v || ''),
      ...NULL_GREEKS,
    }));
    return { underlying: data.u, legs };
  } catch {
    return null;
  }
}

/** Encode legs into URL search params (u, v, e, legs). Returns null if no legs. */
export function encodeStrategy(legs: Leg[], underlying: string): URLSearchParams | null {
  if (legs.length === 0) return null;
  const defV = modeOf(legs.map((l) => l.venue).filter((v): v is string => Boolean(v)));
  const defE = modeOf(legs.map((l) => l.expiry).filter((e): e is string => Boolean(e)));
  const params = new URLSearchParams();
  params.set('u', underlying);
  if (defV) params.set('v', defV);
  if (defE) params.set('e', defE);
  params.set('legs', legs.map((l) => encodeLeg(l, defV, defE)).join(','));
  return params;
}

/**
 * Decode a strategy from URL search params. Tries the new compact format first
 * (u/v/e/legs), then falls back to the legacy base64 `strategy=` param.
 */
export function decodeStrategy(
  params: URLSearchParams,
): { underlying: string; legs: DecodedLeg[] } | null {
  const legacy = params.get('strategy');
  if (legacy) return decodeLegacy(legacy);

  const underlying = params.get('u');
  const rawLegs = params.get('legs');
  if (!underlying || !rawLegs) return null;
  const defV = params.get('v') ?? '';
  const defE = params.get('e') ?? '';
  const legs: DecodedLeg[] = [];
  for (const token of rawLegs.split(',')) {
    const leg = decodeLeg(token, defV, defE);
    if (leg) legs.push(leg);
  }
  if (legs.length === 0) return null;
  return { underlying, legs };
}

/** Param keys this module reads from the URL — for cleanup after applying. */
export const STRATEGY_PARAM_KEYS = ['strategy', 'u', 'v', 'e', 'legs'] as const;

/**
 * Build a shareable URL with the encoded strategy. The query is assembled by
 * hand so `:`, `@`, `!`, and `,` stay unencoded — browsers accept and display
 * them fine, and the URL stays human-readable.
 */
export function buildShareUrl(legs: Leg[], underlying: string): string {
  const params = encodeStrategy(legs, underlying);
  if (!params) return window.location.href;
  const parts: string[] = [];
  for (const [k, v] of params) parts.push(`${k}=${v}`);
  return `${window.location.origin}/?${parts.join('&')}`;
}
