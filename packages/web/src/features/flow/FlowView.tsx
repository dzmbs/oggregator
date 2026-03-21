import { useRef, useEffect, useState } from "react";

import { useAppStore } from "@stores/app-store";
import { Spinner, EmptyState } from "@components/ui";
import { VENUES } from "@lib/venue-meta";
import { fmtIv } from "@lib/format";
import { useFlow } from "./queries";
import type { TradeEvent } from "./queries";
import styles from "./FlowView.module.css";

// Notional thresholds for visual treatment
const WHALE_THRESHOLD   = 100_000; // $100k+ notional
const LARGE_THRESHOLD   = 25_000;  // $25k+ notional

function parseStrikeAndType(instrument: string): { strike: string; type: string } {
  const m = instrument.match(/-(\d+(?:\.\d+)?)-([CP])(?:-|$)/);
  if (!m) return { strike: "–", type: "–" };
  return {
    strike: Number(m[1]).toLocaleString(),
    type:   m[2] === "C" ? "CALL" : "PUT",
  };
}

function parseExpiry(instrument: string): string {
  // Match patterns like 22MAR26, 260322, 20260322
  const m = instrument.match(/(\d{1,2}[A-Z]{3}\d{2})|(\d{6})|(\d{8})/);
  if (!m) return "–";
  return m[0]!;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function notional(t: TradeEvent): number {
  // For inverse venues (Deribit, OKX), price is in BTC — use indexPrice for USD
  if (t.indexPrice && t.price < 1) {
    return t.price * t.indexPrice * t.size;
  }
  return t.price * t.size;
}

function fmtNotional(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

interface TradeRowProps {
  trade: TradeEvent;
  isNew: boolean;
}

function TradeRow({ trade, isNew }: TradeRowProps) {
  const meta      = VENUES[trade.venue];
  const { strike, type } = parseStrikeAndType(trade.instrument);
  const expiry    = parseExpiry(trade.instrument);
  const not       = notional(trade);
  const isWhale   = not >= WHALE_THRESHOLD;
  const isLarge   = not >= LARGE_THRESHOLD;
  const sizeClass = isWhale ? "whale" : isLarge ? "large" : undefined;

  return (
    <div
      className={styles.row}
      data-side={trade.side}
      data-new={isNew || undefined}
      data-size={sizeClass}
      data-block={trade.isBlock || undefined}
    >
      {isWhale && <span className={styles.whaleIcon}>🐋</span>}

      <span className={styles.time}>{formatTime(trade.timestamp)}</span>

      <span className={styles.venue}>
        {meta?.logo && <img src={meta.logo} className={styles.venueLogo} alt="" />}
        <span className={styles.venueLabel}>{meta?.shortLabel ?? trade.venue}</span>
      </span>

      <span className={styles.side} data-side={trade.side}>
        {trade.side.toUpperCase()}
      </span>

      <span className={styles.instrument}>
        <span className={styles.expiry}>{expiry}</span>
        <span className={styles.strike}>{strike}</span>
        <span className={styles.type} data-type={type}>{type}</span>
      </span>

      <span className={styles.size}>{trade.size}</span>

      <span className={styles.notional} data-size={sizeClass}>
        {fmtNotional(not)}
      </span>

      <span className={styles.iv}>
        {trade.iv != null ? fmtIv(trade.iv) : "–"}
      </span>

      {trade.isBlock && <span className={styles.blockBadge}>BLOCK</span>}
    </div>
  );
}

export default function FlowView() {
  const underlying = useAppStore((s) => s.underlying);
  const { data, isLoading, error } = useFlow(underlying);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const prevCountRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Track which trades are "new" since last poll for flash animation
  useEffect(() => {
    if (!data?.trades.length) return;

    const currentIds = new Set(
      data.trades.map((t) => `${t.venue}-${t.instrument}-${t.timestamp}-${t.size}`),
    );

    // On first load, mark everything as seen (no flash on initial render)
    if (prevCountRef.current === 0) {
      setSeenIds(currentIds);
      prevCountRef.current = data.trades.length;
      return;
    }

    // After first load, flash only genuinely new trades
    prevCountRef.current = data.trades.length;
    // seenIds stays as the previous set — new trades not in it will flash
    // After 1.5s, update seenIds so the flash fades
    const timer = setTimeout(() => setSeenIds(currentIds), 1500);
    return () => clearTimeout(timer);
  }, [data?.trades]);

  if (isLoading) {
    return (
      <div className={styles.view}>
        <Spinner size="lg" label="Loading trade flow…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.view}>
        <EmptyState icon="⚠" title="Failed to load flow" detail="Trade flow service may still be starting." />
      </div>
    );
  }

  const trades = data?.trades ?? [];

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>Live Options Flow — {underlying}</span>
          <span className={styles.subtitle}>
            {trades.length} trades · 5 venues · auto-refreshing
          </span>
        </div>
        <div className={styles.legend}>
          <span className={styles.legendItem}><span className={styles.legendDot} data-side="buy" /> Buys</span>
          <span className={styles.legendItem}><span className={styles.legendDot} data-side="sell" /> Sells</span>
          <span className={styles.legendItem}>🐋 $100K+</span>
        </div>
      </div>

      <div className={styles.tableHeader}>
        <span>TIME</span>
        <span>VENUE</span>
        <span>SIDE</span>
        <span>INSTRUMENT</span>
        <span>SIZE</span>
        <span>NOTIONAL</span>
        <span>IV</span>
      </div>

      <div className={styles.list} ref={listRef}>
        {trades.length === 0 ? (
          <EmptyState icon="◈" title="No trades yet" detail="Waiting for options trades to flow in…" />
        ) : (
          trades.map((t, i) => {
            const id = `${t.venue}-${t.instrument}-${t.timestamp}-${t.size}`;
            return (
              <TradeRow
                key={`${id}-${i}`}
                trade={t}
                isNew={!seenIds.has(id)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
