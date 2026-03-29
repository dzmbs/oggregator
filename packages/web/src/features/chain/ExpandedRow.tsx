import type { EnrichedSide, VenueQuote, VenueId } from '@shared/enriched';

import { VENUES } from '@lib/venue-meta';
import { IvChip, SpreadPill } from '@components/ui';
import { fmtUsd, fmtDelta, fmtNum, fmtIv } from '@lib/format';
import styles from './ExpandedRow.module.css';

interface ExpandedRowProps {
  strike: number;
  callSide: EnrichedSide;
  putSide: EnrichedSide;
  myIv: number | null;
}

interface VenueRowProps {
  venueId: string;
  quote: VenueQuote;
  myIv: number | null;
  type: 'call' | 'put';
  strike: number;
}

function VenueRow({ venueId, quote, myIv, type, strike }: VenueRowProps) {
  const meta = VENUES[venueId];
  const mid = quote.mid;
  const breakeven = mid != null ? (type === 'call' ? strike + mid : strike - mid) : null;
  const edge = myIv != null && quote.markIv != null ? myIv - quote.markIv : null;

  return (
    <tr className={styles.venueRow}>
      <td className={styles.tdVenue}>
        <div className={styles.venueCell}>
          {meta?.logo && <img src={meta.logo} className={styles.venueLogo} alt="" />}
          <span className={styles.venueLabel}>{meta?.shortLabel ?? venueId}</span>
        </div>
      </td>

      <td className={styles.tdNum}>{fmtUsd(quote.bid)}</td>
      <td className={styles.tdNum}>{fmtUsd(quote.ask)}</td>
      <td className={styles.tdNum} data-accent="true">
        {fmtUsd(quote.mid)}
      </td>
      <td className={styles.tdNum}>{fmtIv(quote.bidIv)}</td>
      <td className={styles.tdChip}>
        <IvChip iv={quote.markIv} size="sm" />
      </td>

      <td className={styles.tdNum}>{fmtIv(quote.askIv)}</td>
      <td className={styles.tdChip}>
        <SpreadPill spreadPct={quote.spreadPct} />
      </td>

      <td className={styles.tdNum}>{fmtDelta(quote.delta)}</td>
      <td
        className={styles.tdNum}
        data-negative={quote.theta != null && quote.theta < 0 ? 'true' : undefined}
      >
        {quote.theta != null ? fmtUsd(quote.theta) : '–'}
      </td>

      <td className={styles.tdNum}>
        {quote.openInterest != null ? fmtNum(quote.openInterest, 0) : '–'}
      </td>
      <td className={styles.tdNum}>{fmtUsd(breakeven)}</td>
      <td className={styles.tdNum}>{fmtUsd(quote.totalCost)}</td>
      <td
        className={styles.tdNum}
        data-edge={edge != null ? (edge > 0 ? 'positive' : 'negative') : undefined}
      >
        {edge != null ? `${edge > 0 ? '+' : ''}${(edge * 100).toFixed(1)}%` : '–'}
      </td>
    </tr>
  );
}

interface SideTableProps {
  side: EnrichedSide;
  type: 'call' | 'put';
  strike: number;
  myIv: number | null;
}

function SideTable({ side, type, strike, myIv }: SideTableProps) {
  const entries = Object.entries(side.venues) as [VenueId, VenueQuote][];

  if (entries.length === 0) {
    return <div className={styles.noQuotes}>No quotes</div>;
  }

  return (
    <table className={styles.venueTable}>
      <thead>
        <tr className={styles.thead}>
          <th className={styles.thVenue}>VENUE</th>
          <th className={styles.th}>BID</th>
          <th className={styles.th}>ASK</th>
          <th className={styles.th}>MID</th>
          <th className={styles.th}>IV BID</th>
          <th className={styles.th}>IV MARK</th>
          <th className={styles.th}>IV ASK</th>
          <th className={styles.th}>SPREAD</th>
          <th className={styles.th}>Δ</th>
          <th className={styles.th}>THETA</th>
          <th className={styles.th}>OI</th>
          <th className={styles.th}>BREAK</th>
          <th className={styles.th}>COST</th>
          <th className={styles.th}>EDGE</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([venueId, quote]) => (
          <VenueRow
            key={venueId}
            venueId={venueId}
            quote={quote}
            myIv={myIv}
            type={type}
            strike={strike}
          />
        ))}
      </tbody>
    </table>
  );
}

export default function ExpandedRow({ strike, callSide, putSide, myIv }: ExpandedRowProps) {
  return (
    <div className={styles.expanded}>
      <div className={styles.side} data-type="call">
        <div className={styles.sideHeader}>
          <span className={styles.sideLabel}>CALLS</span>
          <span className={styles.sideStrike}>{strike.toLocaleString()}</span>
        </div>
        <SideTable side={callSide} type="call" strike={strike} myIv={myIv} />
      </div>

      <div className={styles.divider} />

      <div className={styles.side} data-type="put">
        <div className={styles.sideHeader}>
          <span className={styles.sideLabel}>PUTS</span>
        </div>
        <SideTable side={putSide} type="put" strike={strike} myIv={myIv} />
      </div>
    </div>
  );
}
