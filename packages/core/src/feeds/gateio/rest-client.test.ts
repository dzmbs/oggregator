import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { signGateioRequest, type GateioCredentials } from './rest-client.js';

const CREDENTIALS: GateioCredentials = {
  apiKey: 'test-key',
  apiSecret: 'test-secret',
};

function expectedSign(prehash: string, secret: string): string {
  return createHmac('sha512', secret).update(prehash).digest('hex');
}

const EMPTY_BODY_SHA512 = createHash('sha512').update('').digest('hex');

describe('signGateioRequest', () => {
  it('signs a GET with query string per the v4 spec (method\\npath\\nqs\\nbodyHash\\nts)', () => {
    const now = () => 1_700_000_000;
    const result = signGateioRequest(
      'GET',
      '/api/v4/options/mark_price_candlesticks',
      { contract: 'BTC_USDT-20260626-70000-C', interval: '1h' },
      CREDENTIALS,
      '',
      now,
    );

    const prehash =
      'GET\n' +
      '/api/v4/options/mark_price_candlesticks\n' +
      'contract=BTC_USDT-20260626-70000-C&interval=1h\n' +
      `${EMPTY_BODY_SHA512}\n` +
      '1700000000';

    expect(result.headers.SIGN).toBe(expectedSign(prehash, 'test-secret'));
    expect(result.headers.KEY).toBe('test-key');
    expect(result.headers.Timestamp).toBe('1700000000');
    expect(result.url).toBe(
      '/api/v4/options/mark_price_candlesticks?contract=BTC_USDT-20260626-70000-C&interval=1h',
    );
  });

  it('signs a no-params GET with an empty query string segment', () => {
    const result = signGateioRequest(
      'GET',
      '/api/v4/options/contracts',
      {},
      CREDENTIALS,
      '',
      () => 1_700_000_000,
    );

    const prehash =
      'GET\n' +
      '/api/v4/options/contracts\n' +
      '\n' +
      `${EMPTY_BODY_SHA512}\n` +
      '1700000000';

    expect(result.headers.SIGN).toBe(expectedSign(prehash, 'test-secret'));
    // No leading `?` when no params.
    expect(result.url).toBe('/api/v4/options/contracts');
  });

  it('hashes the body for POST requests', () => {
    const body = JSON.stringify({ a: 1 });
    const result = signGateioRequest(
      'POST',
      '/api/v4/futures/usdt/orders',
      {},
      CREDENTIALS,
      body,
      () => 1_700_000_000,
    );

    const bodyHash = createHash('sha512').update(body).digest('hex');
    const prehash =
      `POST\n/api/v4/futures/usdt/orders\n\n${bodyHash}\n1700000000`;
    expect(result.headers.SIGN).toBe(expectedSign(prehash, 'test-secret'));
  });

  it('preserves param insertion order in the query string (signed value matches URL)', () => {
    const result = signGateioRequest(
      'GET',
      '/api/v4/options/mark_price_candlesticks',
      { from: 1, to: 2, contract: 'X', interval: '1m' },
      CREDENTIALS,
      '',
      () => 1_700_000_000,
    );
    expect(result.url).toBe(
      '/api/v4/options/mark_price_candlesticks?from=1&to=2&contract=X&interval=1m',
    );
  });
});
