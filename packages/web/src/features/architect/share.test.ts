import { describe, expect, it } from 'vitest';
import type { Leg } from './payoff';
import { decodeStrategy, encodeStrategy } from './share';

function leg(o: Partial<Leg> & Pick<Leg, 'type' | 'direction' | 'strike' | 'entryPrice'>): Leg {
  return {
    id: `${o.direction}-${o.type}-${o.strike}`,
    expiry: '2026-05-08',
    quantity: 1,
    venue: 'binance',
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    iv: null,
    ...o,
  };
}

describe('encodeStrategy', () => {
  it('hoists shared venue/expiry and renders compact legs', () => {
    const legs: Leg[] = [
      leg({ type: 'call', direction: 'buy', strike: 77000, entryPrice: 2360 }),
      leg({ type: 'put', direction: 'buy', strike: 77000, entryPrice: 1995 }),
    ];
    const params = encodeStrategy(legs, 'BTC');
    expect(params).not.toBeNull();
    expect(params!.get('u')).toBe('BTC');
    expect(params!.get('v')).toBe('binance');
    expect(params!.get('e')).toBe('2026-05-08');
    expect(params!.get('legs')).toBe('bc77000@2360,bp77000@1995');
  });

  it('emits per-leg overrides when venue or expiry differ from the majority', () => {
    const legs: Leg[] = [
      leg({ type: 'call', direction: 'buy', strike: 77000, entryPrice: 2360 }),
      leg({ type: 'call', direction: 'sell', strike: 80000, entryPrice: 1100, venue: 'okx' }),
      leg({
        type: 'put',
        direction: 'buy',
        strike: 70000,
        entryPrice: 900,
        expiry: '2026-06-26',
      }),
    ];
    const params = encodeStrategy(legs, 'BTC');
    expect(params!.get('legs')).toBe(
      'bc77000@2360,sc80000@1100!v=okx,bp70000@900!e=2026-06-26',
    );
  });

  it('includes quantity only when not 1', () => {
    const legs: Leg[] = [
      leg({ type: 'call', direction: 'buy', strike: 77000, entryPrice: 2360, quantity: 3 }),
    ];
    expect(encodeStrategy(legs, 'BTC')!.get('legs')).toBe('bc77000@2360x3');
  });

  it('returns null for empty legs', () => {
    expect(encodeStrategy([], 'BTC')).toBeNull();
  });
});

describe('decodeStrategy', () => {
  it('round-trips through encodeStrategy', () => {
    const original: Leg[] = [
      leg({ type: 'call', direction: 'buy', strike: 77000, entryPrice: 2360 }),
      leg({ type: 'put', direction: 'buy', strike: 77000, entryPrice: 1995 }),
    ];
    const params = encodeStrategy(original, 'BTC')!;
    const decoded = decodeStrategy(params);
    expect(decoded).not.toBeNull();
    expect(decoded!.underlying).toBe('BTC');
    expect(decoded!.legs).toHaveLength(2);
    expect(decoded!.legs[0]).toMatchObject({
      direction: 'buy',
      type: 'call',
      strike: 77000,
      entryPrice: 2360,
      expiry: '2026-05-08',
      venue: 'binance',
      quantity: 1,
    });
    expect(decoded!.legs[1]).toMatchObject({ type: 'put', strike: 77000, entryPrice: 1995 });
  });

  it('applies per-leg overrides over the defaults', () => {
    const params = new URLSearchParams({
      u: 'BTC',
      v: 'binance',
      e: '2026-05-08',
      legs: 'bc77000@2360,sc80000@1100!v=okx,bp70000@900!e=2026-06-26',
    });
    const decoded = decodeStrategy(params)!;
    expect(decoded.legs[1]?.venue).toBe('okx');
    expect(decoded.legs[1]?.expiry).toBe('2026-05-08');
    expect(decoded.legs[2]?.venue).toBe('binance');
    expect(decoded.legs[2]?.expiry).toBe('2026-06-26');
  });

  it('decodes legacy base64 strategy= param for backward compatibility', () => {
    const legacyData = {
      u: 'BTC',
      l: [
        { d: 'b', t: 'c', k: 77000, e: '2026-05-08', q: 1, p: 2360, v: 'binance' },
        { d: 'b', t: 'p', k: 77000, e: '2026-05-08', q: 1, p: 1995, v: 'binance' },
      ],
    };
    const encoded = btoa(JSON.stringify(legacyData));
    const params = new URLSearchParams({ strategy: encoded });
    const decoded = decodeStrategy(params)!;
    expect(decoded.underlying).toBe('BTC');
    expect(decoded.legs).toHaveLength(2);
    expect(decoded.legs[0]).toMatchObject({
      direction: 'buy',
      type: 'call',
      strike: 77000,
      entryPrice: 2360,
      venue: 'binance',
    });
  });

  it('returns null for malformed input', () => {
    expect(decodeStrategy(new URLSearchParams())).toBeNull();
    expect(decodeStrategy(new URLSearchParams({ u: 'BTC', legs: 'garbage' }))).toBeNull();
    expect(decodeStrategy(new URLSearchParams({ strategy: 'not-base64-json' }))).toBeNull();
  });
});
