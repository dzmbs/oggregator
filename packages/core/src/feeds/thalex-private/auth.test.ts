import { createPrivateKey, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { mintAuthToken } from './auth.js';

function generateRsaPemPair(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function b64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

describe('mintAuthToken', () => {
  it('produces a 3-part JWT with RS512 + kid in header and iat/exp in payload', () => {
    const { privatePem } = generateRsaPemPair();
    const token = mintAuthToken({
      kid: 'kid-abc',
      privateKeyPem: privatePem,
      nowSec: 1_700_000_000,
      lifetimeSec: 300,
    });
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    const header = JSON.parse(b64urlDecode(parts[0]!).toString('utf8'));
    const payload = JSON.parse(b64urlDecode(parts[1]!).toString('utf8'));
    expect(header.alg).toBe('RS512');
    expect(header.typ).toBe('JWT');
    expect(header.kid).toBe('kid-abc');
    expect(payload.iat).toBe(1_700_000_000);
    expect(payload.exp).toBe(1_700_000_300);
  });

  it('signature verifies against the public key with RSA-SHA512', () => {
    const { privatePem, publicPem } = generateRsaPemPair();
    const token = mintAuthToken({ kid: 'k', privateKeyPem: privatePem, nowSec: 1 });
    const [h, p, s] = token.split('.');
    const signed = Buffer.from(`${h}.${p}`);
    const sig = b64urlDecode(s!);
    expect(verify('sha512', signed, createPublicKey(publicPem), sig)).toBe(true);
  });

  it('accepts a KeyObject as well as PEM string', () => {
    const { privatePem } = generateRsaPemPair();
    const keyObject = createPrivateKey(privatePem);
    expect(() => mintAuthToken({ kid: 'k', privateKeyPem: keyObject, nowSec: 1 })).not.toThrow();
  });

  it('accepts PEM strings with escaped newlines', () => {
    const { privatePem } = generateRsaPemPair();
    const escapedPem = privatePem.replace(/\n/g, '\\n');
    expect(() => mintAuthToken({ kid: 'k', privateKeyPem: escapedPem, nowSec: 1 })).not.toThrow();
  });

  it('accepts quoted PEM strings', () => {
    const { privatePem } = generateRsaPemPair();
    const quotedPem = `"${privatePem}"`;
    expect(() => mintAuthToken({ kid: 'k', privateKeyPem: quotedPem, nowSec: 1 })).not.toThrow();
  });

  it('rejects non-PEM strings with a clear error', () => {
    expect(() => mintAuthToken({ kid: 'k', privateKeyPem: 'not-a-key', nowSec: 1 })).toThrow(
      /expected a PEM private key/i,
    );
  });

  it('rejects empty kid or privateKey', () => {
    const { privatePem } = generateRsaPemPair();
    expect(() => mintAuthToken({ kid: '', privateKeyPem: privatePem })).toThrow();
    expect(() => mintAuthToken({ kid: 'k', privateKeyPem: '' })).toThrow();
  });
});
