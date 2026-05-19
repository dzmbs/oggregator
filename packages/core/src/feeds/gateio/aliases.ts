// Gate.io ships its WTI Crude Oil futures contract under the base `CL_USDT`,
// but the frontend (token-meta.ts) displays it as `XTI`. Trade events expose
// the public name; any Gate.io REST/WS call must translate back to `CL`.

const PUBLIC_TO_REST: Record<string, string> = { XTI: 'CL' };
const REST_TO_PUBLIC: Record<string, string> = { CL: 'XTI' };

export function toGateioRestBase(underlying: string): string {
  const base = underlying.toUpperCase();
  return PUBLIC_TO_REST[base] ?? base;
}

export function fromGateioRestBase(restBase: string): string {
  const base = restBase.toUpperCase();
  return REST_TO_PUBLIC[base] ?? base;
}
