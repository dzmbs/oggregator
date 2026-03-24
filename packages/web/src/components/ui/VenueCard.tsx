import { VENUES } from "@lib/venue-meta";
import { fmtUsd, fmtIv } from "@lib/format";
import styles from "./VenueCard.module.css";

export interface VenueCardDetail {
  label:    string;
  strike:   number;
  type:     "call" | "put";
  direction: "buy" | "sell";
  price:    number;
  spreadPct: number | null;
  iv:       number | null;
  size:     number | null;
  spreadCost: number | null;
}

interface VenueCardProps {
  venueId:   string;
  /** Main price (single-leg price or total strategy cost) */
  total:     number | null;
  totalLabel?: string;
  isBest:    boolean;
  available: boolean;
  details:   VenueCardDetail[];
  /** If provided, shows a button */
  action?:   { label: string; onClick: () => void };
  /** Optional savings text */
  savings?:  string;
}

export default function VenueCard({ venueId, total, totalLabel, isBest, available, details, action, savings }: VenueCardProps) {
  const meta = VENUES[venueId];

  return (
    <div className={styles.card} data-best={isBest || undefined} data-unavailable={!available || undefined}>
      <div className={styles.header}>
        {meta?.logo && <img src={meta.logo} className={styles.logo} alt="" />}
        <span className={styles.name}>{meta?.label ?? venueId}</span>
        {isBest && <span className={styles.bestTag}>BEST</span>}
        <span className={styles.total} data-positive={total != null && total > 0}>
          {available && total != null ? `${total > 0 ? "+" : ""}${fmtUsd(total)}` : "N/A"}
        </span>
      </div>

      {available && details.length > 0 && (
        <div className={styles.details}>
          {details.map((d, i) => (
            <div key={i} className={styles.row}>
              <span className={styles.dir} data-direction={d.direction}>
                {d.direction === "buy" ? "B" : "S"}
              </span>
              <span className={styles.strike}>{d.strike.toLocaleString()}</span>
              <span className={styles.type} data-type={d.type}>
                {d.type === "call" ? "C" : "P"}
              </span>
              <span className={styles.price}>{fmtUsd(d.price)}</span>
              {d.spreadPct != null && <span className={styles.spread}>{d.spreadPct.toFixed(1)}%</span>}
              {d.iv != null && <span className={styles.iv}>{fmtIv(d.iv)}</span>}
            </div>
          ))}
          {details.length === 1 && details[0] && (
            <>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Delta</span>
                <span className={styles.metaValue}>{details[0].size != null ? `Δ — Size ${details[0].size.toFixed(1)}` : "–"}</span>
              </div>
              {details[0].spreadCost != null && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Spread cost</span>
                  <span className={styles.metaValue}>{fmtUsd(details[0].spreadCost)}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {available && (totalLabel || savings) && (
        <div className={styles.footer}>
          {totalLabel && <span className={styles.footerLabel}>{totalLabel}</span>}
          {savings && <span className={styles.footerSavings}>{savings}</span>}
        </div>
      )}

      {available && action && (
        <button className={styles.actionBtn} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
