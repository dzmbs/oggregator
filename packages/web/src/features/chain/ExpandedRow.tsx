import { useMemo } from 'react';
import type { EnrichedSide, VenueQuote, VenueId } from '@shared/enriched';

import { VENUES } from '@lib/venue-meta';
import { IvChip, SpreadPill, ForwardDeltaPill } from '@components/ui';
import { fmtUsd, fmtDelta, fmtNum, fmtIv } from '@lib/format';
import { computeImpliedForward, computeImpliedForwardBand } from './forward-analysis';
import { useChartPanelsStore } from './chart-panels-store.js';
import { toVenueSymbol, NotSupportedVenueError, isChartSupportedVenue } from './instrument-symbol.js';
import styles from './ExpandedRow.module.css';

interface ForwardCell {
  fImplied: number | null;
  delta: number | null;
  withinConsensusBand: boolean | null;
}

interface ExpandedRowProps {
  strike: number;
  callSide: EnrichedSide;
  putSide: EnrichedSide;
  myIv: number | null;
  activeVenues: string[];
  atmStrike: number | null;
  atmConsensusForward: number | null;
  underlying: string;
  expiry: string;
}

interface VenueRowProps {
  venueId: string;
  quote: VenueQuote;
  myIv: number | null;
  type: 'call' | 'put';
  strike: number;
  forwardCell: ForwardCell | undefined;
  atmStrike: number | null;
}

function VenueRow({ venueId, quote, myIv, type, strike, forwardCell, atmStrike }: VenueRowProps) {
  const meta = VENUES[venueId];
  const mid = quote.mid;
  const breakeven = mid != null ? (type === 'call' ? strike + mid : strike - mid) : null;
  const edge = myIv != null && quote.markIv != null ? myIv - quote.markIv : null;
  const mirror = type === 'put';

  const cells = [
    <td key="venue" className={styles.tdVenue} data-mirror={mirror || undefined}>
      <div className={styles.venueCell}>
        {meta?.logo && <img src={meta.logo} className={styles.venueLogo} alt="" />}
        <span className={styles.venueLabel}>{meta?.shortLabel ?? venueId}</span>
      </div>
    </td>,
    <td key="fimplied" className={styles.tdNum} data-accent="true">
      {fmtUsd(forwardCell?.fImplied ?? null)}
    </td>,
    <td key="bid" className={styles.tdNum}>
      {fmtUsd(quote.bid)}
    </td>,
    <td key="ask" className={styles.tdNum}>
      {fmtUsd(quote.ask)}
    </td>,
    <td key="mid" className={styles.tdNum} data-accent="true">
      {fmtUsd(quote.mid)}
    </td>,
    <td key="bidIv" className={styles.tdNum}>
      {fmtIv(quote.bidIv)}
    </td>,
    <td key="markIv" className={styles.tdChip}>
      <IvChip iv={quote.markIv} size="sm" />
    </td>,
    <td key="askIv" className={styles.tdNum}>
      {fmtIv(quote.askIv)}
    </td>,
    <td key="spread" className={styles.tdChip}>
      <SpreadPill spreadPct={quote.spreadPct} />
    </td>,
    <td key="delta" className={styles.tdNum}>
      {fmtDelta(quote.delta)}
    </td>,
    <td
      key="theta"
      className={styles.tdNum}
      data-negative={quote.theta != null && quote.theta < 0 ? 'true' : undefined}
    >
      {quote.theta != null ? fmtUsd(quote.theta) : '–'}
    </td>,
    <td key="oi" className={styles.tdNum}>
      {quote.openInterest != null ? fmtNum(quote.openInterest, 0) : '–'}
    </td>,
    <td key="break" className={styles.tdNum}>
      {fmtUsd(breakeven)}
    </td>,
    <td key="cost" className={styles.tdNum}>
      {fmtUsd(quote.totalCost)}
    </td>,
    <td key="cons" className={styles.tdChip}>
      <ForwardDeltaPill
        delta={forwardCell?.delta ?? null}
        atmStrike={atmStrike}
        withinConsensusBand={forwardCell?.withinConsensusBand ?? null}
      />
    </td>,
    <td
      key="edge"
      className={styles.tdNum}
      data-edge={edge != null ? (edge > 0 ? 'positive' : 'negative') : undefined}
    >
      {edge != null ? `${edge > 0 ? '+' : ''}${(edge * 100).toFixed(1)}%` : '–'}
    </td>,
  ];

  return <tr className={styles.venueRow}>{mirror ? [...cells].reverse() : cells}</tr>;
}

