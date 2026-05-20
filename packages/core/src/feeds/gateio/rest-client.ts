import { createHash, createHmac } from 'node:crypto';

// Gate.io v4 REST signing per
// https://www.gate.com/docs/developers/apiv4/en/#authentication
//   prehash    = METHOD\nREQUEST_PATH\nQUERY_STRING\nSHA512_HEX(BODY)\nTIMESTAMP
//   SIGN       = HMAC_SHA512(secret, prehash) hex (lowercase)
//   headers    = { KEY, Timestamp, SIGN }
// REQUEST_PATH includes the `/api/v4/...` prefix; QUERY_STRING is the raw
// query as sent on the URL (no leading `?`, no sorting required by the
// server). For GET requests, BODY is empty so we hash the empty string.
//
// Mirrors the Coincall pattern (feeds/coincall/rest-client.ts) — same shape,
// just SHA-512 instead of SHA-256 and a different prehash composition.

export interface GateioCredentials {
  apiKey: string;
  apiSecret: string;
}

export function loadGateioCredentials(): GateioCredentials | null {
  const apiKey = process.env['GATEIO_API_KEY'];
  const apiSecret = process.env['GATEIO_API_SECRET'];
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

export function signGateioRequest(
  method: 'GET' | 'POST' | 'DELETE' | 'PUT',
  requestPath: string,
  params: Record<string, string | number>,
  credentials: GateioCredentials,
  body: string = '',
  now: () => number = () => Math.floor(Date.now() / 1000),
): { url: string; headers: Record<string, string> } {
  const timestamp = String(now());
  // URLSearchParams to keep encoding identical between prehash and URL.
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) search.append(k, String(v));
  const queryString = search.toString();

  const bodyHash = createHash('sha512').update(body).digest('hex');
  const prehash = `${method}\n${requestPath}\n${queryString}\n${bodyHash}\n${timestamp}`;
  const sign = createHmac('sha512', credentials.apiSecret)
    .update(prehash)
    .digest('hex');

  const url = queryString.length > 0 ? `${requestPath}?${queryString}` : requestPath;

  return {
    url,
    headers: {
      KEY: credentials.apiKey,
      Timestamp: timestamp,
      SIGN: sign,
    },
  };
}
