import type { ReactNode } from 'react';

import type { ChainStats } from '@shared/enriched';
import type { WsConnectionState } from '@oggregator/protocol';

import { fmtUsd, fmtUsdCompact, fmtIv, fmtPct, fmtNum } from '@lib/format';
import HoverTooltip from '@components/ui/HoverTooltip';
import type { StatsResponse } from './queries';
import RegimeChip from './RegimeChip';
import BasisTooltip from './BasisTooltip';
import styles from './StatStrip.module.css';

interface StatStripProps {
  stats: ChainStats;
  underlying: string;
  dte: number;
  connectionState?: WsConnectionState;
  marketStats?: StatsResponse | null;
}

interface StatCellProps {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  positive?: boolean | null; // true = green, false = red, null/undefined = neutral
  subPositive?: boolean | null;
  subTooltip?: ReactNode;
  labelTooltip?: ReactNode;
}

function StatCell({
  label,
  value,
  sub,
  accent,
  positive,
  subPositive,
  subTooltip,
  labelTooltip,
}: StatCellProps) {
  const labelNode = labelTooltip ? (
    <HoverTooltip
      as="span"
      className={styles.label}
      placement="bottom-start"
      content={labelTooltip}
      dataInteractive="true"
    >
      {label}
    </HoverTooltip>
  ) : (
    <span className={styles.label}>{label}</span>
  );

  return (
    <div className={styles.cell}>
      {labelNode}
      <span
        className={styles.value}
        data-accent={accent}
        data-positive={positive === true ? 'true' : positive === false ? 'false' : undefined}
      >
        {value}
      </span>
      {sub &&
        (subTooltip ? (
          <HoverTooltip
            as="span"
            className={styles.sub}
            placement="bottom-start"
            content={subTooltip}
            dataPositive={
              subPositive === true ? 'true' : subPositive === false ? 'false' : undefined
            }
            dataInteractive="true"
          >
            {sub}
          </HoverTooltip>
        ) : (
          <span
            className={styles.sub}
            data-positive={
              subPositive === true ? 'true' : subPositive === false ? 'false' : undefined
            }
          >
            {sub}
          </span>
        ))}
    </div>
  );
}

const IVR_TIP = (
  <div className={styles.statTip}>
    <div className={styles.statTipTitle}>IV Rank (52-week)</div>
    <div>
      Position of current Deribit DVOL within its 52-week range. DVOL is Deribit’s 30-day
      ATM IV index — the same series the IV history panel seeds from.
    </div>
    <div className={styles.statTipFormula}>
      IVR = (current − 52w low) / (52w high − 52w low) × 100
    </div>
    <ul className={styles.statTipList}>
      <li>
        <b style={{ color: 'var(--color-profit)' }}>0–30</b>: IV cheap historically — vol buyers favored.
      </li>
      <li>
        <b style={{ color: 'var(--color-warning)' }}>30–70</b>: mid-range; no strong edge.
      </li>
      <li>
        <b style={{ color: 'var(--color-loss)' }}>70–100</b>: IV rich historically — vol sellers favored.
      </li>
    </ul>
    <ul className={styles.statTipList}>
      <li>Sub-text shows the 52w low–high band the rank is measured against.</li>
      <li>Available for BTC and ETH only (the venues Deribit publishes DVOL for).</li>
    </ul>
  </div>
);

const IV_CHANGE_TIP = (
  <div className={styles.statTip}>
    <div className={styles.statTipTitle}>IV Δ1d</div>
    <div>Change in Deribit DVOL from yesterday’s UTC close to the latest live print.</div>
    <ul className={styles.statTipList}>
      <li>Positive (green): IV expanding — premium getting richer day-on-day.</li>
      <li>Negative (red): IV compressing — premium decaying.</li>
      <li>Resets at 00:05 UTC when the day rolls over and a new previousClose anchors the diff.</li>
    </ul>
  </div>
);

const ATM_IV_TIP = (
  <div className={styles.statTip}>
    <div className={styles.statTipTitle}>ATM IV</div>
    <div>
      Cross-venue average of at-the-money implied volatility for the currently selected expiry.
      Averages the mark IV of the call and put closest to the forward, across the active venues.
    </div>
    <ul className={styles.statTipList}>
      <li>Reflects this expiry only — for a constant-maturity view see the IV Rank panel.</li>
      <li>Pair with IVR to gauge whether this expiry’s IV is rich vs the 52-week range.</li>
    </ul>
  </div>
);

const SKEW_TIP = (
  <div className={styles.statTip}>
    <div className={styles.statTipTitle}>25Δ Skew</div>
    <div>25-delta call IV minus 25-delta put IV for the selected expiry.</div>
    <ul className={styles.statTipList}>
      <li>Negative (usual in BTC/ETH): puts richer than calls — downside fear priced in.</li>
      <li>Positive: calls richer than puts — upside FOMO / squeeze pricing.</li>
      <li>Compression toward zero often precedes regime shifts.</li>
    </ul>
  </div>
);

