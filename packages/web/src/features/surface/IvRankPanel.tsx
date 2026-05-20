import { useState } from 'react';

import HoverTooltip from '@components/ui/HoverTooltip';
import { getTokenLogo } from '@lib/token-meta';
import { fmtIv } from '@lib/format';
import type { IvHistoryTenorResult, IvTenor } from '@shared/enriched';
import { getHistoryCoverage, type HistoryCoverage } from './history-coverage';
import { useIvHistory, type IvHistoryWindow } from './queries';
import styles from './IvRankPanel.module.css';

const TENORS: IvTenor[] = ['7d', '30d', '60d', '90d'];
const SPARK_POINTS = 24;

function rankLevel(rank: number | null): 'hot' | 'mid' | 'cold' | 'none' {
  if (rank == null) return 'none';
  if (rank >= 70) return 'hot';
  if (rank <= 30) return 'cold';
  return 'mid';
}

function sparkPath(values: Array<number | null>, width: number, height: number): string {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length < 2) return '';
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const span = max - min;
  const step = width / (xs.length - 1);
  return xs
    .map((v, i) => {
      const x = i * step;
      const y = span > 0 ? height - ((v - min) / span) * height : height / 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function sampleEvenly<T>(arr: T[], targetCount: number): T[] {
  if (arr.length <= targetCount) return arr;
  const step = arr.length / targetCount;
  const out: T[] = [];
  for (let i = 0; i < targetCount; i++) {
    out.push(arr[Math.floor(i * step)]!);
  }
  if (out[out.length - 1] !== arr[arr.length - 1]) {
    out[out.length - 1] = arr[arr.length - 1]!;
  }
  return out;
}

const IVR_TIP = (
  <div className={styles.tip}>
    <div className={styles.tipTitle}>How to read IV Rank</div>
    <div>Where current ATM IV sits within the look-back window (toggle above the chips).</div>
    <div className={styles.tipFormula}>rank = (current − min) / (max − min) × 100</div>
    <ul className={styles.tipList}>
      <li>
        <b style={{ color: 'var(--color-profit)' }}>0–30</b>: IV cheap vs the window — vol buyers favored.
      </li>
      <li>
        <b style={{ color: 'var(--color-warning)' }}>30–70</b>: mid-range; no strong edge.
      </li>
      <li>
        <b style={{ color: 'var(--color-loss)' }}>70–100</b>: IV rich vs the window — vol sellers favored.
      </li>
    </ul>
    <div className={styles.tipBlock}>
      <b>Per-tenor source</b>
      <ul className={styles.tipList}>
        <li>
          <b>30d</b> (BTC/ETH): Deribit DVOL — ~1 year of daily closes, kept live by the DVOL push.
        </li>
        <li>
          <b>7d / 60d / 90d</b>: cross-venue ATM averages interpolated to the tenor, snapshotted every 5 min.
        </li>
        <li>
          After a fresh server start, 7d/60d/90d are thinly populated — check <b>n</b> on each chip.
        </li>
      </ul>
    </div>
  </div>
);

const RANK_TIP = (
  <div className={styles.tip}>
    <div className={styles.tipTitle}>IV Rank</div>
    <div>Position of current ATM IV in the window’s low→high band.</div>
    <div className={styles.tipFormula}>rank = (current − min) / (max − min) × 100</div>
    <ul className={styles.tipList}>
      <li>0 = at window low (cheapest seen). 100 = at window high (richest seen).</li>
      <li>
        <b style={{ color: 'var(--color-loss)' }}>&gt;70</b>: premium rich historically — prefer selling vol.
      </li>
      <li>
        <b style={{ color: 'var(--color-warning)' }}>30–70</b>: middle of the range; no strong edge.
      </li>
      <li>
        <b style={{ color: 'var(--color-profit)' }}>&lt;30</b>: premium cheap historically — prefer buying vol.
      </li>
    </ul>
  </div>
);

const PCT_TIP = (
  <div className={styles.tip}>
    <div className={styles.tipTitle}>IV Percentile</div>
    <div>Share of historical samples ≤ current IV.</div>
    <ul className={styles.tipList}>
      <li>Robust to outliers — one extreme print does not move the needle.</li>
      <li>50% = half the history was lower. 90% = only 10% of the window has been richer.</li>
      <li>Pair with rank: a wide divergence flags outlier-distorted distributions.</li>
    </ul>
  </div>
);

const SAMPLES_TIP = (
  <div className={styles.tip}>
    <div className={styles.tipTitle}>Samples</div>
    <div>Valid ATM IV readings inside the selected window.</div>
    <ul className={styles.tipList}>
      <li>30d BTC/ETH seeds from ~1 year of Deribit DVOL daily candles on startup.</li>
      <li>Other tenors accumulate one new point every 5 min from the live surface.</li>
      <li>Rank / pct show “–” until n ≥ 2 with a non-zero range.</li>
    </ul>
  </div>
);

function Chip({ tenor, result }: { tenor: IvTenor; result: IvHistoryTenorResult | undefined }) {
  const series = result?.series ?? [];
  const n = series.filter((p) => p.atmIv != null).length;
  const currentIv = result?.current.atmIv ?? null;
  const sampled = sampleEvenly(series, SPARK_POINTS);
  const path = sparkPath(
    sampled.map((p) => p.atmIv),
    100,
    22,
  );
  const level = rankLevel(result?.atmRank ?? null);
  return (
    <div className={styles.chip}>
      <div className={styles.chipTenor}>{tenor.toUpperCase()}</div>
      <div className={styles.chipIv}>{fmtIv(currentIv)}</div>
      <svg className={styles.spark} viewBox="0 0 100 22" preserveAspectRatio="none">
        {path && (
          <path d={path} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className={styles.chipBadges}>
        <HoverTooltip
          as="span"
          className={styles.badgeTrigger}
          placement="bottom-start"
          content={RANK_TIP}
        >
          <span className={styles.badge}>
            rank{' '}
            <span className={styles.rankValue} data-level={level}>
              {result?.atmRank != null ? result.atmRank.toFixed(0) : '–'}
            </span>
          </span>
        </HoverTooltip>
        <HoverTooltip
          as="span"
          className={styles.badgeTrigger}
          placement="bottom-start"
          content={PCT_TIP}
        >
          <span className={styles.badge}>
            pct{' '}
            <span className={styles.rankValue} data-level={level}>
              {result?.atmPercentile != null ? `${result.atmPercentile.toFixed(0)}%` : '–'}
            </span>
          </span>
        </HoverTooltip>
        <HoverTooltip
          as="span"
          className={styles.badgeTrigger}
          placement="bottom-start"
          content={SAMPLES_TIP}
        >
          <span className={styles.badge}>
            n <span className={styles.rankValue} data-level="none">{n}</span>
          </span>
        </HoverTooltip>
      </div>
    </div>
  );
}

interface Props {
  underlying: string;
}

function shortestCoverage(results: Array<IvHistoryTenorResult | undefined>, window: IvHistoryWindow): HistoryCoverage {
  const coverages = results.map((result) => getHistoryCoverage(result?.series ?? [], window, ['atmIv']));
  return coverages.reduce((min, item) => (item.coverageMs < min.coverageMs ? item : min));
}

export default function IvRankPanel({ underlying }: Props) {
  const [window, setWindow] = useState<IvHistoryWindow>('30d');
  const { data } = useIvHistory(underlying, window);
  const logo = getTokenLogo(underlying);
  const coverage = shortestCoverage(
    TENORS.map((t) => data?.tenors[t]),
    window,
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <HoverTooltip
          as="span"
          className={styles.title}
          placement="bottom-start"
          content={IVR_TIP}
        >
          <span className={styles.titleTrigger}>
            {logo && <img src={logo} alt="" className={styles.tokenLogo} />}
            {underlying} IV RANK
          </span>
        </HoverTooltip>
        <div className={styles.windowToggle}>
          <button
            type="button"
            className={styles.windowBtn}
            data-active={window === '30d' ? 'true' : undefined}
            onClick={() => setWindow('30d')}
          >
            30d
          </button>
          <button
            type="button"
            className={styles.windowBtn}
            data-active={window === '90d' ? 'true' : undefined}
            onClick={() => setWindow('90d')}
          >
            90d
          </button>
        </div>
      </div>
      <div className={styles.coverage} data-short={coverage.short ? 'true' : undefined}>
        {coverage.label}
      </div>

      <div className={styles.grid}>
        {TENORS.map((t) => (
          <Chip key={t} tenor={t} result={data?.tenors[t]} />
        ))}
      </div>
    </div>
  );
}
