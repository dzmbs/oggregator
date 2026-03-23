import type { EnrichedStrike, EnrichedSide } from "@shared/enriched";

import { VENUES } from "@lib/venue-meta";
import { IvChip, SpreadPill } from "@components/ui";
import { fmtUsd, fmtDelta } from "@lib/format";
import styles from "./MobileStrikeCard.module.css";

interface MobileStrikeCardProps {
  strike:       EnrichedStrike;
  isAtm:        boolean;
  forwardPrice: number | null;
  activeVenues: string[];
  isExpanded:   boolean;
  onToggle:     () => void;
}

interface SideSummaryProps {
  side:    EnrichedSide;
  type:    "call" | "put";
  itm:     boolean;
  venues:  string[];
}

function bestBidAsk(side: EnrichedSide, venues: string[]): { bid: number | null; ask: number | null } {
  let bestBid: number | null = null;
  let bestAsk: number | null = null;
  for (const [v, q] of Object.entries(side.venues)) {
    if (!venues.includes(v) || !q) continue;
    if (q.bid != null && (bestBid == null || q.bid > bestBid)) bestBid = q.bid;
    if (q.ask != null && (bestAsk == null || q.ask < bestAsk)) bestAsk = q.ask;
  }
  return { bid: bestBid, ask: bestAsk };
}

function SideSummary({ side, type, itm, venues }: SideSummaryProps) {
  const bestQ = side.bestVenue != null
    ? side.venues[side.bestVenue] ?? null
    : null;
  const bba = bestBidAsk(side, venues);

  return (
    <div className={styles.side} data-type={type} data-itm={itm}>
      <div className={styles.sideHeader}>
        <span className={styles.sideLabel}>{type === "call" ? "C" : "P"}</span>
        <div className={styles.sideVenues}>
          {venues.map((v) => {
            const meta = VENUES[v];
            const isBest = v === side.bestVenue;
            return meta?.logo ? (
              <img
                key={v}
                src={meta.logo}
                alt={meta.shortLabel ?? v}
                className={styles.venueLogo}
                style={{ opacity: isBest ? 1 : 0.3 }}
              />
            ) : null;
          })}
        </div>
      </div>
      <div className={styles.sideRow}>
        <div className={styles.sideMetric}>
          <span className={styles.metricLabel}>BID</span>
          <span className={styles.metricBid}>{fmtUsd(bba.bid)}</span>
        </div>
        <div className={styles.sideMetric}>
          <span className={styles.metricLabel}>ASK</span>
          <span className={styles.metricAsk}>{fmtUsd(bba.ask)}</span>
        </div>
        <div className={styles.sideMetric}>
          <span className={styles.metricLabel}>IV</span>
          <IvChip iv={side.bestIv} size="sm" />
        </div>
        <div className={styles.sideMetric}>
          <span className={styles.metricLabel}>Δ</span>
          <span className={styles.metricDelta}>{fmtDelta(bestQ?.delta ?? null)}</span>
        </div>
      </div>
    </div>
  );
}

function ExpandedVenueDetail({ side, type, venues }: { side: EnrichedSide; type: string; venues: string[] }) {
  const entries = Object.entries(side.venues).filter(([v]) => venues.includes(v));

  return (
    <div className={styles.venueDetail}>
      <div className={styles.venueDetailLabel}>{type === "call" ? "CALLS" : "PUTS"}</div>
      {entries.map(([venueId, q]) => {
        const meta = VENUES[venueId];
        const isBest = venueId === side.bestVenue;
        return (
          <div key={venueId} className={styles.venueDetailRow} data-best={isBest}>
            <div className={styles.venueDetailName}>
              {meta?.logo && <img src={meta.logo} className={styles.venueDetailLogo} alt="" />}
              <span>{meta?.shortLabel ?? venueId}</span>
              {isBest && <span className={styles.bestTag}>BEST</span>}
            </div>
            <div className={styles.venueDetailGrid}>
              <span className={styles.vdCell}>
                <span className={styles.vdLabel}>Bid</span>
                <span>{fmtUsd(q?.bid ?? null)}</span>
              </span>
              <span className={styles.vdCell}>
                <span className={styles.vdLabel}>Ask</span>
                <span>{fmtUsd(q?.ask ?? null)}</span>
              </span>
              <span className={styles.vdCell}>
                <span className={styles.vdLabel}>Mid</span>
                <span className={styles.vdAccent}>{fmtUsd(q?.mid ?? null)}</span>
              </span>
              <span className={styles.vdCell}>
                <span className={styles.vdLabel}>IV</span>
                <IvChip iv={q?.markIv ?? null} size="sm" />
              </span>
              <span className={styles.vdCell}>
                <span className={styles.vdLabel}>Spread</span>
                <SpreadPill spreadPct={q?.spreadPct ?? null} />
              </span>
              <span className={styles.vdCell}>
                <span className={styles.vdLabel}>Δ</span>
                <span>{fmtDelta(q?.delta ?? null)}</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function MobileStrikeCard({
  strike,
  isAtm,
  forwardPrice,
  activeVenues,
  isExpanded,
  onToggle,
}: MobileStrikeCardProps) {
  const callItm = forwardPrice != null && strike.strike < forwardPrice;
  const putItm  = forwardPrice != null && strike.strike > forwardPrice;
  const venues  = Object.keys(strike.call.venues).filter((v) => activeVenues.includes(v));

  return (
    <div className={styles.card} data-atm={isAtm} data-expanded={isExpanded}>
      <button className={styles.cardHeader} onClick={onToggle}>
        <div className={styles.strikeInfo}>
          {isAtm && <span className={styles.atmBadge}>ATM</span>}
          <span className={styles.strikeNum}>{strike.strike.toLocaleString()}</span>
        </div>
        <span className={styles.chevron} data-expanded={isExpanded}>›</span>
      </button>

      <div className={styles.sides}>
        <SideSummary side={strike.call} type="call" itm={callItm} venues={venues} />
        <SideSummary side={strike.put}  type="put"  itm={putItm}  venues={venues} />
      </div>

      {isExpanded && (
        <div className={styles.expandedBody}>
          <ExpandedVenueDetail side={strike.call} type="call" venues={activeVenues} />
          <ExpandedVenueDetail side={strike.put}  type="put"  venues={activeVenues} />
        </div>
      )}
    </div>
  );
}
