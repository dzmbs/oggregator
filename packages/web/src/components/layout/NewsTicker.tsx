import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { useNewsFeed } from '@hooks/useNewsFeed';
import { useSpots } from '@hooks/useSpots';
import { AD_EVERY, SPONSORS } from '@lib/sponsors';

import { mergeTickerItems, type TickerItem } from './news-ticker/items';
import styles from './NewsTicker.module.css';

const PX_PER_SEC = 34;
const AD_ROTATE_MS = 20_000;

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

type AdItem = Extract<TickerItem, { kind: 'ad' }>;

function AdChip({ item }: { item: AdItem }) {
  const [shown, setShown] = useState<AdItem>(item);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    if (item.id === shown.id) return;
    setFadingOut(true);
    const t = setTimeout(() => {
      setShown(item);
      setFadingOut(false);
    }, 220);
    return () => clearTimeout(t);
  }, [item, shown.id]);

  const sponsorKey = shown.id.split(':')[1];
  const fadeClass = `${styles.sponsorFade} ${fadingOut ? styles.sponsorFadeOut : ''}`;

  return (
    <a
      className={`${styles.chip} ${styles.chipLink} ${styles.sponsorChip} ${fadeClass}`}
      href={shown.href}
      target="_blank"
      rel="sponsored noopener"
      data-sponsor={sponsorKey}
    >
      <span className={`${styles.category} ${styles.sponsorCategory}`}>{shown.category}</span>
      <span className={styles.primary}>{shown.sponsor}</span>
      <span className={styles.secondary}>{shown.label} →</span>
    </a>
  );
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

  return <AdChip item={item} />;
}

export function NewsTicker() {
  const { data: news = [] } = useNewsFeed();
  const { data: spots = [] } = useSpots();

  const [adTick, setAdTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setAdTick((t) => t + 1), AD_ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(
    () => mergeTickerItems({ news, spots, sponsors: SPONSORS, adEvery: AD_EVERY, startIndex: adTick }),
    [news, spots, adTick],
  );

  const itemsKey = useMemo(
    () => items.filter((i) => i.kind !== 'ad').map((i) => i.id).join('|'),
    [items],
  );

  const trackRef = useRef<HTMLDivElement>(null);
  const [durationSec, setDurationSec] = useState(60);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const update = () => {
      const halfWidth = el.scrollWidth / 2;
      if (halfWidth > 0) {
        setDurationSec(Math.max(20, halfWidth / PX_PER_SEC));
      }
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [itemsKey]);

  if (items.length === 0) return null;

  const trackStyle = { '--scroll-duration': `${durationSec}s` } as CSSProperties;
  const doubled = [...items, ...items];

  return (
    <div className={styles.ticker}>
      <div className={styles.viewport}>
        <div key={itemsKey} ref={trackRef} className={styles.track} style={trackStyle}>
          {doubled.map((item, i) => (
            <TickerChip key={`slot-${i}`} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default NewsTicker;
