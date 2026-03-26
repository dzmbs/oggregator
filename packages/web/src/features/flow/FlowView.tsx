import { useEffect, useMemo, useRef, useState } from "react";

import { Spinner, EmptyState, VenuePickerButton, AssetPickerButton } from "@components/ui";
import { VENUES } from "@lib/venue-meta";
import { useAppStore } from "@stores/app-store";
import { fmtIv } from "@lib/format";
import { useFlow, useFlowHistoryPage, useFlowHistorySummary } from "./queries";
import type { HistoryRange, TradeEvent, TradeHistoryCursor } from "./queries";
import BlockFlowView from "./BlockFlowView";
import { getCustomRangeFromBounds } from "./DateRangePicker";
import { HistoryControls, getPresetRange, type HistoryPreset } from "./HistoryControls";
import styles from "./FlowView.module.css";

const WHALE_THRESHOLD = 100_000;
const SHARK_THRESHOLD = 10_000;
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

type FlowMode = "all" | "block";
type FlowScope = "tape" | "history";

function parseStrikeAndType(instrument: string): { strike: string; type: string } {
  const match = instrument.match(/-(\d+(?:\.\d+)?)-([CP])(?:-|$)/);
  if (!match) return { strike: "–", type: "–" };
  return {
    strike: Number(match[1]).toLocaleString(),
    type: match[2] === "C" ? "CALL" : "PUT",
  };
}

function numericDateToHuman(raw: string): string {
  if (raw.length === 6 && /^\d{6}$/.test(raw)) {
    const yy = raw.slice(0, 2);
    const mm = parseInt(raw.slice(2, 4), 10);
    const dd = raw.slice(4, 6);
    if (mm >= 1 && mm <= 12) {
      return dd === "00" || !dd ? `${MONTHS[mm - 1]}${yy}` : `${dd}${MONTHS[mm - 1]}${yy}`;
    }
  }

  if (raw.length === 8 && /^\d{8}$/.test(raw)) {
    const yy = raw.slice(2, 4);
    const mm = parseInt(raw.slice(4, 6), 10);
    const dd = raw.slice(6, 8);
    if (mm >= 1 && mm <= 12) return `${dd}${MONTHS[mm - 1]}${yy}`;
  }

  return raw;
}

