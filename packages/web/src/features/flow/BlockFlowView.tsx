import { useState } from "react";

import { Spinner, EmptyState } from "@components/ui";
import { VENUES } from "@lib/venue-meta";
import { fmtUsd } from "@lib/format";
import { useBlockFlow } from "./block-queries";
import type { BlockTradeEvent } from "./block-queries";
import StrategyIcon, { getStrategyLabel } from "./StrategyIcon";
import styles from "./BlockFlowView.module.css";

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function fmtNotional(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(2)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  if (n >= 1) return `$${n.toFixed(0)}`;
  return "—";
}

function numDateToHuman(raw: string): string {
  const s = raw.length === 8 ? raw.slice(2) : raw;
  const yy = s.slice(0, 2);
  const mm = parseInt(s.slice(2, 4), 10);
  const dd = s.slice(4, 6);
  if (mm >= 1 && mm <= 12) return `${dd}${MONTHS[mm - 1]}${yy}`;
  return raw;
}

function parseLegInfo(instrument: string): { expiry: string; strike: string; type: string } {
  const parts = instrument.split("-");
  const last = parts[parts.length - 1];
  const type = last === "C" ? "CALL" : last === "P" ? "PUT" : "—";

  const strikePart = parts[parts.length - 2];
  const strike = strikePart && /^\d+$/.test(strikePart)
    ? Number(strikePart).toLocaleString()
    : "—";

  let expiry = "—";
  for (const p of parts) {
    if (/^\d{1,2}[A-Z]{3}\d{2}$/.test(p)) { expiry = p; break; }
    if (/^\d{6,8}$/.test(p) && Number(p) > 200000) { expiry = numDateToHuman(p); break; }
  }

  return { expiry, strike, type };
}

interface BlockTradeRowProps {
  trade:      BlockTradeEvent;
  isExpanded: boolean;
  onToggle:   () => void;
}

function BlockTradeRow({ trade, isExpanded, onToggle }: BlockTradeRowProps) {
  const meta = VENUES[trade.venue];
  const isMultiLeg = trade.legs.length > 1;
  const firstLeg = trade.legs[0];
  const legInfo = firstLeg ? parseLegInfo(firstLeg.instrument) : null;
  const hasNotional = trade.notionalUsd > 0;
  const isWhale = hasNotional && trade.notionalUsd >= 100_000;

  return (
    <div className={styles.tradeWrap}>
      <button
        className={styles.trade}
        data-side={trade.direction}
        data-whale={isWhale || undefined}
        onClick={onToggle}
      >
        <div className={styles.tradeMain}>
          <StrategyIcon strategy={trade.strategy ?? legInfo?.type ?? null} size={18} />

          <div className={styles.tradeInfo}>
            <div className={styles.tradeTop}>
              <span className={styles.strategy}>{getStrategyLabel(trade.strategy, legInfo?.type)}</span>
              {isMultiLeg && (
                <span className={styles.legCount}>{trade.legs.length}L</span>
              )}
              <span className={styles.side} data-side={trade.direction}>
                {trade.direction.toUpperCase()}
              </span>
            </div>
            <div className={styles.tradeBottom}>
              {legInfo && (
                <>
                  <span className={styles.expiry}>{legInfo.expiry}</span>
                  {!isMultiLeg && <span className={styles.strike}>{legInfo.strike}</span>}
                  {!isMultiLeg && (
                    <span className={styles.optType} data-type={legInfo.type}>{legInfo.type}</span>
                  )}
                </>
              )}
            </div>
          </div>

          <div className={styles.tradeRight}>
            <span className={styles.notional} data-whale={isWhale || undefined}>
              {hasNotional ? fmtNotional(trade.notionalUsd) : `${trade.totalSize} contracts`}
            </span>
            <div className={styles.tradeMeta}>
              <span className={styles.venue}>
                {meta?.logo && <img src={meta.logo} className={styles.venueLogo} alt="" />}
                {meta?.shortLabel ?? trade.venue}
              </span>
              <span className={styles.time}>{formatDate(trade.timestamp)} {formatTime(trade.timestamp)}</span>
            </div>
          </div>

          {isMultiLeg && (
            <span className={styles.chevron} data-expanded={isExpanded}>›</span>
          )}
        </div>
      </button>

      {isExpanded && isMultiLeg && (
        <div className={styles.legs}>
          {trade.legs.map((leg, i) => {
            const info = parseLegInfo(leg.instrument);
            return (
              <div key={i} className={styles.leg} data-side={leg.direction}>
                <span className={styles.legDir} data-side={leg.direction}>
                  {leg.direction === "buy" ? "BUY" : "SELL"}
                </span>
                <span className={styles.legSize}>
                  {leg.size}{leg.ratio > 1 ? ` (${leg.ratio}x)` : ""}
                </span>
                <span className={styles.legExpiry}>{info.expiry}</span>
                <span className={styles.legStrike}>{info.strike}</span>
                <span className={styles.legType} data-type={info.type}>{info.type}</span>
                {leg.price > 0 && (
                  <span className={styles.legPrices}>
                    <span className={styles.legPerContract}>{fmtUsd(leg.price)}/ct</span>
                    <span className={styles.legTotal}>{fmtUsd(leg.price * leg.size * leg.ratio)}</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function BlockFlowView() {
  const { data, isLoading, error } = useBlockFlow();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleTrade(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (isLoading) {
    return <Spinner size="lg" label="Loading block trades…" />;
  }

  if (error) {
    return <EmptyState icon="⚠" title="Failed to load institutional trades" detail="Service may still be starting. Deribit and Bybit connect via WebSocket, OKX and Derive poll every 90s." />;
  }

  const trades = data?.trades ?? [];

  if (trades.length === 0) {
    return <EmptyState icon="🏛" title="No institutional trades yet" detail="RFQ and block trades will appear here as they execute across Deribit, OKX, Bybit, Binance, and Derive." />;
  }

  return (
    <div className={styles.list}>
      {trades.map((t) => {
        const key = `${t.venue}-${t.tradeId}`;
        return (
          <BlockTradeRow
            key={key}
            trade={t}
            isExpanded={expanded.has(key)}
            onToggle={() => toggleTrade(key)}
          />
        );
      })}
    </div>
  );
}
