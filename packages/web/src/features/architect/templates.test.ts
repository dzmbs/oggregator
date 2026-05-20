import { describe, expect, it } from 'vitest';
import type { EnrichedChainResponse, EnrichedStrike, VenueQuote } from '@shared/enriched';

import { TEMPLATE_CARDS, buildTemplateVariant } from './StrategyTemplates';

const STRIKES = [60_000, 62_000, 64_000, 66_000, 68_000, 70_000, 72_000, 74_000, 76_000, 78_000, 80_000];
const ATM = 70_000;

function quote(bid: number | null, ask: number | null): VenueQuote {
  return {
    bid,
    ask,
    mid: bid != null && ask != null ? (bid + ask) / 2 : null,
    bidSize: 10,
    askSize: 10,
    markIv: 0.6,
    bidIv: 0.55,
    askIv: 0.65,
    delta: 0.5,
    gamma: 0.001,
    theta: -10,
    vega: 5,
    spreadPct: 0.05,
    totalCost: null,
    estimatedFees: null,
    openInterest: null,
    volume24h: null,
    openInterestUsd: null,
    volume24hUsd: null,
  };
}

interface BuildOpts {
  // Strikes (or strike → side overrides) where the venue should report
  // bid=null/0 to simulate a missing bid quote for sell legs.
  noBidAt?: Array<{ strike: number; type: 'call' | 'put' }>;
}

function buildStrike(strike: number, opts: BuildOpts = {}): EnrichedStrike {
  const noCallBid = opts.noBidAt?.some((entry) => entry.strike === strike && entry.type === 'call');
  const noPutBid = opts.noBidAt?.some((entry) => entry.strike === strike && entry.type === 'put');

  return {
    strike,
    call: {
      venues: { deribit: quote(noCallBid ? null : 100, 110) },
      bestIv: 0.6,
      bestVenue: 'deribit',
    },
    put: {
      venues: { deribit: quote(noPutBid ? null : 100, 110) },
      bestIv: 0.6,
      bestVenue: 'deribit',
    },
  };
}

function buildChain(opts: BuildOpts = {}): EnrichedChainResponse {
  return {
    underlying: 'BTC',
    expiry: '2026-05-29',
    expiryTs: 0,
    dte: 30,
    stats: {
      forwardPriceUsd: ATM,
      indexPriceUsd: ATM,
      basisPct: 0,
      atmStrike: ATM,
      atmIv: 0.6,
      putCallOiRatio: null,
      totalOiUsd: null,
      skew25d: null,
      bfly25d: null,
    },
    strikes: STRIKES.map((s) => buildStrike(s, opts)),
    gex: [],
  };
}

const ironCondor = TEMPLATE_CARDS.find((t) => t.id === 'iron-condor')!;
const sellIcVariant = ironCondor.variants.find((v) => v.id === 'sell')!;
const buyIcVariant = ironCondor.variants.find((v) => v.id === 'buy')!;

describe('buildTemplateVariant — silent-failure detection', () => {
  it('builds short iron condor when every required quote is present', () => {
    const chain = buildChain();
    const result = buildTemplateVariant(chain, '2026-05-29', ironCondor, sellIcVariant);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.legs).toHaveLength(4);
  });

  it('explains WHICH leg is missing a quote when short iron condor cannot be built', () => {
    // Short condor: sell put at ATM-2 (66k) needs a BID. Remove that bid.
    const chain = buildChain({ noBidAt: [{ strike: 66_000, type: 'put' }] });
    const result = buildTemplateVariant(chain, '2026-05-29', ironCondor, sellIcVariant);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/66[,_]?000/);
      expect(result.error.message.toLowerCase()).toContain('bid');
      expect(result.error.message.toLowerCase()).toContain('put');
    }
  });

  it('rejects iron condor on a 3-strike chain with the wider-strike-coverage message', () => {
    // Only 3 strikes around ATM. Iron condor needs offsets ±2 and ±4 — the
    // outer wings are out of bounds. Old code clamped silently → duplicate
    // strikes; new code must report a coverage failure instead.
    const chain: EnrichedChainResponse = {
      underlying: 'BTC',
      expiry: '2026-05-29',
      expiryTs: 0,
      dte: 30,
      stats: {
        forwardPriceUsd: ATM,
        indexPriceUsd: ATM,
        basisPct: 0,
        atmStrike: ATM,
        atmIv: 0.6,
        putCallOiRatio: null,
        totalOiUsd: null,
        skew25d: null,
        bfly25d: null,
      },
      strikes: [68_000, 70_000, 72_000].map((s) => buildStrike(s)),
      gex: [],
    };

    const result = buildTemplateVariant(chain, '2026-05-29', ironCondor, sellIcVariant);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message.toLowerCase()).toContain('wider strike coverage');
    }
  });

  it('rejects butterfly when ATM is at the chain edge', () => {
    // ATM at the lower edge — offset -2 has no strike below.
    const chain: EnrichedChainResponse = {
      underlying: 'BTC',
      expiry: '2026-05-29',
      expiryTs: 0,
      dte: 30,
      stats: {
        forwardPriceUsd: 60_000,
        indexPriceUsd: 60_000,
        basisPct: 0,
        atmStrike: 60_000,
        atmIv: 0.6,
        putCallOiRatio: null,
        totalOiUsd: null,
        skew25d: null,
        bfly25d: null,
      },
      strikes: [60_000, 62_000, 64_000].map((s) => buildStrike(s)),
      gex: [],
    };

    const butterfly = TEMPLATE_CARDS.find((t) => t.id === 'butterfly')!;
    const buyButterfly = butterfly.variants.find((v) => v.id === 'buy')!;
    const result = buildTemplateVariant(chain, '2026-05-29', butterfly, buyButterfly);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message.toLowerCase()).toContain('wider strike coverage');
    }
  });

  it('explains missing ask when reverse (buy) iron condor wing has no ask', () => {
    // Reverse condor (buy): outer wings are SOLD, inner wings BOUGHT.
    // Inner short call at ATM+2 (74k) needs an ASK to be bought. Drop it.
    const chain = buildChain();
    const drop = chain.strikes.find((s) => s.strike === 74_000)!;
    drop.call.venues.deribit = quote(100, null);

    const result = buildTemplateVariant(chain, '2026-05-29', ironCondor, buyIcVariant);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/74[,_]?000/);
      expect(result.error.message.toLowerCase()).toContain('ask');
      expect(result.error.message.toLowerCase()).toContain('call');
    }
  });
});
