import { createPrivateKey, createSign, type KeyObject } from 'node:crypto';

const DEFAULT_TOKEN_LIFETIME_SEC = 600;
const MIN_IAT_STEP_SEC = 0.001;
const lastIssuedAtByKid = new Map<string, number>();

export interface MintTokenInput {
  kid: string;
  privateKeyPem: string | KeyObject;
  nowSec?: number;
  lifetimeSec?: number;
}

function normalizePemString(input: string): string {
  let normalized = input.trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.replace(/\r\n/g, '\n').replace(/\\n/g, '\n');
}

function parseSigningKey(privateKeyPem: string | KeyObject): KeyObject {
  if (typeof privateKeyPem !== 'string') return privateKeyPem;

  const normalized = normalizePemString(privateKeyPem);
  if (normalized.includes('BEGIN ENCRYPTED PRIVATE KEY')) {
    throw new Error('encrypted private keys are not supported; export an unencrypted RSA private key PEM');
  }
  if (!normalized.includes('BEGIN PRIVATE KEY') && !normalized.includes('BEGIN RSA PRIVATE KEY')) {
    throw new Error('expected a PEM private key with BEGIN/END lines');
  }

  let key: KeyObject;
  try {
    key = createPrivateKey(normalized);
  } catch {
    throw new Error('invalid private key PEM; paste the full RSA private key block with real line breaks');
  }

  if (key.asymmetricKeyType !== 'rsa') {
    throw new Error(`unsupported key type "${key.asymmetricKeyType ?? 'unknown'}"; Thalex requires an RSA private key`);
  }

  return key;
}

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return bytes.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function mintAuthToken({ kid, privateKeyPem, nowSec, lifetimeSec }: MintTokenInput): string {
  if (!kid) throw new Error('thalex auth: kid is required');
  if (privateKeyPem == null || privateKeyPem === '') {
    throw new Error('thalex auth: privateKeyPem is required');
  }
  const requestedIat = nowSec ?? Date.now() / 1000;
  const priorIat = lastIssuedAtByKid.get(kid);
  const iat = priorIat == null ? requestedIat : Math.max(requestedIat, priorIat + MIN_IAT_STEP_SEC);
  lastIssuedAtByKid.set(kid, iat);
  const exp = iat + (lifetimeSec ?? DEFAULT_TOKEN_LIFETIME_SEC);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS512', typ: 'JWT', kid }));
  const payload = base64UrlEncode(JSON.stringify({ iat, exp }));
  const signingInput = `${header}.${payload}`;

  const signer = createSign('RSA-SHA512');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(parseSigningKey(privateKeyPem));
  return `${signingInput}.${base64UrlEncode(signature)}`;
}