interface SideTableProps {
  side: EnrichedSide;
  type: 'call' | 'put';
  strike: number;
  myIv: number | null;
  forwardsByVenue: Map<VenueId, ForwardCell>;
  atmStrike: number | null;
}

function SideTable({ side, type, strike, myIv, forwardsByVenue, atmStrike }: SideTableProps) {
  const entries = Object.entries(side.venues) as [VenueId, VenueQuote][];

  if (entries.length === 0) {
    return <div className={styles.noQuotes}>No quotes</div>;
  }

  const mirror = type === 'put';

  const headers = [
    <th key="venue" className={styles.thVenue} data-mirror={mirror || undefined}>
      VENUE
    </th>,
    <th key="fimplied" className={styles.th}>
      F_IMPLIED
    </th>,
    <th key="bid" className={styles.th}>
      BID
    </th>,
    <th key="ask" className={styles.th}>
      ASK
    </th>,
    <th key="mid" className={styles.th}>
      MID
    </th>,
    <th key="bidIv" className={styles.th}>
      IV BID
    </th>,
    <th key="markIv" className={styles.th}>
      IV MARK
    </th>,
    <th key="askIv" className={styles.th}>
      IV ASK
    </th>,
    <th key="spread" className={styles.th}>
      SPREAD
    </th>,
    <th
      key="delta"
      className={styles.th}
      title={
        'Δ DELTA — price sensitivity of this option to the underlying.\n\n' +
        '• Magnitude: option moves ~Δ dollars for each $1 move in spot. 0.50 Δ → option moves $0.50 per $1 move.\n' +
        '• Sign: calls positive, puts negative. Long calls / short puts = long delta; long puts / short calls = short delta.\n' +
        '• Proxy for moneyness: |Δ| ≈ probability of finishing in-the-money. 0.25 Δ → ~25% ITM odds.'
      }
    >
      Δ
    </th>,
    <th
      key="theta"
      className={styles.th}
      title={
        'Θ THETA — daily time decay, in USD.\n\n' +
        '• What it costs: if spot and vol do not move, the option loses this many dollars per day.\n' +
        '• Sign: long options pay theta (negative for you); short options collect theta (positive for you).\n' +
        '• Accelerates near expiry: ATM theta is small far out, steep into the last week.'
      }
    >
      THETA
    </th>,
    <th key="oi" className={styles.th}>
      OI
    </th>,
    <th key="break" className={styles.th}>
      BREAK
    </th>,
    <th key="cost" className={styles.th}>
      COST
    </th>,
    <th
      key="cons"
      className={styles.th}
      title={
        'Δ VS CONSENSUS — how far this venue’s implied forward is from the cross-venue median.\n\n' +
        '• Near zero (green): clean forward. Any price difference here reflects real MM skew — potentially tradeable edge.\n' +
        '• Moderate (amber): some forward drift. Interpret price differences with caution.\n' +
        '• Large (red): forward drift dominates. Cheap/expensive prices on this venue are mostly just forward, not edge.\n' +
        '• Muted: consensus lies inside this venue’s bid/ask no-arb band — the drift is explainable by spread, not a real dislocation.'
      }
    >
      Δ CONS
    </th>,
    <th
      key="edge"
      className={styles.th}
      title={
        'EDGE — the gap between your IV view (“MY IV” input above the chain) and this venue’s mark IV.\n\n' +
        '• Positive (green): the venue is pricing vol lower than you think — a buyer’s edge (you’d buy premium here).\n' +
        '• Negative (red): the venue is pricing vol higher than you think — a seller’s edge (you’d sell premium here).\n' +
        '• Blank: enter a value in MY IV to see your edge against each venue.'
      }
    >
      EDGE
    </th>,
  ];

  return (
    <table className={styles.venueTable}>
      <thead>
        <tr className={styles.thead}>{mirror ? [...headers].reverse() : headers}</tr>
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
            forwardCell={forwardsByVenue.get(venueId)}
            atmStrike={atmStrike}
          />
        ))}
      </tbody>
    </table>
  );
}

