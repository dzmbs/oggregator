import { memo } from 'react';

import InfoTip from '@components/ui/InfoTip';
import { VenueDot } from '@components/ui';
import { fmtIv, fmtUsd, fmtCompact } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import type { LegRoute, VenueLegCandidate } from '@lib/analytics/verticalSpread';

import styles from './VenueRouterTable.module.css';

interface Props {
  shortLeg: LegRoute | null;
  longLeg: LegRoute | null;
  shortStrike: number | null;
  longStrike: number | null;
  executableNetCredit: number | null;
}

function VenueRouterTable({
  shortLeg,
  longLeg,
  shortStrike,
  longStrike,
  executableNetCredit,
}: Props) {
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          Cross-venue routing
          <InfoTip label="How routing is computed" title="Cross-venue routing" align="start">
            <p>
              Each leg is priced independently across all venues that quote the
              strike, then ranked by <strong>net after taker fees</strong>:
            </p>
            <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
              <li>
                <strong>Short (sell):</strong> highest <em>bid</em> wins — you
                want the most premium collected.
              </li>
              <li>
                <strong>Long (buy):</strong> lowest <em>ask</em> wins — you want
                to pay the least.
              </li>
              <li>
                Fees use venue-specific cap formulas
                (<code>min(rate × underlying, cap × optionPrice)</code>) so they
                stay realistic on cheap OTM strikes.
              </li>
            </ul>
            <p style={{ marginTop: 6 }}>
              <strong>How to think about it:</strong> the highlighted row is the
              best <em>quoted</em> venue, not a guaranteed fill — size, spread,
              and your account permissions all matter. The <code>inf</code> badge
              means IV was inferred from price (venue didn&apos;t publish bid/ask
              IV), so treat that IV as best-effort.
            </p>
          </InfoTip>
        </span>
        <span className={styles.subtitle}>Best execution per leg</span>
      </div>

      <LegTable
        legKind="short"
        strike={shortStrike}
        route={shortLeg}
        heading="Short leg · SELL"
      />
      <LegTable
        legKind="long"
        strike={longStrike}
        route={longLeg}
        heading="Long leg · BUY"
      />

      <div className={styles.sum}>
        <span className={styles.sumLabel}>Executable net credit (after fees)</span>
        <span className={styles.sumValue} data-kind="credit">
          {fmtUsd(executableNetCredit)}
        </span>
      </div>
    </div>
  );
}

export default memo(VenueRouterTable);

interface LegTableProps {
  legKind: 'short' | 'long';
  strike: number | null;
  route: LegRoute | null;
  heading: string;
}

function LegTable({ legKind, strike, route, heading }: LegTableProps) {
  return (
    <div className={styles.leg} data-kind={legKind}>
      <div className={styles.legHeader}>
        <span className={styles.legHeading}>{heading}</span>
        {strike != null && <span className={styles.legStrike}>@ {strike.toLocaleString()}</span>}
      </div>

      {(!route || route.candidates.length === 0) && (
        <div className={styles.empty}>No venues available at this strike.</div>
      )}

      {route && route.candidates.length > 0 && (
        <div className={styles.table}>
          <div className={styles.thead}>
            <div>Venue</div>
            <div className={styles.alignRight}>IV</div>
            <div className={styles.alignRight}>{legKind === 'short' ? 'Bid' : 'Ask'}</div>
            <div className={styles.alignRight}>Size</div>
            <div className={styles.alignRight}>Fee</div>
            <div className={styles.alignRight}>Net</div>
          </div>
          {route.candidates.map((c) => (
            <VenueRow
              key={c.venue}
              cand={c}
              isBest={route.best?.venue === c.venue}
              legKind={legKind}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VenueRow({
  cand,
  isBest,
  legKind,
}: {
  cand: VenueLegCandidate;
  isBest: boolean;
  legKind: 'short' | 'long';
}) {
  const meta = VENUES[cand.venue];
  return (
    <div className={styles.row} data-best={isBest} data-kind={legKind}>
      <div className={styles.venueCell}>
        <VenueDot venueId={cand.venue} isBest={isBest} />
        <span className={styles.venueLabel}>{meta?.label ?? cand.venue}</span>
        {cand.sourcedIv === 'inferred' && (
          <span className={styles.badge} title="IV inferred from price (venue did not publish bid/ask IV)">
            inf
          </span>
        )}
      </div>
      <div className={styles.cell}>{fmtIv(cand.iv)}</div>
      <div className={styles.cell}>{fmtUsd(cand.executablePrice)}</div>
      <div className={styles.cell}>{fmtCompact(cand.size)}</div>
      <div className={styles.cell}>{fmtUsd(cand.takerFee)}</div>
      <div className={styles.cell} data-win={isBest}>
        {fmtUsd(cand.netAfterFees)}
      </div>
    </div>
  );
}
