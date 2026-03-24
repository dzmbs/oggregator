import { useMemo, useState, useCallback, useEffect } from "react";

import { useAppStore } from "@stores/app-store";
import { AssetPickerButton, VenuePickerButton } from "@components/ui";
import { useChainQuery, useExpiries } from "@features/chain/queries";
import { fmtUsd, formatExpiry, dteDays } from "@lib/format";
import { useStrategyStore } from "./strategy-store";
import { computePayoff, computeMetrics, computeScenarioPayoff, detectStrategy, type Leg } from "./payoff";
import { buildShareUrl, decodeStrategy } from "./share";
import PayoffChart from "./PayoffChart";
import VenueSlideover from "./VenueSlideover";
import StrategyTemplates, { TEMPLATES } from "./StrategyTemplates";
import LegInput from "./LegInput";
import styles from "./Architect.module.css";

// ── Inline-editable leg row ──────────────────────────────────────────────────

interface LegRowProps {
  leg: Leg;
  allStrikes: number[];
  allExpiries: string[];
  onRemove: () => void;
  onUpdate: (id: string, patch: Partial<Leg>) => void;
}

function LegRow({ leg, allStrikes, allExpiries, onRemove, onUpdate }: LegRowProps) {
  const [editing, setEditing] = useState(false);

  function stepStrike(delta: number) {
    const sorted = [...allStrikes].sort((a, b) => a - b);
    const idx = sorted.indexOf(leg.strike);
    if (idx < 0) return;
    const next = sorted[idx + delta];
    if (next != null) onUpdate(leg.id, { strike: next });
  }

  function stepExpiry(delta: number) {
    const idx = allExpiries.indexOf(leg.expiry);
    if (idx < 0) return;
    const next = allExpiries[idx + delta];
    if (next != null) onUpdate(leg.id, { expiry: next });
  }

  function toggleDirection() {
    onUpdate(leg.id, { direction: leg.direction === "buy" ? "sell" : "buy" });
  }

  function toggleType() {
    onUpdate(leg.id, { type: leg.type === "call" ? "put" : "call" });
  }

  if (editing) {
    return (
      <div className={styles.legRowEditing}>
        <div className={styles.legEditRow}>
          <span className={styles.legEditLabel}>Strike</span>
          <button className={styles.legStepBtn} onClick={() => stepStrike(-1)}>−</button>
          <span className={styles.legStepVal}>{leg.strike.toLocaleString()}</span>
          <button className={styles.legStepBtn} onClick={() => stepStrike(1)}>+</button>
        </div>
        <div className={styles.legEditRow}>
          <span className={styles.legEditLabel}>Expiry</span>
          <button className={styles.legStepBtn} onClick={() => stepExpiry(-1)}>−</button>
          <span className={styles.legStepVal}>{formatExpiry(leg.expiry)}</span>
          <button className={styles.legStepBtn} onClick={() => stepExpiry(1)}>+</button>
        </div>
        <div className={styles.legEditRow}>
          <span className={styles.legEditLabel}>Side</span>
          <button className={styles.legStepBtn} onClick={toggleDirection} style={{ width: "auto", padding: "0 6px" }}>
            {leg.direction === "buy" ? "BUY" : "SELL"}
          </button>
          <button className={styles.legStepBtn} onClick={toggleType} style={{ width: "auto", padding: "0 6px" }}>
            {leg.type === "call" ? "CALL" : "PUT"}
          </button>
          <div className={styles.legEditActions}>
            <button className={styles.legEditSave} onClick={() => setEditing(false)}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.legRow} data-direction={leg.direction}>
      <span className={styles.legDirection} data-direction={leg.direction}>
        {leg.direction === "buy" ? "BUY" : "SELL"}
      </span>
      <span className={styles.legQty}>{leg.quantity}×</span>
      <span className={styles.legStrike}>{leg.strike.toLocaleString()}</span>
      <span className={styles.legType} data-type={leg.type}>
        {leg.type === "call" ? "C" : "P"}
      </span>
      <span className={styles.legExpiry}>{formatExpiry(leg.expiry)}</span>
      <span className={styles.legPrice}>{fmtUsd(leg.entryPrice)}</span>
      <button className={styles.legEditBtn} onClick={() => setEditing(true)} title="Edit leg">✎</button>
      <button className={styles.legRemove} onClick={onRemove} title="Remove leg">×</button>
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export default function ArchitectView() {
  const underlying   = useAppStore((s) => s.underlying);
  const expiry       = useAppStore((s) => s.expiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const { data: expiriesData } = useExpiries(underlying);
  const allExpiries = expiriesData?.expiries ?? [];

  const defaultExpiry = (() => {
    if (expiry && allExpiries.includes(expiry) && dteDays(expiry) >= 2) return expiry;
    const viable = allExpiries.find((e) => dteDays(e) >= 3);
    return viable ?? allExpiries[1] ?? allExpiries[0] ?? "";
  })();
  const { data: chain } = useChainQuery(underlying, defaultExpiry, activeVenues, { refetchInterval: 10_000 });

  const legs      = useStrategyStore((s) => s.legs);
  const clearLegs = useStrategyStore((s) => s.clearLegs);
  const removeLeg = useStrategyStore((s) => s.removeLeg);
  const updateLeg = useStrategyStore((s) => s.updateLeg);
  const addLeg    = useStrategyStore((s) => s.addLeg);
  const strategyUnderlying = useStrategyStore((s) => s.underlying);

  if (strategyUnderlying && strategyUnderlying !== underlying && legs.length > 0) {
    clearLegs();
  }

  const [showVenues, setShowVenues] = useState(false);
  const [ivShift, setIvShift] = useState(0);
  const [dteShift, setDteShift] = useState(0);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Restore strategy from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("strategy");
    if (!encoded) return;
    const decoded = decodeStrategy(encoded);
    if (!decoded) return;
    clearLegs();
    for (const leg of decoded.legs) addLeg(leg, decoded.underlying);
    // Clean the URL
    params.delete("strategy");
    const clean = params.toString();
    window.history.replaceState({}, "", clean ? `?${clean}` : window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const spotPrice = chain?.stats.spotIndexUsd ?? chain?.stats.forwardPriceUsd ?? 0;
  const availableStrikes = useMemo(() => chain?.strikes.map((s) => s.strike) ?? [], [chain]);

  const handleLegStrikeDrag = useCallback((legId: string, newStrike: number) => {
    if (!chain) return;
    const leg = legs.find((l) => l.id === legId);
    if (!leg) return;
    const s = chain.strikes.find((x) => x.strike === newStrike);
    const side = leg.type === "call" ? s?.call : s?.put;
    let bestPrice: number | null = null;
    let bestVenueId = leg.venue;
    let bestQ: { delta: number | null; gamma: number | null; theta: number | null; vega: number | null; markIv: number | null } | null = null;
    if (side) {
      for (const [vid, vq] of Object.entries(side.venues)) {
        if (!vq || !activeVenues.includes(vid)) continue;
        const p = leg.direction === "buy" ? vq.ask : vq.bid;
        if (p == null || p <= 0) continue;
        if (bestPrice == null || (leg.direction === "buy" && p < bestPrice) || (leg.direction === "sell" && p > bestPrice)) {
          bestPrice = p; bestVenueId = vid; bestQ = vq;
        }
      }
    }
    if (bestPrice == null) return;
    updateLeg(legId, {
      strike: newStrike, entryPrice: bestPrice, venue: bestVenueId,
      delta: bestQ?.delta ?? null, gamma: bestQ?.gamma ?? null,
      theta: bestQ?.theta ?? null, vega: bestQ?.vega ?? null, iv: bestQ?.markIv ?? null,
    });
  }, [chain, legs, activeVenues, updateLeg]);

  const payoffPoints = useMemo(() => computePayoff(legs, spotPrice), [legs, spotPrice]);
  const metrics = useMemo(() => legs.length > 0 ? computeMetrics(legs, spotPrice) : null, [legs, spotPrice]);
  const strategyName = useMemo(() => detectStrategy(legs), [legs]);

  // Compute base DTE from first leg's expiry
  const baseDte = useMemo(() => {
    if (legs.length === 0) return 30;
    return dteDays(legs[0]!.expiry);
  }, [legs]);

  // Scenario overlay curves
  const scenarioIvPoints = useMemo(() => {
    if (legs.length === 0 || ivShift === 0) return undefined;
    return computeScenarioPayoff(legs, spotPrice, ivShift / 100, 0, baseDte);
  }, [legs, spotPrice, ivShift, baseDte]);

  const scenarioDtePoints = useMemo(() => {
    if (legs.length === 0 || dteShift === 0) return undefined;
    return computeScenarioPayoff(legs, spotPrice, 0, dteShift, baseDte);
  }, [legs, spotPrice, dteShift, baseDte]);

  const hasScenarios = ivShift !== 0 || dteShift !== 0;

  function handleCopyUrl() {
    const url = buildShareUrl(legs, underlying);
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!chain) return;
    const templateName = e.dataTransfer.getData("text/plain");
    const template = TEMPLATES.find((t) => t.name === templateName);
    if (!template) return;
    const newLegs = template.build(chain, defaultExpiry);
    if (newLegs.length === 0) return;
    clearLegs();
    for (const leg of newLegs) addLeg(leg, underlying);
  }

  return (
    <div className={styles.view}>
      <div className={styles.mainArea}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.title}>Architect</span>
            <AssetPickerButton />
            <VenuePickerButton />
          </div>
        </div>

        {/* Template strip */}
        <StrategyTemplates chain={chain ?? null} expiry={defaultExpiry} underlying={underlying} />

        {/* 3-column layout */}
        <div className={styles.splitBody}>
          {/* ── Left: Legs ───────────────────────────── */}
          <div className={styles.controlsCol}>
            <LegInput />

            {legs.length > 0 && (
              <div className={styles.legsSection}>
                <div className={styles.legsSectionHeader}>
                  <span className={styles.strategyName}>{strategyName}</span>
                  <button className={styles.clearBtn} onClick={clearLegs}>Clear</button>
                </div>

                <div className={styles.legsList}>
                  {legs.map((leg) => (
                    <LegRow
                      key={leg.id}
                      leg={leg}
                      allStrikes={availableStrikes}
                      allExpiries={allExpiries}
                      onRemove={() => removeLeg(leg.id)}
                      onUpdate={updateLeg}
                    />
                  ))}
                </div>
              </div>
            )}

            {legs.length > 0 && (
              <button className={styles.compareBtn} onClick={() => setShowVenues(true)}>
                Compare Venues
              </button>
            )}

            {legs.length === 0 && (
              <div className={styles.emptyLegs}>
                Pick a template, add custom legs, or drag strikes on the chart.
              </div>
            )}
          </div>

          {/* ── Center: Chart ────────────────────────── */}
          <div className={styles.chartCol}>
            <div
              className={`${styles.chartPanel} ${dragOver ? styles.chartPanelDragOver : ""}`}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {legs.length === 0 ? (
                <div className={styles.chartEmpty}>
                  <svg className={styles.ghostChart} viewBox="0 0 200 100" preserveAspectRatio="none">
                    {/* Ghost grid lines */}
                    {[20, 40, 60, 80].map((y) => (
                      <line key={`h${y}`} x1="0" y1={y} x2="200" y2={y} stroke="var(--border-subtle)" strokeWidth="0.5" opacity="0.4" />
                    ))}
                    {[40, 80, 120, 160].map((x) => (
                      <line key={`v${x}`} x1={x} y1="0" x2={x} y2="100" stroke="var(--border-subtle)" strokeWidth="0.5" opacity="0.4" />
                    ))}
                    {/* Zero line */}
                    <line x1="0" y1="50" x2="200" y2="50" stroke="var(--text-dim)" strokeWidth="0.8" strokeDasharray="4 3" opacity="0.3" />
                    {/* Ghost payoff curve */}
                    <path
                      d="M 0 65 L 60 65 L 100 50 L 140 35 L 200 35"
                      fill="none"
                      stroke="var(--accent-primary)"
                      strokeWidth="1.5"
                      opacity="0.12"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {/* Ghost fill */}
                    <path d="M 0 65 L 60 65 L 100 50 L 100 50 L 60 50 L 0 50 Z" fill="var(--color-loss)" opacity="0.03" />
                    <path d="M 100 50 L 140 35 L 200 35 L 200 50 L 100 50 Z" fill="var(--color-profit)" opacity="0.03" />
                  </svg>
                  <div className={styles.chartDropHint}>
                    <span className={styles.chartDropIcon}>{dragOver ? "+" : "↕"}</span>
                    <span className={styles.chartDropText}>
                      {dragOver ? "Drop to apply strategy" : "Drag a strategy here, or select from the templates above"}
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.chartTitle}>P&L at Expiry</div>
                  <PayoffChart
                    points={payoffPoints}
                    breakevens={metrics?.breakevens ?? []}
                    spotPrice={spotPrice}
                    legs={legs}
                    maxProfit={metrics?.maxProfit ?? null}
                    maxLoss={metrics?.maxLoss ?? null}
                    strikes={availableStrikes}
                    onLegStrikeDrag={handleLegStrikeDrag}
                    scenarioIvPoints={scenarioIvPoints}
                    scenarioDtePoints={scenarioDtePoints}
                  />
                  {hasScenarios && (
                    <div className={styles.scenarioLegend}>
                      <span className={styles.legendItem}>
                        <span className={`${styles.legendDot} ${styles.legendDotBase}`} />
                        <span className={styles.legendLabel}>At expiry</span>
                      </span>
                      {ivShift !== 0 && (
                        <span className={styles.legendItem}>
                          <span className={`${styles.legendDot} ${styles.legendDotIv}`} />
                          <span className={styles.legendLabel}>IV {ivShift > 0 ? "+" : ""}{ivShift}%</span>
                        </span>
                      )}
                      {dteShift !== 0 && (
                        <span className={styles.legendItem}>
                          <span className={`${styles.legendDot} ${styles.legendDotDte}`} />
                          <span className={styles.legendLabel}>{dteShift > 0 ? "+" : ""}{dteShift}d DTE</span>
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── Right: Metrics + Scenarios + Share ──── */}
          <div className={styles.rightCol}>
            {/* Metrics */}
            <div className={styles.rightSection}>
              <span className={styles.rightSectionTitle}>Metrics</span>
              <div className={styles.metricsGrid}>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>Net</span>
                  <span className={styles.metricCardVal} data-positive={metrics ? metrics.netDebit > 0 : undefined} data-negative={metrics ? metrics.netDebit < 0 : undefined}>
                    {metrics ? `${metrics.netDebit > 0 ? "+" : ""}${fmtUsd(metrics.netDebit)}` : "–"}
                  </span>
                </div>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>Max Profit</span>
                  <span className={styles.metricCardVal} data-positive={metrics ? "true" : undefined}>
                    {metrics ? (metrics.maxProfit != null ? fmtUsd(metrics.maxProfit) : "∞") : "–"}
                  </span>
                </div>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>Max Loss</span>
                  <span className={styles.metricCardVal} data-negative={metrics ? "true" : undefined}>
                    {metrics ? (metrics.maxLoss != null ? fmtUsd(metrics.maxLoss) : "∞") : "–"}
                  </span>
                </div>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>Breakeven</span>
                  <span className={styles.metricCardVal}>
                    {metrics && metrics.breakevens.length > 0
                      ? metrics.breakevens.map((b) => `$${(b / 1000).toFixed(1)}k`).join(", ")
                      : "–"}
                  </span>
                </div>
              </div>
            </div>

            {/* Greeks */}
            <div className={styles.rightSection}>
              <span className={styles.rightSectionTitle}>Greeks</span>
              <div className={styles.greeksGrid}>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>Δ</span>
                  <span className={styles.greekCardVal}>{metrics?.netDelta?.toFixed(3) ?? "–"}</span>
                </div>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>Γ</span>
                  <span className={styles.greekCardVal}>{metrics?.netGamma?.toFixed(5) ?? "–"}</span>
                </div>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>Θ</span>
                  <span className={styles.greekCardVal}>{metrics?.netTheta != null ? fmtUsd(metrics.netTheta) : "–"}</span>
                </div>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>V</span>
                  <span className={styles.greekCardVal}>{metrics?.netVega != null ? fmtUsd(metrics.netVega) : "–"}</span>
                </div>
              </div>
            </div>

            {/* Scenario sliders */}
            <div className={styles.rightSection}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span className={styles.rightSectionTitle}>Scenarios</span>
                {hasScenarios && (
                  <button className={styles.sliderReset} onClick={() => { setIvShift(0); setDteShift(0); }}>Reset</button>
                )}
              </div>

              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>IV</span>
                <div className={styles.sliderWrap}>
                  <input
                    type="range"
                    className={styles.sliderInput}
                    data-kind="iv"
                    min={-30}
                    max={30}
                    step={1}
                    value={ivShift}
                    onChange={(e) => setIvShift(Number(e.target.value))}
                    disabled={legs.length === 0}
                  />
                </div>
                <span className={styles.sliderValue}>{ivShift > 0 ? "+" : ""}{ivShift}%</span>
              </div>

              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>DTE</span>
                <div className={styles.sliderWrap}>
                  <input
                    type="range"
                    className={styles.sliderInput}
                    data-kind="dte"
                    min={-Math.min(baseDte, 60)}
                    max={60}
                    step={1}
                    value={dteShift}
                    onChange={(e) => setDteShift(Number(e.target.value))}
                    disabled={legs.length === 0}
                  />
                </div>
                <span className={styles.sliderValue}>{dteShift > 0 ? "+" : ""}{dteShift}d</span>
              </div>
            </div>

            {/* Share */}
            <div className={styles.rightSection}>
              <span className={styles.rightSectionTitle}>Share</span>
              <div className={styles.shareBar}>
                <span className={styles.shareUrl}>
                  {legs.length > 0 ? buildShareUrl(legs, underlying) : "Build a strategy to share"}
                </span>
                {legs.length > 0 && (
                  copied ? (
                    <span className={styles.shareCopied}>Copied</span>
                  ) : (
                    <button className={styles.shareBtn} onClick={handleCopyUrl}>Copy</button>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showVenues && (
        <>
          <div className={styles.backdrop} onClick={() => setShowVenues(false)} />
          <VenueSlideover
            legs={legs}
            chain={chain ?? null}
            activeVenues={activeVenues}
            onClose={() => setShowVenues(false)}
          />
        </>
      )}
    </div>
  );
}
