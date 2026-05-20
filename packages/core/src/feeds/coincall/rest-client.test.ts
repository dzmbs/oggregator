import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { signCoincallRequest, type CoincallCredentials } from './rest-client.js';

const CREDENTIALS: CoincallCredentials = {
  apiKey: 'test-key',
  apiSecret: 'test-secret',
};

function expectedSign(prehash: string, secret: string): string {
  return createHmac('sha256', secret).update(prehash).digest('hex').toUpperCase();
}

describe('signCoincallRequest', () => {
  it('matches the docs example shape with sorted params', () => {
    const now = () => 1_700_000_000_000;
    const result = signCoincallRequest(
      'POST',
      '/open/futures/leverage/set/v1',
      { symbol: 'BTCUSD', leverage: 1 },
      CREDENTIALS,
      now,
      3000,
    );

    // Docs example: params sorted alphabetically and prehash uses `&` to
    // join the uuid block to the param tail.
    const prehash =
      'POST/open/futures/leverage/set/v1?leverage=1&symbol=BTCUSD&uuid=test-key&ts=1700000000000&x-req-ts-diff=3000';
    expect(result.headers.sign).toBe(expectedSign(prehash, 'test-secret'));
    expect(result.url).toBe('/open/futures/leverage/set/v1?leverage=1&symbol=BTCUSD');
    expect(result.headers['X-CC-APIKEY']).toBe('test-key');
    expect(result.headers.ts).toBe('1700000000000');
    expect(result.headers['X-REQ-TS-DIFF']).toBe('3000');
  });

  it('signs a no-params request with `?` before uuid (no leading `&`)', () => {
    const now = () => 1_700_000_000_000;
    const result = signCoincallRequest(
      'GET',
      '/open/option/market/kline/v1/BTCUSD-22MAY26-110000-C',
      {},
      CREDENTIALS,
      now,
      5000,
    );

    const prehash =
      'GET/open/option/market/kline/v1/BTCUSD-22MAY26-110000-C?uuid=test-key&ts=1700000000000&x-req-ts-diff=5000';
    expect(result.headers.sign).toBe(expectedSign(prehash, 'test-secret'));
    // URL has no query string when there are no params.
    expect(result.url).toBe('/open/option/market/kline/v1/BTCUSD-22MAY26-110000-C');
  });

  it('preserves param values verbatim including option symbols with hyphens', () => {
    const result = signCoincallRequest(
      'GET',
      '/open/option/market/kline/v1/BTCUSD-22MAY26-110000-C',
      { period: 'h1', size: 200 },
      CREDENTIALS,
      () => 1_700_000_000_000,
    );
    expect(result.url).toBe(
      '/open/option/market/kline/v1/BTCUSD-22MAY26-110000-C?period=h1&size=200',
    );
  });
});