const PCOI_TIP = (
  <div className={styles.statTip}>
    <div className={styles.statTipTitle}>Put / Call OI</div>
    <div>Total put open interest divided by total call open interest for this expiry.</div>
    <ul className={styles.statTipList}>
      <li>&gt; 1: more puts open than calls — hedging / bearish lean.</li>
      <li>&lt; 1: more calls open than puts — directional upside positioning.</li>
      <li>Single-expiry only; compare across expiries on the term-structure view.</li>
    </ul>
  </div>
);

const CONN_DISPLAY: Record<WsConnectionState, { dot: string; label: string }> = {
  live: { dot: 'var(--color-profit)', label: 'Live' },
  connecting: { dot: 'var(--text-dim)', label: 'Connecting' },
  reconnecting: { dot: 'var(--color-warning, orange)', label: 'Reconnecting' },
  stale: { dot: 'var(--color-warning, orange)', label: 'Stale' },
  error: { dot: 'var(--color-loss)', label: 'Error' },
  closed: { dot: 'var(--text-dim)', label: 'Offline' },
};

export default function StatStrip({
  stats,
  underlying,
  dte,
  connectionState,
  marketStats,
}: StatStripProps) {
  const basisSub = stats.basisPct != null ? fmtPct(stats.basisPct, 3) : undefined;
  const basisPositive =
    stats.basisPct != null ? (stats.basisPct > 0 ? true : stats.basisPct < 0 ? false : null) : null;

  const skewPositive = stats.skew25d != null ? stats.skew25d > 0 : null;

  return (
    <div className={styles.strip}>
      <StatCell
        label={`${underlying} Spot`}
        value={fmtUsd(stats.indexPriceUsd)}
        sub={
          stats.forwardPriceUsd != null
            ? `Forward ${dte}d ${fmtUsd(stats.forwardPriceUsd)}`
            : undefined
        }
      />
      <div className={styles.divider} />
      <StatCell label="ATM IV" value={fmtIv(stats.atmIv)} accent labelTooltip={ATM_IV_TIP} />
      <div className={styles.divider} />
      <StatCell
        label="Put/Call OI"
        value={stats.putCallOiRatio != null ? fmtNum(stats.putCallOiRatio) : '–'}
        sub={`${dte}d to expiry`}
        labelTooltip={PCOI_TIP}
      />
      <div className={styles.divider} />
      <StatCell
        label="25Δ Skew"
        value={stats.skew25d != null ? fmtIv(stats.skew25d) : '–'}
        sub="call − put"
        positive={skewPositive}
        labelTooltip={SKEW_TIP}
      />
      <div className={styles.divider} />
      <StatCell
        label="Total OI"
        value={fmtUsdCompact(stats.totalOiUsd)}
        sub={basisSub ? `Basis ${basisSub}` : undefined}
        subPositive={basisPositive}
        subTooltip={
          stats.basisPct != null && dte > 0 ? (
            <BasisTooltip basisPct={stats.basisPct} dte={dte} />
          ) : undefined
        }
      />
      {marketStats?.dvol && (
        <>
          <div className={styles.divider} />
          <StatCell
            label="IVR"
            value={`${marketStats.dvol.ivr.toFixed(0)}`}
            sub={`52w: ${fmtIv(marketStats.dvol.low52w)}–${fmtIv(marketStats.dvol.high52w)}`}
            accent
            labelTooltip={IVR_TIP}
          />
          <div className={styles.divider} />
          <StatCell
            label="IV Δ1d"
            value={fmtPct(marketStats.dvol.ivChange1d * 100, 2)}
            positive={
              marketStats.dvol.ivChange1d > 0
                ? true
                : marketStats.dvol.ivChange1d < 0
                  ? false
                  : null
            }
            labelTooltip={IV_CHANGE_TIP}
          />
        </>
      )}
      <div className={styles.divider} />
      <RegimeChip
        basisPct={stats.basisPct}
        skew25d={stats.skew25d}
        ivChange1d={marketStats?.dvol?.ivChange1d ?? null}
        putCallOiRatio={stats.putCallOiRatio}
      />
      {connectionState && (
        <>
          <div className={styles.divider} />
          <div className={styles.cell}>
            <span className={styles.label}>Feed</span>
            <span className={styles.feedState}>
              <span
                className={styles.feedDot}
                data-state={connectionState}
                style={{ background: CONN_DISPLAY[connectionState].dot }}
              />
              {CONN_DISPLAY[connectionState].label}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
