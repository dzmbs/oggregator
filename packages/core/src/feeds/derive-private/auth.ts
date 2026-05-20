import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export interface DeriveLoginParams {
  wallet: string;
  timestamp: string;
  signature: string;
}

export interface SignLoginInput {
  walletAddress: string;
  signerPrivateKey: string;
  timestampMs?: number;
}

function stripHex(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function eip191Hash(message: string): Uint8Array {
  const msgBytes = utf8(message);
  const prefix = utf8(`\x19Ethereum Signed Message:\n${msgBytes.length}`);
  const concat = new Uint8Array(prefix.length + msgBytes.length);
  concat.set(prefix, 0);
  concat.set(msgBytes, prefix.length);
  return keccak_256(concat);
}

export function signLoginMessage(input: SignLoginInput): DeriveLoginParams {
  const timestamp = String(input.timestampMs ?? Date.now());
  const hash = eip191Hash(timestamp);

  const privKeyBytes = hexToBytes(stripHex(input.signerPrivateKey));
  if (privKeyBytes.length !== 32) {
    throw new Error('signer private key must be 32 bytes (64 hex chars)');
  }

  const sigBytes = secp256k1.sign(hash, privKeyBytes, { format: 'recovered', prehash: false });
  if (sigBytes.length !== 65) {
    throw new Error(`expected 65-byte recoverable signature, got ${sigBytes.length}`);
  }
  const recovery = sigBytes[0]!;
  const r = sigBytes.slice(1, 33);
  const s = sigBytes.slice(33, 65);
  const v = recovery + 27;
  const ethSig = new Uint8Array(65);
  ethSig.set(r, 0);
  ethSig.set(s, 32);
  ethSig[64] = v;

  return {
    wallet: input.walletAddress,
    timestamp,
    signature: `0x${bytesToHex(ethSig)}`,
  };
}

export function recoverSignerAddress(message: string, signatureHex: string): string {
  const hash = eip191Hash(message);
  const sigBytes = hexToBytes(stripHex(signatureHex));
  if (sigBytes.length !== 65) throw new Error('signature must be 65 bytes');
  const v = sigBytes[64]!;
  const recovery = v >= 27 ? v - 27 : v;
  const recoverable = new Uint8Array(65);
  recoverable[0] = recovery;
  recoverable.set(sigBytes.slice(0, 64), 1);
  const compressed = secp256k1.recoverPublicKey(recoverable, hash, { prehash: false });
  const uncompressed = secp256k1.Point.fromBytes(compressed).toBytes(false);
  const addressBytes = keccak_256(uncompressed.slice(1)).slice(12);
  return `0x${bytesToHex(addressBytes)}`;
}
