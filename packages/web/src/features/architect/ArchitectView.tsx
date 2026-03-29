import { useMemo, useState, useCallback, useEffect } from 'react';

import { useAppStore } from '@stores/app-store';
import { AssetPickerButton, VenuePickerButton } from '@components/ui';
import { useChainQuery, useExpiries } from '@features/chain/queries';
import { fmtUsd, formatExpiry, dteDays } from '@lib/format';
import { useStrategyStore } from './strategy-store';
import {
  computePayoff,
  computeMetrics,
  computeScenarioPayoff,
  detectStrategy,
  type Leg,
} from './payoff';
import { repriceLeg } from './reprice';
import { buildShareUrl, decodeStrategy } from './share';
import PayoffChart from './PayoffChart';
import VenueSlideover from './VenueSlideover';
import StrategyTemplates, {
  buildTemplateVariant,
  clearActiveTemplateDrag,
  findTemplateVariant,
} from './StrategyTemplates';
import LegInput from './LegInput';
import styles from './Architect.module.css';

// ── Inline-editable leg row ──────────────────────────────────────────────────

interface LegRowProps {
  leg: Leg;
  allStrikes: number[];
  onRemove: () => void;
  onUpdate: (id: string, patch: Partial<Leg>) => void;
}

function resolveBuilderExpiry(preferredExpiry: string, expiries: string[]): string {
  if (preferredExpiry && expiries.includes(preferredExpiry)) return preferredExpiry;

  const viableExpiry = expiries.find((entry) => dteDays(entry) >= 3);
  return viableExpiry ?? expiries[1] ?? expiries[0] ?? '';
}

