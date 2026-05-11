import type { NewsItem, SpotItem } from '@shared/news';
import type { Sponsor } from '@lib/sponsors';

export type TickerItem =
  | {
      kind: 'news';
      id: string;
      ruleTag: string | null;
      handle: string | null;
      text: string;
      url: string;
      timestamp: number;
    }
  | {
      kind: 'spot';
      id: string;
      symbol: string;
      lastPrice: number;
      change24hPct: number;
    }
  | {
      kind: 'ad';
      id: string;
      category: string;
      sponsor: string;
      label: string;
      href: string;
    };

export interface MergeArgs {
  news: NewsItem[];
  spots: SpotItem[];
  sponsors: Sponsor[];
  adEvery: number;
  newsCap?: number;
  startIndex?: number;
}

export function mergeTickerItems({
  news,
  spots,
  sponsors,
  adEvery,
  newsCap = 30,
  startIndex = 0,
}: MergeArgs): TickerItem[] {
  const spotItems: TickerItem[] = spots.map((s) => ({
    kind: 'spot',
    id: `spot:${s.symbol}`,
    symbol: s.symbol,
    lastPrice: s.lastPrice,
    change24hPct: s.change24hPct,
  }));

  const newsItems: TickerItem[] = news
    .slice(0, newsCap)
    .map((n) => ({
      kind: 'news',
      id: `news:${n.id}`,
      ruleTag: n.ruleTag,
      handle: n.handle,
      text: n.text,
      url: n.url,
      timestamp: n.timestamp,
    }));

  const content: TickerItem[] = [...spotItems, ...newsItems];

  const creatives = sponsors.flatMap((s) =>
    s.labels.map((label) => ({
      id: s.id,
      category: s.category,
      sponsor: s.sponsor,
      label,
      href: s.href,
    })),
  );

  if (creatives.length === 0 || adEvery <= 0 || content.length === 0) {
    return content;
  }

  const result: TickerItem[] = [];
  let creativeIdx = ((startIndex % creatives.length) + creatives.length) % creatives.length;
  content.forEach((item, i) => {
    result.push(item);
    if ((i + 1) % adEvery === 0) {
      const creative = creatives[creativeIdx % creatives.length]!;
      creativeIdx++;
      result.push({
        kind: 'ad',
        id: `ad:${creative.id}:${creativeIdx}`,
        category: creative.category,
        sponsor: creative.sponsor,
        label: creative.label,
        href: creative.href,
      });
    }
  });
  return result;
}
