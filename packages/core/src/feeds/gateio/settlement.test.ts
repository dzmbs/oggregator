import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchGateioSettlement } from './settlement.js';

const SAMPLE_ROWS = [
  {
    time: 1638259200,
    contract: 'BTC_USDT-20211130-65000-C',
    profit: '0',
    fee: '0',
    strike_price: '65000',
    settle_price: '57280.5',
  },
  {
    time: 1638259200,
    contract: 'BTC_USDT-20211130-65000-P',
    profit: '7719.5',
    fee: '0',
    strike_price: '65000',
    settle_price: '57280.5',
  },
  {
    time: 1638259200,
    contract: 'BTC_USDT-20211130-60000-C',
    profit: '0',
    fee: '0',
    strike_price: '60000',
    settle_price: '57280.5',
  },
];

describe('fetchGateioSettlement', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function ok(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('returns settle_price as USD for a matching expiry', async () => {
    fetchSpy.mockResolvedValueOnce(ok(SAMPLE_ROWS));

    const result = await fetchGateioSettlement({
      underlying: 'BTC',
      expiry: '2021-11-30',
      now: () => Date.parse('2021-12-01T00:00:00Z'),
    });

    expect(result).not.toBeNull();
    expect(result!.priceUsd).toBe(57280.5);
    expect(result!.sampleContract).toMatch(/^BTC_USDT-20211130-/);
    expect(result!.capturedAt.toISOString()).toBe('2021-11-30T08:00:00.000Z');
  });

  it('builds the correct request URL with windowed timestamps', async () => {
    fetchSpy.mockResolvedValueOnce(ok(SAMPLE_ROWS));

    await fetchGateioSettlement({
      underlying: 'BTC',
      expiry: '2021-11-30',
      now: () => Date.parse('2021-12-01T00:00:00Z'),
    });

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('/api/v4/options/settlements');
    expect(calledUrl).toContain('underlying=BTC_USDT');
    expect(calledUrl).toContain('limit=1000');
    expect(calledUrl).toContain('from=');
    expect(calledUrl).toContain('to=');
  });

  it('skips contracts from other expiries in the same window', async () => {
    fetchSpy.mockResolvedValueOnce(
      ok([
        // Different expiry, same underlying — must be ignored.
        {
          time: 1638259200,
          contract: 'BTC_USDT-20211129-60000-C',
          settle_price: '12345.6',
        },
        ...SAMPLE_ROWS,
      ]),
    );

    const result = await fetchGateioSettlement({
      underlying: 'BTC',
      expiry: '2021-11-30',
      now: () => Date.parse('2021-12-01T00:00:00Z'),
    });

    expect(result!.priceUsd).toBe(57280.5);
  });

  it('returns null when no contract matches the requested expiry', async () => {
    fetchSpy.mockResolvedValueOnce(
      ok([
        {
          time: 1638259200,
          contract: 'BTC_USDT-20211129-60000-C',
          settle_price: '57280.5',
        },
      ]),
    );

    const result = await fetchGateioSettlement({
      underlying: 'BTC',
      expiry: '2021-11-30',
      now: () => Date.parse('2021-12-01T00:00:00Z'),
    });
    expect(result).toBeNull();
  });

  it('returns null for future expiries without hitting the network', async () => {
    const result = await fetchGateioSettlement({
      underlying: 'BTC',
      expiry: '2030-01-01',
      now: () => Date.parse('2026-05-19T00:00:00Z'),
    });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null on HTTP error without throwing', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('boom', { status: 503 }));
    const result = await fetchGateioSettlement({
      underlying: 'BTC',
      expiry: '2021-11-30',
      now: () => Date.parse('2021-12-01T00:00:00Z'),
    });
    expect(result).toBeNull();
  });

  it('returns null when settle_price is malformed', async () => {
    fetchSpy.mockResolvedValueOnce(
      ok([{ time: 1638259200, contract: 'BTC_USDT-20211130-65000-C', settle_price: 'NaN' }]),
    );
    const result = await fetchGateioSettlement({
      underlying: 'BTC',
      expiry: '2021-11-30',
      now: () => Date.parse('2021-12-01T00:00:00Z'),
    });
    expect(result).toBeNull();
  });
});