function LegRow({ leg, allStrikes, onRemove, onUpdate }: LegRowProps) {
  const [editing, setEditing] = useState(false);

  function stepStrike(delta: number) {
    const sorted = [...allStrikes].sort((a, b) => a - b);
    const idx = sorted.indexOf(leg.strike);
    if (idx < 0) return;
    const next = sorted[idx + delta];
    if (next != null) onUpdate(leg.id, { strike: next });
  }

  function toggleDirection() {
    onUpdate(leg.id, { direction: leg.direction === 'buy' ? 'sell' : 'buy' });
  }

  function toggleType() {
    onUpdate(leg.id, { type: leg.type === 'call' ? 'put' : 'call' });
  }

  if (editing) {
    return (
      <div className={styles.legRowEditing}>
        <div className={styles.legEditRow}>
          <span className={styles.legEditLabel}>Strike</span>
          <button className={styles.legStepBtn} onClick={() => stepStrike(-1)}>
            −
          </button>
          <span className={styles.legStepVal}>{leg.strike.toLocaleString()}</span>
          <button className={styles.legStepBtn} onClick={() => stepStrike(1)}>
            +
          </button>
        </div>
        <div className={styles.legEditRow}>
          <span className={styles.legEditLabel}>Expiry</span>
          <span className={styles.legStepVal}>{formatExpiry(leg.expiry)}</span>
        </div>
        <div className={styles.legEditRow}>
          <span className={styles.legEditLabel}>Side</span>
          <button
            className={styles.legStepBtn}
            onClick={toggleDirection}
            style={{ width: 'auto', padding: '0 6px' }}
          >
            {leg.direction === 'buy' ? 'BUY' : 'SELL'}
          </button>
          <button
            className={styles.legStepBtn}
            onClick={toggleType}
            style={{ width: 'auto', padding: '0 6px' }}
          >
            {leg.type === 'call' ? 'CALL' : 'PUT'}
          </button>
          <div className={styles.legEditActions}>
            <button className={styles.legEditSave} onClick={() => setEditing(false)}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.legRow} data-direction={leg.direction}>
      <span className={styles.legDirection} data-direction={leg.direction}>
        {leg.direction === 'buy' ? 'BUY' : 'SELL'}
      </span>
      <span className={styles.legQty}>{leg.quantity}×</span>
      <span className={styles.legStrike}>{leg.strike.toLocaleString()}</span>
      <span className={styles.legType} data-type={leg.type}>
        {leg.type === 'call' ? 'C' : 'P'}
      </span>
      <span className={styles.legExpiry}>{formatExpiry(leg.expiry)}</span>
      <span className={styles.legPrice}>{fmtUsd(leg.entryPrice)}</span>
      <button className={styles.legEditBtn} onClick={() => setEditing(true)} title="Edit leg">
        ✎
      </button>
      <button className={styles.legRemove} onClick={onRemove} title="Remove leg">
        ×
      </button>
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export default function ArchitectView() {
  const underlying = useAppStore((s) => s.underlying);
  const globalExpiry = useAppStore((s) => s.expiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const { data: expiriesData } = useExpiries(underlying);
  const allExpiries = expiriesData?.expiries ?? [];
  const [builderExpiry, setBuilderExpiry] = useState('');

  useEffect(() => {
    const nextExpiry = resolveBuilderExpiry(builderExpiry || globalExpiry, allExpiries);
    if (nextExpiry && nextExpiry !== builderExpiry) {
      setBuilderExpiry(nextExpiry);
    }
  }, [allExpiries, builderExpiry, globalExpiry, underlying]);

  const { data: chain } = useChainQuery(underlying, builderExpiry, activeVenues, {
    refetchInterval: 10_000,
  });

  const legs = useStrategyStore((s) => s.legs);
  const clearLegs = useStrategyStore((s) => s.clearLegs);
  const removeLeg = useStrategyStore((s) => s.removeLeg);
  const updateLeg = useStrategyStore((s) => s.updateLeg);
  const replaceLegs = useStrategyStore((s) => s.replaceLegs);
  const addLeg = useStrategyStore((s) => s.addLeg);
  const strategyUnderlying = useStrategyStore((s) => s.underlying);

  useEffect(() => {
    if (strategyUnderlying && strategyUnderlying !== underlying && legs.length > 0) {
      clearLegs();
    }
  }, [clearLegs, legs.length, strategyUnderlying, underlying]);

  const [showVenues, setShowVenues] = useState(false);
  const [ivShift, setIvShift] = useState(0);
  const [dteShift, setDteShift] = useState(0);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);

  useEffect(() => {
    setBuilderError(null);
  }, [activeVenues, builderExpiry, underlying]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('strategy');
    if (!encoded) return;

    const decoded = decodeStrategy(encoded);
    if (!decoded) return;

    clearLegs();
    for (const leg of decoded.legs) addLeg(leg, decoded.underlying);
    setBuilderExpiry(decoded.legs[0]?.expiry ?? '');

    params.delete('strategy');
    const clean = params.toString();
    window.history.replaceState({}, '', clean ? `?${clean}` : window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const spotPrice = chain?.stats.spotIndexUsd ?? chain?.stats.indexPriceUsd ?? 0;
  const availableStrikes = useMemo(() => chain?.strikes.map((s) => s.strike) ?? [], [chain]);

  const repriceStrategyLeg = useCallback(
    (leg: Leg, patch: Partial<Leg> = {}, exactStrike = false) => {
      if (!chain || !builderExpiry) return null;

      return repriceLeg(
        chain,
        activeVenues,
        {
          type: patch.type ?? leg.type,
          direction: patch.direction ?? leg.direction,
          strike: patch.strike ?? leg.strike,
          expiry: builderExpiry,
          quantity: patch.quantity ?? leg.quantity,
        },
        { exactStrike },
      );
    },
    [activeVenues, builderExpiry, chain],
  );

  const handleLegUpdate = useCallback(
    (legId: string, patch: Partial<Leg>) => {
      const leg = legs.find((entry) => entry.id === legId);
      if (!leg) return;

      const repriced = repriceStrategyLeg(leg, patch, patch.strike != null);
      if (!repriced) return;

      updateLeg(legId, repriced);
    },
    [legs, repriceStrategyLeg, updateLeg],
  );

  const handleLegStrikeDrag = useCallback(
    (legId: string, newStrike: number) => {
      handleLegUpdate(legId, { strike: newStrike });
    },
    [handleLegUpdate],
  );

  useEffect(() => {
    if (!chain || legs.length === 0) return;

    const nextLegs = legs.map((leg) => {
      const repriced = repriceStrategyLeg(leg);
      return repriced ? { ...leg, ...repriced } : leg;
    });

    const changed = nextLegs.some((leg, index) => {
      const prev = legs[index];
      return (
        prev != null &&
        (leg.expiry !== prev.expiry ||
          leg.strike !== prev.strike ||
          leg.entryPrice !== prev.entryPrice ||
          leg.venue !== prev.venue ||
          leg.delta !== prev.delta ||
          leg.gamma !== prev.gamma ||
          leg.theta !== prev.theta ||
          leg.vega !== prev.vega ||
          leg.iv !== prev.iv)
      );
    });

    if (changed) replaceLegs(nextLegs, underlying);
  }, [chain, legs, replaceLegs, repriceStrategyLeg, underlying]);

  const payoffPoints = useMemo(() => computePayoff(legs, spotPrice), [legs, spotPrice]);
  const metrics = useMemo(
    () => (legs.length > 0 ? computeMetrics(legs, spotPrice) : null),
    [legs, spotPrice],
  );
  const strategyName = useMemo(() => detectStrategy(legs), [legs]);

  const baseDte = useMemo(() => {
    if (legs.length === 0) return 30;
    return dteDays(legs[0]!.expiry);
  }, [legs]);

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

    const dragged = findTemplateVariant(
      e.dataTransfer.getData('application/x-oggregator-strategy') ||
        e.dataTransfer.getData('text/plain'),
    );
    clearActiveTemplateDrag();
    if (!dragged) return;

    const result = buildTemplateVariant(
      chain ?? null,
      builderExpiry,
      dragged.template,
      dragged.variant,
    );
    if (!result.ok) {
      setBuilderError(result.error.message);
      return;
    }

    setBuilderError(null);
    clearLegs();
    for (const leg of result.legs) addLeg(leg, underlying);
  }

  return (
    <div className={styles.view}>
      <div className={styles.mainArea}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.title}>Builder</span>
            <AssetPickerButton />
            <VenuePickerButton />
          </div>
        </div>

        <StrategyTemplates
          chain={chain ?? null}
          expiry={builderExpiry}
          underlying={underlying}
          errorMessage={builderError}
          onErrorMessageChange={setBuilderError}
        />

        <div className={styles.splitBody}>
          <div className={styles.controlsCol}>
            <LegInput expiry={builderExpiry} onExpiryChange={setBuilderExpiry} />

            {legs.length > 0 && (
              <div className={styles.legsSection}>
                <div className={styles.legsSectionHeader}>
                  <span className={styles.strategyName}>{strategyName}</span>
                  <button className={styles.clearBtn} onClick={clearLegs}>
                    Clear
                  </button>
                </div>

                <div className={styles.legsList}>
                  {legs.map((leg) => (
                    <LegRow
                      key={leg.id}
                      leg={leg}
                      allStrikes={availableStrikes}
                      onRemove={() => removeLeg(leg.id)}
                      onUpdate={handleLegUpdate}
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

          <div className={styles.chartCol}>
            <div
              className={`${styles.chartPanel} ${dragOver ? styles.chartPanelDragOver : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {legs.length === 0 ? (
                <div className={styles.chartEmpty}>
                  <svg
                    className={styles.ghostChart}
                    viewBox="0 0 200 100"
                    preserveAspectRatio="none"
                  >
                    {[20, 40, 60, 80].map((y) => (
                      <line
                        key={`h${y}`}
                        x1="0"
                        y1={y}
                        x2="200"
                        y2={y}
                        stroke="var(--border-subtle)"
                        strokeWidth="0.5"
                        opacity="0.4"
                      />
                    ))}
                    {[40, 80, 120, 160].map((x) => (
                      <line
                        key={`v${x}`}
                        x1={x}
                        y1="0"
                        x2={x}
                        y2="100"
                        stroke="var(--border-subtle)"
                        strokeWidth="0.5"
                        opacity="0.4"
                      />
                    ))}
                    <line
                      x1="0"
                      y1="50"
                      x2="200"
                      y2="50"
                      stroke="var(--text-dim)"
                      strokeWidth="0.8"
                      strokeDasharray="4 3"
                      opacity="0.3"
                    />
                    <path
                      d="M 0 65 L 60 65 L 100 50 L 140 35 L 200 35"
                      fill="none"
                      stroke="var(--accent-primary)"
                      strokeWidth="1.5"
                      opacity="0.12"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M 0 65 L 60 65 L 100 50 L 100 50 L 60 50 L 0 50 Z"
                      fill="var(--color-loss)"
                      opacity="0.03"
                    />
                    <path
                      d="M 100 50 L 140 35 L 200 35 L 200 50 L 100 50 Z"
                      fill="var(--color-profit)"
                      opacity="0.03"
                    />
                  </svg>
                  <div className={styles.chartDropHint}>
                    <span className={styles.chartDropIcon}>{dragOver ? '+' : '↕'}</span>
                    <span className={styles.chartDropText}>
                      {dragOver
                        ? 'Drop to apply strategy'
                        : 'Drag a strategy here, or select from the templates above'}
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
                          <span className={styles.legendLabel}>
                            IV {ivShift > 0 ? '+' : ''}
                            {ivShift}%
                          </span>
                        </span>
                      )}
                      {dteShift !== 0 && (
                        <span className={styles.legendItem}>
                          <span className={`${styles.legendDot} ${styles.legendDotDte}`} />
                          <span className={styles.legendLabel}>
                            {dteShift > 0 ? '+' : ''}
                            {dteShift}d DTE
                          </span>
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className={styles.rightCol}>
            <div className={styles.rightSection}>
              <span className={styles.rightSectionTitle}>Metrics</span>
              <div className={styles.metricsGrid}>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>Net</span>
                  <span
                    className={styles.metricCardVal}
                    data-positive={metrics ? metrics.netDebit > 0 : undefined}
                    data-negative={metrics ? metrics.netDebit < 0 : undefined}
                  >
                    {metrics
                      ? `${metrics.netDebit > 0 ? '+' : ''}${fmtUsd(metrics.netDebit)}`
                      : '–'}
                  </span>
                </div>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>Max Profit</span>
                  <span
                    className={styles.metricCardVal}
                    data-positive={metrics ? 'true' : undefined}
                  >
                    {metrics ? (metrics.maxProfit != null ? fmtUsd(metrics.maxProfit) : '∞') : '–'}
                  </span>
                </div>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>Max Loss</span>
                  <span
                    className={styles.metricCardVal}
                    data-negative={metrics ? 'true' : undefined}
                  >
                    {metrics ? (metrics.maxLoss != null ? fmtUsd(metrics.maxLoss) : '∞') : '–'}
                  </span>
                </div>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>Breakeven</span>
                  <span className={styles.metricCardVal}>
                    {metrics && metrics.breakevens.length > 0
                      ? metrics.breakevens.map((b) => `$${(b / 1000).toFixed(1)}k`).join(', ')
                      : '–'}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.rightSection}>
              <span className={styles.rightSectionTitle}>Greeks</span>
              <div className={styles.greeksGrid}>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>Δ</span>
                  <span className={styles.greekCardVal}>
                    {metrics?.netDelta?.toFixed(3) ?? '–'}
                  </span>
                </div>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>Γ</span>
                  <span className={styles.greekCardVal}>
                    {metrics?.netGamma?.toFixed(5) ?? '–'}
                  </span>
                </div>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>Θ</span>
                  <span className={styles.greekCardVal}>
                    {metrics?.netTheta != null ? fmtUsd(metrics.netTheta) : '–'}
                  </span>
                </div>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>V</span>
                  <span className={styles.greekCardVal}>
                    {metrics?.netVega != null ? fmtUsd(metrics.netVega) : '–'}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.rightSection}>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <span className={styles.rightSectionTitle}>Scenarios</span>
                {hasScenarios && (
                  <button
                    className={styles.sliderReset}
                    onClick={() => {
                      setIvShift(0);
                      setDteShift(0);
                    }}
                  >
                    Reset
                  </button>
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
                <span className={styles.sliderValue}>
                  {ivShift > 0 ? '+' : ''}
                  {ivShift}%
                </span>
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
                <span className={styles.sliderValue}>
                  {dteShift > 0 ? '+' : ''}
                  {dteShift}d
                </span>
              </div>
            </div>

            <div className={styles.rightSection}>
              <span className={styles.rightSectionTitle}>Share</span>
              <div className={styles.shareBar}>
                <span className={styles.shareUrl}>
                  {legs.length > 0 ? buildShareUrl(legs, underlying) : 'Build a strategy to share'}
                </span>
                {legs.length > 0 &&
                  (copied ? (
                    <span className={styles.shareCopied}>Copied</span>
                  ) : (
                    <button className={styles.shareBtn} onClick={handleCopyUrl}>
                      Copy
                    </button>
                  ))}
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
