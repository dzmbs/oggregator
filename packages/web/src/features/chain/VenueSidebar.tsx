import type { CSSProperties } from "react";
import { VENUE_LIST, VENUES } from "@lib/venue-meta";
import { venueColor } from "@lib/colors";
import { fmtUsdCompact } from "@lib/format";
import type { VenueFailure } from "@shared/enriched";
import styles from "./VenueSidebar.module.css";

interface VenueSidebarProps {
  activeVenues:  string[];
  onToggle:      (venueId: string) => void;
  venueOi?:      Record<string, number>;
  failedVenues?: VenueFailure[];
}

export default function VenueSidebar({ activeVenues, onToggle, venueOi, failedVenues = [] }: VenueSidebarProps) {
  const failedSet = new Set(failedVenues.map((f) => f.venue));
  const failedMap = new Map(failedVenues.map((f) => [f.venue, f.reason]));
  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>Venues</div>
      <div className={styles.list}>
        {VENUE_LIST.map((venue) => {
          const active = activeVenues.includes(venue.id);
          const failed = failedSet.has(venue.id as VenueFailure["venue"]);
          const reason = failedMap.get(venue.id as VenueFailure["venue"]);
          const oi     = venueOi?.[venue.id];
          const color  = venueColor(venue.id);
          const meta   = VENUES[venue.id];
          return (
            <label
              key={venue.id}
              className={styles.item}
              data-active={active}
              data-failed={failed || undefined}
              style={{ "--venue-color": color } as CSSProperties}
              title={failed ? `Failed: ${reason}` : undefined}
            >
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={active}
                onChange={() => onToggle(venue.id)}
              />
              {failed
                ? <span className={styles.failedDot}>✕</span>
                : <img src={venue.logo} alt="" className={styles.logo} />
              }
              <span className={styles.name} style={failed ? { opacity: 0.5 } : undefined}>
                {venue.label}
              </span>
              {oi != null && (
                <span className={styles.oi}>{fmtUsdCompact(oi)}</span>
              )}
              {active && !failed && meta && (
                <span
                  className={styles.tag}
                  style={{ "--venue-color": color } as CSSProperties}
                >
                  {meta.shortLabel}
                </span>
              )}
              <span
                className={styles.statusDot}
                data-state={failed ? "failed" : active ? "live" : undefined}
                title={failed ? `Failed: ${reason}` : active ? "Live" : "Inactive"}
              />
            </label>
          );
        })}
      </div>

      <div className={styles.footer}>
        <div className={styles.settleNote}>
          <span className={styles.settleLabel}>Settlement</span>
          <div className={styles.settleItems}>
            <span>Deribit · USDC</span>
            <span>OKX · USDC</span>
            <span>Binance · USDT</span>
            <span>Bybit · USDC</span>
            <span>Derive · USDC</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
