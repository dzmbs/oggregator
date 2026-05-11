import { useMemo } from 'react';
import type { CSSProperties } from 'react';

import { useNewsFeed } from '@hooks/useNewsFeed';
import { useSpots } from '@hooks/useSpots';
import { AD_EVERY, SPONSORS } from '@lib/sponsors';

import { mergeTickerItems, type TickerItem } from './news-ticker/items';
import styles from './NewsTicker.module.css';

function symbolToBase(symbol: string): string {
  return symbol.replace(/USDT$|USDC$|USD$/i, '');
}

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return p.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function fmtChange(pct: number): string {
  const v = pct * 100;
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function changeClass(pct: number): string {
  if (pct > 0) return styles.changeUp!;
  if (pct < 0) return styles.changeDown!;
  return styles.changeNeutral!;
}

function TickerChip({ item }: { item: TickerItem }) {
  if (item.kind === 'spot') {
    return (
      <div className={styles.chip}>
        <span className={styles.category}>CRYPTO</span>
        <span className={styles.primary}>{symbolToBase(item.symbol)}</span>
        <span className={styles.secondary}>{fmtPrice(item.lastPrice)}</span>
        <span className={`${styles.change} ${changeClass(item.change24hPct)}`}>
          {fmtChange(item.change24hPct)}
        </span>
      </div>
    );
  }

  if (item.kind === 'news') {
    const category = (item.ruleTag ?? 'NEWS').toUpperCase().replace(/[_-]/g, ' ');
    return (
      <a
        className={`${styles.chip} ${styles.chipLink}`}
        href={item.url}
        target="_blank"
        rel="noopener"
      >
        <span className={styles.category}>{category}</span>
        {item.handle && <span className={styles.handle}>@{item.handle}</span>}
        <span className={styles.secondary}>{item.text}</span>
      </a>
    );
  }

  return (
    <a
      className={`${styles.chip} ${styles.chipLink} ${styles.sponsorChip}`}
      href={item.href}
      target="_blank"
      rel="sponsored noopener"
      data-sponsor={item.id.split(':')[1]}
    >
      <span className={`${styles.category} ${styles.sponsorCategory}`}>{item.category}</span>
      <span className={styles.primary}>{item.sponsor}</span>
      <span className={styles.secondary}>{item.label} →</span>
    </a>
  );
}

export function NewsTicker() {
  const { data: news = [] } = useNewsFeed();
  const { data: spots = [] } = useSpots();

  const items = useMemo(
    () => mergeTickerItems({ news, spots, sponsors: SPONSORS, adEvery: AD_EVERY }),
    [news, spots],
  );

  if (items.length === 0) return null;

  const durationSec = Math.min(260, Math.max(65, items.length * 4.2));
  const trackStyle = { '--scroll-duration': `${durationSec}s` } as CSSProperties;

  const doubled = [...items, ...items];

  return (
    <div className={styles.ticker}>
      <div className={styles.viewport}>
        <div className={styles.track} style={trackStyle}>
          {doubled.map((item, i) => (
            <TickerChip key={`${item.id}-${i}`} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default NewsTicker;
