import { createHmac } from 'node:crypto';

// Coincall REST signing per references/options-docs/coincall/base_en.md:
//   prehash = METHOD + URI + (params ? '&' : '') + 'uuid=...&ts=...&x-req-ts-diff=...'
// where URI ends with '?' (no params) or '?p1=v1&p2=v2' (params alphabetised).
// sign  = HMAC-SHA256(secret, prehash) hex uppercase.
//
// Example from official docs:
//   POST/open/futures/leverage/set/v1?leverage=1&symbol=BTCUSD&uuid=…&ts=…&x-req-ts-diff=3000
//
// Headers required on every signed call:
//   X-CC-APIKEY, sign, ts, X-REQ-TS-DIFF (defaults to 5000ms if omitted, but
//   we send explicitly so requests with clock skew degrade visibly instead
//   of producing surprising 4xx).

const COINCALL_DEFAULT_TS_DIFF_MS = 5_000;

export interface CoincallCredentials {
  apiKey: string;
  apiSecret: string;
}

export function loadCoincallCredentials(): CoincallCredentials | null {
  const apiKey = process.env['COINCALL_API_KEY'];
  const apiSecret = process.env['COINCALL_API_SECRET'];
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

export function signCoincallRequest(
  method: 'GET' | 'POST' | 'DELETE' | 'PUT',
  path: string,
  params: Record<string, string | number>,
  credentials: CoincallCredentials,
  now: () => number = Date.now,
  tsDiffMs: number = COINCALL_DEFAULT_TS_DIFF_MS,
): { url: string; headers: Record<string, string> } {
  const ts = now();
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map((k) => `${k}=${params[k]}`).join('&');

  // URI for prehash: path + '?' + sorted params (or just path + '?' if none).
  const uri = paramString.length > 0 ? `${path}?${paramString}` : `${path}?`;
  // Join uuid block with `&` when params exist, no separator when not — the
  // docs example shows `…symbol=BTCUSD&uuid=…` (with `&`) so the separator
  // is part of the prehash, not part of the URL.
  const sep = paramString.length > 0 ? '&' : '';
  const prehash =
    `${method}${uri}${sep}uuid=${credentials.apiKey}&ts=${ts}&x-req-ts-diff=${tsDiffMs}`;
  const sign = createHmac('sha256', credentials.apiSecret)
    .update(prehash)
    .digest('hex')
    .toUpperCase();

  // Actual request URL — params only, no uuid/ts/x-req-ts-diff (those go in headers).
  const url = paramString.length > 0 ? `${path}?${paramString}` : path;

  return {
    url,
    headers: {
      'X-CC-APIKEY': credentials.apiKey,
      sign,
      ts: String(ts),
      'X-REQ-TS-DIFF': String(tsDiffMs),
    },
  };
}
