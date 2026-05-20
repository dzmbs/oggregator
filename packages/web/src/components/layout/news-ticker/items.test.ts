import { describe, it, expect } from 'vitest';
import type { NewsItem, SpotItem } from '@shared/news';
import type { Sponsor } from '@lib/sponsors';
import { mergeTickerItems } from './items';

const SPONSOR: Sponsor = {
  id: 'coincall',
  category: 'SPONSORED',
  sponsor: 'Coincall',
  labels: ['Trade options'],
  href: 'https://coincall.com/r/1',
};

function newsItem(id: string, ts: number): NewsItem {
  return {
    id,
    text: `tweet ${id}`,
    url: `https://x.com/${id}`,
    source: `Twitter[t] - @h`,
    handle: 'h',
    ruleTag: 't',
    timestamp: ts,
    classification: 'GOOD',
    createdAt: new Date(ts).toISOString(),
  };
}

function spotItem(symbol: string): SpotItem {
  return { symbol, lastPrice: 100, change24hPct: 0.01, updatedAt: 0 };
}

describe('mergeTickerItems', () => {
  it('returns empty for empty inputs', () => {
    expect(mergeTickerItems({ news: [], spots: [], sponsors: [], adEvery: 6 })).toEqual([]);
  });

  it('places spots before news', () => {
    const out = mergeTickerItems({
      news: [newsItem('n1', 1)],
      spots: [spotItem('BTCUSDT')],
      sponsors: [],
      adEvery: 0,
    });
    expect(out.map((i) => i.kind)).toEqual(['spot', 'news']);
  });

  it('caps news at newsCap', () => {
    const news = Array.from({ length: 50 }, (_, i) => newsItem(`n${i}`, i));
    const out = mergeTickerItems({ news, spots: [], sponsors: [], adEvery: 0, newsCap: 5 });
    expect(out.filter((i) => i.kind === 'news')).toHaveLength(5);
  });

  it('inserts an ad every Nth item', () => {
    const news = Array.from({ length: 12 }, (_, i) => newsItem(`n${i}`, i));
    const out = mergeTickerItems({
      news,
      spots: [],
      sponsors: [SPONSOR],
      adEvery: 6,
    });
    expect(out).toHaveLength(14);
    expect(out[6]!.kind).toBe('ad');
    expect(out[13]!.kind).toBe('ad');
  });

  it('rotates sponsors round-robin', () => {
    const sponsors: Sponsor[] = [
      { ...SPONSOR, id: 'a', sponsor: 'A' },
      { ...SPONSOR, id: 'b', sponsor: 'B' },
    ];
    const news = Array.from({ length: 12 }, (_, i) => newsItem(`n${i}`, i));
    const out = mergeTickerItems({ news, spots: [], sponsors, adEvery: 6 });
    const ads = out.filter((i) => i.kind === 'ad') as Array<{ sponsor: string }>;
    expect(ads.map((a) => a.sponsor)).toEqual(['A', 'B']);
  });

  it('rotates label variants within a single sponsor across slots', () => {
    const sponsor: Sponsor = {
      ...SPONSOR,
      labels: ['offer one', 'offer two', 'offer three'],
    };
    const news = Array.from({ length: 18 }, (_, i) => newsItem(`n${i}`, i));
    const out = mergeTickerItems({ news, spots: [], sponsors: [sponsor], adEvery: 6 });
    const ads = out.filter((i) => i.kind === 'ad') as Array<{ label: string; sponsor: string }>;
    expect(ads).toHaveLength(3);
    expect(ads.map((a) => a.label)).toEqual(['offer one', 'offer two', 'offer three']);
    expect(ads.every((a) => a.sponsor === 'Coincall')).toBe(true);
  });

  it('emits no ads when adEvery is 0', () => {
    const news = Array.from({ length: 12 }, (_, i) => newsItem(`n${i}`, i));
    const out = mergeTickerItems({ news, spots: [], sponsors: [SPONSOR], adEvery: 0 });
    expect(out.find((i) => i.kind === 'ad')).toBeUndefined();
  });

  it('startIndex shifts the creative rotation so a single ad slot cycles', () => {
    const sponsors: Sponsor[] = [
      { ...SPONSOR, id: 'a', sponsor: 'A', labels: ['a1'] },
      { ...SPONSOR, id: 'b', sponsor: 'B', labels: ['b1'] },
    ];
    const news = Array.from({ length: 6 }, (_, i) => newsItem(`n${i}`, i));

    const at0 = mergeTickerItems({ news, spots: [], sponsors, adEvery: 6, startIndex: 0 });
    const at1 = mergeTickerItems({ news, spots: [], sponsors, adEvery: 6, startIndex: 1 });

    const ad0 = at0.find((i) => i.kind === 'ad') as { sponsor: string };
    const ad1 = at1.find((i) => i.kind === 'ad') as { sponsor: string };

    expect(ad0.sponsor).toBe('A');
    expect(ad1.sponsor).toBe('B');
  });
});
