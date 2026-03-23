import { useState, useRef, useEffect } from "react";

import type { EnrichedStrike, EnrichedSide } from "@shared/enriched";

import { VENUES } from "@lib/venue-meta";
import { venueColor } from "@lib/colors";
import { IvChip, SpreadPill, EmptyState } from "@components/ui";
import { fmtUsd, fmtDelta } from "@lib/format";
import { useIsMobile } from "@hooks/useIsMobile";
import ExpandedRow from "./ExpandedRow";
import MobileStrikeCard from "./MobileStrikeCard";
import styles from "./ChainTable.module.css";

interface NewChainTableProps {
  strikes:      EnrichedStrike[];
  atmStrike:    number | null;
  forwardPrice: number | null;
  activeVenues: string[];
  myIv:         number | null;
}

function fmtGamma(v: number | null): string {
  if (v == null) return "–";
  return `${Math.round(v * 1e6)}`;
}

function fmtVega(v: number | null): string {
  if (v == null) return "–";
  return `${Math.round(v)}`;
}

// ── Venue column ──────────────────────────────────────────────────────────────

interface VenueColumnProps {
  side:         EnrichedSide;
  align:        "left" | "right";
  activeVenues: string[];
}

function VenueColumn({ side, align, activeVenues }: VenueColumnProps) {
  const entries = Object.entries(side.venues).filter(
    ([v]) => activeVenues.includes(v),
  );

  return (
    <div className={styles.venueCol} data-align={align}>
      {entries.map(([venueId]) => {
        const meta   = VENUES[venueId];
        const isBest = venueId === side.bestVenue;
        return (
          <div
            key={venueId}
            className={styles.logoItem}
            data-best={isBest}
            title={`${meta?.label ?? venueId}${isBest ? " — best" : ""}`}
          >
            {meta?.logo ? (
              <img
                src={meta.logo}
                alt={meta?.shortLabel ?? venueId}
                className={styles.logo}
                style={{ opacity: isBest ? 1 : 0.35 }}
              />
            ) : (
              <span
                className={styles.logoFallback}
                style={{ color: isBest ? venueColor(venueId) : undefined }}
              >
                {meta?.shortLabel ?? venueId.slice(0, 3).toUpperCase()}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Strike row ────────────────────────────────────────────────────────────────

interface StrikeRowProps {
  strike:       EnrichedStrike;
  isAtm:        boolean;
  isExpanded:   boolean;
  forwardPrice: number | null;
  onToggle:     () => void;
  activeVenues: string[];
  myIv:         number | null;
}

function StrikeRowItem({
  strike,
  isAtm,
  isExpanded,
  forwardPrice,
  onToggle,
  activeVenues,
  myIv,
}: StrikeRowProps) {
  const callItm = forwardPrice != null && strike.strike < forwardPrice;
  const putItm  = forwardPrice != null && strike.strike > forwardPrice;

  const callQ = strike.call.bestVenue != null
    ? strike.call.venues[strike.call.bestVenue] ?? null
    : null;
  const putQ = strike.put.bestVenue != null
    ? strike.put.venues[strike.put.bestVenue] ?? null
    : null;

  return (
    <div className={styles.rowWrap} data-expanded={isExpanded}>
      <div
        className={styles.row}
        data-atm={isAtm}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        {/* CALL side: VENUES | γ | ν | Δ | IV | SPREAD | MID */}
        <VenueColumn side={strike.call} align="left" activeVenues={activeVenues} />
        <span className={`${styles.greekCell} ${callItm ? styles.itmCall : ""}`}>
          {fmtGamma(callQ?.gamma ?? null)}
        </span>
        <span className={`${styles.greekCell} ${callItm ? styles.itmCall : ""}`}>
          {fmtVega(callQ?.vega ?? null)}
        </span>
        <span className={`${styles.deltaCell} ${callItm ? styles.itmCall : ""}`}>
          {fmtDelta(callQ?.delta ?? null)}
        </span>
        <div className={`${styles.ivCell} ${callItm ? styles.itmCall : ""}`}>
          <IvChip iv={strike.call.bestIv} size="sm" />
        </div>
        <div className={`${styles.spreadCell} ${callItm ? styles.itmCall : ""}`}>
          <SpreadPill spreadPct={callQ?.spreadPct ?? null} />
        </div>
        <span className={`${styles.midCell} ${styles.alignRight} ${callItm ? styles.itmCall : ""}`}>
          {fmtUsd(callQ?.mid ?? null)}
        </span>

        {/* STRIKE center */}
        <div className={styles.strikeCenter} data-atm={isAtm}>
          {isAtm && <span className={styles.atmBadge}>ATM</span>}
          <span className={styles.strikeNum}>{strike.strike.toLocaleString()}</span>
        </div>

        {/* PUT side: MID | SPREAD | IV | Δ | ν | γ | VENUES */}
        <span className={`${styles.midCell} ${putItm ? styles.itmPut : ""}`}>
          {fmtUsd(putQ?.mid ?? null)}
        </span>
        <div className={`${styles.spreadCell} ${putItm ? styles.itmPut : ""}`}>
          <SpreadPill spreadPct={putQ?.spreadPct ?? null} />
        </div>
        <div className={`${styles.ivCell} ${putItm ? styles.itmPut : ""}`}>
          <IvChip iv={strike.put.bestIv} size="sm" />
        </div>
        <span className={`${styles.deltaCell} ${styles.alignRight} ${putItm ? styles.itmPut : ""}`}>
          {fmtDelta(putQ?.delta ?? null)}
        </span>
        <span className={`${styles.greekCell} ${styles.alignRight} ${putItm ? styles.itmPut : ""}`}>
          {fmtVega(putQ?.vega ?? null)}
        </span>
        <span className={`${styles.greekCell} ${styles.alignRight} ${putItm ? styles.itmPut : ""}`}>
          {fmtGamma(putQ?.gamma ?? null)}
        </span>
        <VenueColumn side={strike.put} align="right" activeVenues={activeVenues} />
      </div>

      {isExpanded && (
        <ExpandedRow
          strike={strike.strike}
          callSide={strike.call}
          putSide={strike.put}
          myIv={myIv}
        />
      )}
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function NewChainTable({
  strikes,
  atmStrike,
  forwardPrice,
  activeVenues,
  myIv,
}: NewChainTableProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const atmRef  = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);
  const isMobile = useIsMobile();

  // Reset scroll flag when the strike set changes (expiry switch)
  const strikeCount = strikes.length;
  const firstStrike = strikes[0]?.strike;
  useEffect(() => {
    hasScrolledRef.current = false;
  }, [strikeCount, firstStrike]);

  // Scroll to ATM once per strike set, not on every live price tick
  useEffect(() => {
    if (hasScrolledRef.current) return;
    const timer = setTimeout(() => {
      if (atmRef.current && listRef.current) {
        const listRect = listRef.current.getBoundingClientRect();
        const atmRect  = atmRef.current.getBoundingClientRect();
        const offset   = atmRect.top - listRect.top - listRect.height / 3;
        listRef.current.scrollTop += offset;
        hasScrolledRef.current = true;
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [atmStrike]);

  if (strikes.length === 0) {
    return (
      <EmptyState
        icon="∅"
        title="No options data for this expiry"
      />
    );
  }

  function toggleRow(s: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  if (isMobile) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.list} ref={listRef}>
          {strikes.map((s) => {
            const isAtm = s.strike === atmStrike;
            return (
              <div key={s.strike} ref={isAtm ? atmRef : undefined}>
                {isAtm && forwardPrice != null && (
                  <div className={styles.atmMarker}>
                    <div className={styles.atmLine} />
                    <div className={styles.atmPill}>
                      <span className={styles.atmPillText}>
                        Fwd {fmtUsd(forwardPrice)}
                      </span>
                    </div>
                    <div className={styles.atmLine} />
                  </div>
                )}
                <MobileStrikeCard
                  strike={s}
                  isAtm={isAtm}
                  forwardPrice={forwardPrice}
                  activeVenues={activeVenues}
                  isExpanded={expanded.has(s.strike)}
                  onToggle={() => toggleRow(s.strike)}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.hdrLabel}>VENUES</span>
        <span className={styles.hdrLabel}>γ</span>
        <span className={styles.hdrLabel}>ν</span>
        <span className={styles.hdrLabel}>Δ</span>
        <span className={styles.hdrLabel}>IV</span>
        <span className={styles.hdrLabel}>SPREAD</span>
        <span className={styles.hdrLabel} data-align="right">MID</span>
        <span className={styles.hdrLabel} data-align="center">STRIKE</span>
        <span className={styles.hdrLabel}>MID</span>
        <span className={styles.hdrLabel}>SPREAD</span>
        <span className={styles.hdrLabel}>IV</span>
        <span className={styles.hdrLabel} data-align="right">Δ</span>
        <span className={styles.hdrLabel} data-align="right">ν</span>
        <span className={styles.hdrLabel} data-align="right">γ</span>
        <span className={styles.hdrLabel} data-align="right">VENUES</span>
      </div>

      <div className={styles.list} ref={listRef}>
        {strikes.map((s) => {
          const isAtm = s.strike === atmStrike;
          return (
            <div key={s.strike} ref={isAtm ? atmRef : undefined}>
              {isAtm && forwardPrice != null && (
                <div className={styles.atmMarker}>
                  <div className={styles.atmLine} />
                  <div className={styles.atmPill}>
                    <span className={styles.atmPillText}>
                      Fwd {fmtUsd(forwardPrice)}
                    </span>
                  </div>
                  <div className={styles.atmLine} />
                </div>
              )}
              <StrikeRowItem
                strike={s}
                isAtm={isAtm}
                isExpanded={expanded.has(s.strike)}
                forwardPrice={forwardPrice}
                onToggle={() => toggleRow(s.strike)}
                activeVenues={activeVenues}
                myIv={myIv}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
