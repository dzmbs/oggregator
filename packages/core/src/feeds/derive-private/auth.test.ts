import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

import { recoverSignerAddress, signLoginMessage } from './auth.js';

function makeKeyPair(): { privateKey: string; address: string } {
  const { secretKey, publicKey } = secp256k1.keygen();
  const uncompressed =
    publicKey.length === 65 ? publicKey.slice(1) : secp256k1.getPublicKey(secretKey, false).slice(1);
  const address = `0x${bytesToHex(keccak_256(uncompressed).slice(12))}`;
  return { privateKey: `0x${bytesToHex(secretKey)}`, address };
}

describe('signLoginMessage', () => {
  it('produces a 65-byte signature with v=27 or v=28', () => {
    const { privateKey, address } = makeKeyPair();
    const params = signLoginMessage({
      walletAddress: address,
      signerPrivateKey: privateKey,
      timestampMs: 1_700_000_000_000,
    });
    expect(params.wallet).toBe(address);
    expect(params.timestamp).toBe('1700000000000');
    expect(params.signature.startsWith('0x')).toBe(true);
    expect(params.signature.length).toBe(2 + 65 * 2);
    const v = parseInt(params.signature.slice(-2), 16);
    expect(v === 27 || v === 28).toBe(true);
  });

  it('signature recovers the signer address (self-sign)', () => {
    const { privateKey, address } = makeKeyPair();
    const params = signLoginMessage({
      walletAddress: address,
      signerPrivateKey: privateKey,
      timestampMs: 1_700_000_000_000,
    });
    const recovered = recoverSignerAddress(params.timestamp, params.signature);
    expect(recovered.toLowerCase()).toBe(address.toLowerCase());
  });

  it('session-key signing: recovered address matches session key, wallet is the smart wallet', () => {
    const sessionKey = makeKeyPair();
    const smartWallet = '0x1234567890123456789012345678901234567890';
    const params = signLoginMessage({
      walletAddress: smartWallet,
      signerPrivateKey: sessionKey.privateKey,
      timestampMs: 1_700_000_000_000,
    });
    const recovered = recoverSignerAddress(params.timestamp, params.signature);
    expect(recovered.toLowerCase()).toBe(sessionKey.address.toLowerCase());
    expect(params.wallet).toBe(smartWallet);
  });

  it('different timestamps produce different signatures', () => {
    const { privateKey, address } = makeKeyPair();
    const a = signLoginMessage({ walletAddress: address, signerPrivateKey: privateKey, timestampMs: 1 });
    const b = signLoginMessage({ walletAddress: address, signerPrivateKey: privateKey, timestampMs: 2 });
    expect(a.signature).not.toBe(b.signature);
  });

  it('rejects malformed private key', () => {
    expect(() =>
      signLoginMessage({
        walletAddress: '0xabc',
        signerPrivateKey: '0xdeadbeef',
        timestampMs: 1,
      }),
    ).toThrow();
  });
});
