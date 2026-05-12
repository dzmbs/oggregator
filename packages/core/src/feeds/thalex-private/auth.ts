import { createSign, type KeyObject } from 'node:crypto';

export interface MintTokenInput {
  kid: string;
  privateKeyPem: string | KeyObject;
  nowSec?: number;
}

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return bytes.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function mintAuthToken({ kid, privateKeyPem, nowSec }: MintTokenInput): string {
  if (!kid) throw new Error('thalex auth: kid is required');
  if (privateKeyPem == null || privateKeyPem === '') {
    throw new Error('thalex auth: privateKeyPem is required');
  }
  const iat = nowSec ?? Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS512', typ: 'JWT', kid }));
  const payload = base64UrlEncode(JSON.stringify({ iat }));
  const signingInput = `${header}.${payload}`;

  const signer = createSign('RSA-SHA512');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}