function parseExpiry(instrument: string): string {
  const human = instrument.match(/\d{1,2}[A-Z]{3}\d{2}/);
  if (human) return human[0] ?? "–";

  const numeric = instrument.match(/(?:^|[-_])(\d{6,8})(?:[-_]|$)/);
  if (numeric?.[1]) return numericDateToHuman(numeric[1]);

  const fallback = instrument.match(/(\d{6,8})/);
  if (fallback?.[1]) return numericDateToHuman(fallback[1]);

  return "–";
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtUsdCompact(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 100_000) return `$${(n / 1_000).toFixed(0)}K`;
  if (n >= 10_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return "<$1";
}

function getTradeTier(notionalUsd: number): "shrimp" | "shark" | "whale" {
  if (notionalUsd >= WHALE_THRESHOLD) return "whale";
  if (notionalUsd >= SHARK_THRESHOLD) return "shark";
  return "shrimp";
}

function getTradeBadge(tier: "shrimp" | "shark" | "whale"): string {
  if (tier === "whale") return "🐋";
  if (tier === "shark") return "🦈";
  return "🦐";
}

function getScopeLabel(scope: FlowScope): string {
  return scope === "tape" ? "Live Tape" : "History";
}

function getHistorySubtitle(range: HistoryRange): string {
  if (range.start && range.end) {
    return `${range.start.slice(0, 10)} → ${new Date(new Date(range.end).getTime() - 1).toISOString().slice(0, 10)}`;
  }
  return "All stored history";
}

interface TradeRowProps {
  trade: TradeEvent;
  isNew: boolean;
}

function TradeRow({ trade, isNew }: TradeRowProps) {
  const meta = VENUES[trade.venue];
  const { strike, type } = parseStrikeAndType(trade.instrument);
  const expiry = parseExpiry(trade.instrument);
  const premiumUsd = trade.premiumUsd;
  const notionalUsd = trade.notionalUsd;
  const tierBase = notionalUsd ?? premiumUsd ?? 0;
  const tier = getTradeTier(tierBase);

  return (
    <div
      className={styles.row}
      data-side={trade.side}
      data-new={isNew || undefined}
      data-size={tier}
      data-block={trade.isBlock || undefined}
    >
      <span className={styles.time}>{formatTime(trade.timestamp)}</span>

      <span className={styles.venue}>
        {meta?.logo ? <img src={meta.logo} className={styles.venueLogo} alt="" /> : null}
        <span className={styles.venueLabel}>{meta?.shortLabel ?? trade.venue}</span>
      </span>

      <span className={styles.side} data-side={trade.side}>{trade.side.toUpperCase()}</span>

      <span className={styles.instrument}>
        <span className={styles.expiry}>{expiry}</span>
        <span className={styles.strike}>{strike}</span>
        <span className={styles.type} data-type={type}>{type}</span>
      </span>

      <span className={styles.size}>{trade.size}</span>

      <span className={styles.moneyCell}>
        <span className={styles.moneyPrimary} data-size={tier}>{fmtUsdCompact(notionalUsd ?? premiumUsd)}</span>
        <span className={styles.moneySecondary}>Premium {fmtUsdCompact(premiumUsd)}</span>
      </span>

      <span className={styles.iv}>{trade.iv != null ? fmtIv(trade.iv) : "–"}</span>

      <span className={styles.tagCell}>
        {trade.isBlock ? <span className={styles.blockBadge}>BLOCK</span> : null}
        <span className={styles.tradeBadge} data-kind={tier}>{getTradeBadge(tier)}</span>
      </span>
    </div>
  );
}

export default function FlowView() {
  const [mode, setMode] = useState<FlowMode>("all");
  const [scope, setScope] = useState<FlowScope>("tape");
  const [historyPreset, setHistoryPreset] = useState<HistoryPreset>("today");
  const [historyRange, setHistoryRange] = useState<HistoryRange>(() => getPresetRange("today"));
  const [lastCustomRange, setLastCustomRange] = useState<HistoryRange>({ start: null, end: null });
  const [historyCursors, setHistoryCursors] = useState<Array<TradeHistoryCursor | null>>([null]);
  const underlying = useAppStore((s) => s.underlying);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const { data, isLoading, error } = useFlow(underlying);
  const liveTrades = useMemo(
    () => (data?.trades ?? []).filter((trade) => activeVenues.includes(trade.venue)),
    [activeVenues, data?.trades],
  );
  const pageCursor = historyCursors[historyCursors.length - 1] ?? null;
  const isHistoryRangeReady = historyPreset !== "custom" || Boolean(historyRange.start && historyRange.end);
  const historyPage = useFlowHistoryPage({
    underlying,
    venues: activeVenues,
    range: historyRange,
    cursor: pageCursor,
    limit: 100,
  }, scope === "history" && isHistoryRangeReady);
  const historySummary = useFlowHistorySummary(underlying, activeVenues, historyRange, scope === "history" && isHistoryRangeReady);
  const historyBounds = useFlowHistorySummary(underlying, activeVenues, { start: null, end: null }, scope === "history");
  const liveTradeIds = useMemo(() => new Set(liveTrades.map((trade) => trade.tradeUid)), [liveTrades]);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (!liveTrades.length) return;

    const currentIds = new Set(liveTrades.map((trade) => trade.tradeUid));
    if (prevCountRef.current === 0) {
      setSeenIds(currentIds);
      prevCountRef.current = liveTrades.length;
      return;
    }

    prevCountRef.current = liveTrades.length;
    const timer = setTimeout(() => setSeenIds(currentIds), 1500);
    return () => clearTimeout(timer);
  }, [liveTrades]);

  useEffect(() => {
    setHistoryCursors([null]);
  }, [activeVenues, historyRange.end, historyRange.start, underlying]);

  useEffect(() => {
    if (historyPreset !== "custom") return;
    if (historyRange.start && historyRange.end) return;

    const nextRange = lastCustomRange.start && lastCustomRange.end
      ? lastCustomRange
      : getCustomRangeFromBounds(historyBounds.data);

    if (!nextRange.start || !nextRange.end) return;
    setHistoryRange(nextRange);
    setLastCustomRange(nextRange);
  }, [historyBounds.data, historyPreset, historyRange.end, historyRange.start, lastCustomRange]);

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

  const historyTrades = historySummary.data?.count === 0 ? [] : (historyPage.data?.trades ?? []);
  const hasNextPage = Boolean(historyPage.data?.nextCursor) && (historySummary.data?.count ?? 0) > 0;
  const isCustomInitializing = historyPreset === "custom" && (!historyRange.start || !historyRange.end) && (historyBounds.isLoading || historyBounds.isFetching);
  const isHistoryLoading = scope === "history" && (isCustomInitializing || historyPage.isLoading || historySummary.isLoading);
  const isHistoryEmpty = scope === "history" && !isHistoryLoading && (historySummary.data?.count ?? 0) === 0;

  function handlePresetChange(preset: HistoryPreset) {
    setHistoryPreset(preset);

    if (preset === "custom") {
      const nextRange = lastCustomRange.start && lastCustomRange.end
        ? lastCustomRange
        : getCustomRangeFromBounds(historyBounds.data);
      setHistoryRange(nextRange);
      return;
    }

    setHistoryRange(getPresetRange(preset));
  }

  function handleRangeChange(range: HistoryRange) {
    setHistoryPreset("custom");
    setHistoryRange(range);
    if (range.start && range.end) {
      setLastCustomRange(range);
    }
  }

  function handleNextPage() {
    if (!historyPage.data?.nextCursor) return;
    setHistoryCursors((prev) => [...prev, historyPage.data?.nextCursor ?? null]);
  }

  function handlePreviousPage() {
    setHistoryCursors((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <div className={styles.modePicker}>
              <button className={styles.modeBtn} data-active={mode === "all"} onClick={() => setMode("all")}>All Trades</button>
              <button className={styles.modeBtn} data-active={mode === "block"} onClick={() => setMode("block")}>🏛 Institutions</button>
            </div>
            <div className={styles.modePicker}>
              <button className={styles.modeBtn} data-active={scope === "tape"} onClick={() => setScope("tape")}>Live Tape</button>
              <button className={styles.modeBtn} data-active={scope === "history"} onClick={() => setScope("history")}>History</button>
            </div>
            <AssetPickerButton />
            <VenuePickerButton />
          </div>
          <span className={styles.subtitle}>
            {mode === "all"
              ? scope === "tape"
                ? `${liveTrades.length} live trades · ${activeVenues.length} venues · auto-refreshing`
                : `${getScopeLabel(scope)} · ${isCustomInitializing ? "Loading available history…" : getHistorySubtitle(historyRange)} · ${activeVenues.length} venues`
              : `${scope === "history" ? `${getHistorySubtitle(historyRange)} · ` : ""}Institutional RFQ & block trades · ${activeVenues.length} venues`}
          </span>
        </div>
        {mode === "all" && scope === "tape" ? (
          <div className={styles.legend}>
            <span className={styles.legendItem}><span className={styles.legendDot} data-side="buy" /> Buys</span>
            <span className={styles.legendItem}><span className={styles.legendDot} data-side="sell" /> Sells</span>
            <span className={styles.legendItem}>🐋 $100K+ notional</span>
          </div>
        ) : null}
      </div>

      {mode === "block" ? (
        <BlockFlowView scope={scope} historyPreset={historyPreset} historyRange={historyRange} onPresetChange={handlePresetChange} onRangeChange={handleRangeChange} />
      ) : scope === "history" ? (
        <>
          <HistoryControls
            preset={historyPreset}
            range={historyRange}
            summary={historySummary.data}
            bounds={historyBounds.data}
            activeVenues={activeVenues}
            page={historyCursors.length}
            hasPreviousPage={historyCursors.length > 1}
            hasNextPage={hasNextPage}
            isPageLoading={historyPage.isFetching}
            isSummaryLoading={historySummary.isLoading || historySummary.isFetching || !historySummary.data}
            onPresetChange={handlePresetChange}
            onRangeChange={handleRangeChange}
            onPreviousPage={handlePreviousPage}
            onNextPage={handleNextPage}
          />

          {historyTrades.length > 0 ? (
            <div className={styles.tableHeader}>
              <span>TIME</span>
              <span>VENUE</span>
              <span>SIDE</span>
              <span>INSTRUMENT</span>
              <span>SIZE</span>
              <span>NOTIONAL</span>
              <span>IV</span>
              <span>TAG</span>
            </div>
          ) : null}

          <div className={styles.list}>
            {isHistoryLoading ? (
              <div className={styles.centeredState}><Spinner size="lg" label="Loading history…" /></div>
            ) : isHistoryEmpty ? (
              <EmptyState title="No stored trades in range" detail="Try a wider window, another venue selection, or let ingest collect more history." />
            ) : (
              historyTrades.map((trade) => <TradeRow key={trade.tradeUid} trade={trade} isNew={false} />)
            )}
          </div>
        </>
      ) : (
        <>
          <div className={styles.tableHeader}>
            <span>TIME</span>
            <span>VENUE</span>
            <span>SIDE</span>
            <span>INSTRUMENT</span>
            <span>SIZE</span>
            <span>NOTIONAL</span>
            <span>IV</span>
            <span>TAG</span>
          </div>

          <div className={styles.list}>
            {liveTrades.length === 0 ? (
              <EmptyState title="No trades yet" detail={`${underlying} options have low trading activity. Trades will appear here in real-time when they occur.`} />
            ) : (
              liveTrades.map((trade) => (
                <TradeRow key={trade.tradeUid} trade={trade} isNew={liveTradeIds.has(trade.tradeUid) && !seenIds.has(trade.tradeUid)} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