export default function ExpandedRow({
  strike,
  callSide,
  putSide,
  myIv,
  activeVenues,
  atmStrike,
  atmConsensusForward,
  underlying,
  expiry,
}: ExpandedRowProps) {
  const forwardsByVenue = useMemo<Map<VenueId, ForwardCell>>(() => {
    const map = new Map<VenueId, ForwardCell>();
    const ids = new Set<VenueId>([
      ...(Object.keys(callSide.venues) as VenueId[]),
      ...(Object.keys(putSide.venues) as VenueId[]),
    ]);
    for (const v of ids) {
      if (!activeVenues.includes(v)) continue;
      const callQ = callSide.venues[v];
      const putQ = putSide.venues[v];
      const fImplied = computeImpliedForward(strike, callQ?.mid ?? null, putQ?.mid ?? null);
      const delta =
        fImplied != null && atmConsensusForward != null ? fImplied - atmConsensusForward : null;
      const band = computeImpliedForwardBand(
        strike,
        callQ?.bid ?? null,
        callQ?.ask ?? null,
        putQ?.bid ?? null,
        putQ?.ask ?? null,
      );
      const withinConsensusBand =
        band != null && atmConsensusForward != null
          ? atmConsensusForward >= band.low && atmConsensusForward <= band.high
          : null;
      map.set(v, { fImplied, delta, withinConsensusBand });
    }
    return map;
  }, [callSide, putSide, strike, activeVenues, atmConsensusForward]);

  const isAtm = atmStrike != null && strike === atmStrike;

  return (
    <div className={styles.expanded}>
      {atmConsensusForward != null && atmStrike != null && (
        <div className={styles.consensusLine}>
          CONSENSUS F @ ATM {atmStrike.toLocaleString()}: {fmtUsd(atmConsensusForward)}
        </div>
      )}

      <div className={styles.sides}>
        <div className={styles.side} data-type="call">
          <div className={styles.sideHeader}>
            <span className={styles.sideLabel}>CALLS</span>
            <ChartButton
              underlying={underlying}
              expiry={expiry}
              strike={strike}
              type="call"
              side={callSide}
              activeVenues={activeVenues as VenueId[]}
            />
          </div>
          <div className={styles.sideScroll}>
            <SideTable
              side={callSide}
              type="call"
              strike={strike}
              myIv={myIv}
              forwardsByVenue={forwardsByVenue}
              atmStrike={atmStrike}
            />
          </div>
        </div>

        <div className={styles.strikeChannel} data-atm={isAtm || undefined}>
          <div className={styles.strikeChannelHeader}>
            {isAtm && <span className={styles.strikeAtmBadge}>ATM</span>}
            <span className={styles.strikeChannelNum} data-atm={isAtm || undefined}>
              {strike.toLocaleString()}
            </span>
          </div>
        </div>

        <div className={styles.side} data-type="put">
          <div className={styles.sideHeader} data-align="end">
            <ChartButton
              underlying={underlying}
              expiry={expiry}
              strike={strike}
              type="put"
              side={putSide}
              activeVenues={activeVenues as VenueId[]}
            />
            <span className={styles.sideLabel}>PUTS</span>
          </div>
          <div className={styles.sideScroll}>
            <SideTable
              side={putSide}
              type="put"
              strike={strike}
              myIv={myIv}
              forwardsByVenue={forwardsByVenue}
              atmStrike={atmStrike}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface ChartButtonProps {
  underlying: string;
  expiry: string;
  strike: number;
  type: 'call' | 'put';
  side: EnrichedSide;
  activeVenues: readonly VenueId[];
}

function pickPrimaryVenue(side: EnrichedSide, active: readonly VenueId[]): VenueId | null {
  const entries = (Object.entries(side.venues) as [VenueId, VenueQuote][])
    .filter(([v]) => active.includes(v) && isChartSupportedVenue(v));
  if (entries.length === 0) return null;
  entries.sort((a, b) => (b[1].openInterest ?? 0) - (a[1].openInterest ?? 0));
  return entries[0]?.[0] ?? null;
}

function ChartButton({ underlying, expiry, strike, type, side, activeVenues }: ChartButtonProps) {
  const openPanel = useChartPanelsStore((s) => s.openPanel);
  const venue = pickPrimaryVenue(side, activeVenues);
  const disabled = venue == null;
  return (
    <button
      type="button"
      className={styles.chartBtn}
      disabled={disabled}
      title={disabled ? 'No venue available for this strike' : `Open chart for ${type.toUpperCase()}`}
      onClick={() => {
        if (!venue) return;
        try {
          const symbol = toVenueSymbol({ venue, underlying, expiry, strike, type });
          openPanel({ venue, symbol, underlying, expiry, strike, type });
        } catch (err) {
          if (err instanceof NotSupportedVenueError) return;
          throw err;
        }
      }}
    >
      Chart
    </button>
  );
}
