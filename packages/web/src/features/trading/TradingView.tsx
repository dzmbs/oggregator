import { useEffect, useState } from 'react';
import type {
  PaperFillDto,
  PaperTradeDetailDto,
  PaperTradeLegDto,
} from '@oggregator/protocol';
import PayoffChart from '@features/architect/PayoffChart';
import {
  computeMetrics,
  computePayoff,
  computeScenarioPayoff,
  type Leg as StrategyLeg,
} from '@features/architect/payoff';
import { useStrategyStore } from '@features/architect/strategy-store';
import { dteDays, fmtDelta, fmtIv, fmtNum, fmtUsd } from '@lib/format';
import type { TabId } from '@lib/tabs';
import { useAppStore } from '@stores/app-store';
import PaperHelpPopover from './PaperHelpPopover';
import {
  useActivity,
  useAddTradeNote,
  useCloseTrade,
  useInitPaperAccount,
  useOverview,
  usePaperAccount,
  useReduceTrade,
  useTrade,
  useTrades,
} from './hooks/queries';
import { usePaperWs } from './hooks/usePaperWs';
import styles from './TradingView.module.css';

export default function TradingView() {
  const { data: paperAccount } = usePaperAccount();
  const { data: overview } = useOverview();
  const { data: openTradesData } = useTrades('open', 100);
  const { data: closedTradesData } = useTrades('closed', 100);
  const { data: activityData } = useActivity(50);
  const openTrades = openTradesData?.trades ?? [];
  const closedTrades = closedTradesData?.trades ?? [];
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [noteKind, setNoteKind] = useState<'thesis' | 'invalidation' | 'review' | 'note'>('note');
  const [noteContent, setNoteContent] = useState('');
  const [noteTags, setNoteTags] = useState('');
  const [capitalInput, setCapitalInput] = useState('100000');
  const [ivShift, setIvShift] = useState(0);
  const [dteShift, setDteShift] = useState(0);
  const wsState = usePaperWs();
  const { data: selectedTrade } = useTrade(selectedTradeId);
  const addNote = useAddTradeNote();
  const closeTrade = useCloseTrade();
  const initPaperAccount = useInitPaperAccount();
  const reduceTrade = useReduceTrade();
  const replaceLegs = useStrategyStore((state) => state.replaceLegs);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setUnderlying = useAppStore((state) => state.setUnderlying);
  const [showRefreshPrompt, setShowRefreshPrompt] = useState(false);

  useEffect(() => {
    if (wsState === 'error') {
      setShowRefreshPrompt(true);
    }
  }, [wsState]);

  useEffect(() => {
    const candidate = openTrades[0]?.id ?? closedTrades[0]?.id ?? null;
    const exists = [...openTrades, ...closedTrades].some((trade) => trade.id === selectedTradeId);
    if (!selectedTradeId || !exists) {
      setSelectedTradeId(candidate);
    }
  }, [closedTrades, openTrades, selectedTradeId]);

  useEffect(() => {
    setIvShift(0);
    setDteShift(0);
  }, [selectedTradeId]);

  useEffect(() => {
    if (paperAccount) {
      setCapitalInput(String(Math.round(paperAccount.initialCashUsd)));
    }
  }, [paperAccount]);

  const liveTrade = selectedTrade ?? null;
  const scenario = liveTrade ? buildScenario(liveTrade, ivShift, dteShift) : null;
  const selectedCapital = parseCapital(capitalInput);
  const isConfigured = paperAccount?.isInitialized ?? false;

  return (
    <div className={styles.view}>
      {showRefreshPrompt && (
        <div className={styles.refreshBanner}>
          <span>Server restarted. Please refresh to sync.</span>
          <button
            className={styles.primaryButton}
            onClick={() => {
              window.location.reload();
            }}
          >
            Refresh
          </button>
        </div>
      )}
      <div className={styles.header}>
        <HeaderStat label="Equity" value={fmtUsd(overview?.pnl.equityUsd ?? null)} />
        <HeaderStat label="Cash" value={fmtUsd(overview?.pnl.cashUsd ?? null)} />
        <HeaderStat
          label="Realized PnL"
          value={fmtUsd(overview?.pnl.realizedUsd ?? null)}
          tone={tone(overview?.pnl.realizedUsd)}
        />
        <HeaderStat
          label="Unrealized PnL"
          value={fmtUsd(overview?.pnl.unrealizedUsd ?? null)}
          tone={tone(overview?.pnl.unrealizedUsd)}
        />
        <HeaderStat label="Delta" value={fmtDelta(overview?.risk.delta ?? null)} />
        <HeaderStat label="Gamma" value={fmtNum(overview?.risk.gamma ?? null, 4)} />
        <HeaderStat label="Theta" value={fmtUsd(overview?.risk.theta ?? null)} />
        <HeaderStat label="Vega" value={fmtUsd(overview?.risk.vega ?? null)} />
        <HeaderStat label="Sync" value={wsLabel(wsState)} tone={wsState === 'live' ? 'positive' : 'neutral'} />
      </div>

      <div className={styles.workspace}>
        <section className={styles.sidebar}>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>Open trades</span>
              <span>{overview?.openTradeCount ?? openTrades.length}</span>
            </div>
            <div className={styles.tradeList}>
              {openTrades.length === 0 ? (
                <div className={styles.empty}>No open trades. Send a strategy from Builder.</div>
              ) : (
                openTrades.map((trade) => (
                  <button
                    key={trade.id}
                    className={styles.tradeCard}
                    data-selected={trade.id === selectedTradeId ? 'true' : undefined}
                    onClick={() => setSelectedTradeId(trade.id)}
                  >
                    <div className={styles.tradeCardTop}>
                      <div>
                        <div className={styles.tradeLabel}>{trade.label}</div>
                        <div className={styles.tradeMetaLine}>
                          <span>{trade.strategyName}</span>
                          <PremiumFlowBadge netPremiumUsd={trade.netPremiumUsd} />
                          <span>&middot; {trade.openLegs} legs</span>
                        </div>
                      </div>
                      <div className={tone(trade.totalPnlUsd) === 'positive' ? styles.positive : tone(trade.totalPnlUsd) === 'negative' ? styles.negative : ''}>
                        {fmtUsd(trade.totalPnlUsd)}
                      </div>
                    </div>
                    <div className={styles.tradeStatsRow}>
                      <MiniStat label="Premium" value={fmtUsd(trade.netPremiumUsd)} />
                      <MiniStat label="Spot" value={fmtUsd(trade.currentSpotUsd ?? trade.entrySpotUsd)} />
                    </div>
                    <div className={styles.tradeRiskRow}>
                      <RiskPill label="Δ" value={fmtDelta(trade.risk.delta)} />
                      <RiskPill label="Γ" value={fmtNum(trade.risk.gamma, 4)} />
                      <RiskPill label="Θ" value={fmtUsd(trade.risk.theta)} />
                      <RiskPill label="V" value={fmtUsd(trade.risk.vega)} />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>Live feed</span>
              <span>{activityData?.activity.length ?? 0}</span>
            </div>
            <div className={styles.feedList}>
              {(activityData?.activity ?? []).slice(0, 12).map((item) => (
                <div key={item.id} className={styles.feedItem}>
                  <div className={styles.feedSummary}>{item.summary}</div>
                  <div className={styles.feedMeta}>{formatTs(item.ts)}</div>
                </div>
              ))}
            </div>
          </div>

          <PaperHelpPopover />
        </section>

        <section className={styles.main}>
          {!liveTrade ? (
            <div className={styles.section}>
              <div className={styles.empty}>Select a trade to inspect risk, execution, journal, and history.</div>
            </div>
          ) : (
            <>
              <div className={styles.section}>
                <div className={styles.detailHeader}>
                  <div>
                    <div className={styles.detailTitle}>{liveTrade.label}</div>
                    <div className={styles.detailSubtitle}>
                      {liveTrade.strategyName} · opened {formatTs(liveTrade.openedAt)}
                    </div>
                  </div>
                  <div className={styles.actionRow}>
                    <button
                      className={styles.secondaryButton}
                      disabled={reduceTrade.isPending || liveTrade.status !== 'open'}
                      onClick={() => reduceTrade.mutate({ tradeId: liveTrade.id, fraction: 0.5 })}
                    >
                      Reduce 50%
                    </button>
                    <button
                      className={styles.secondaryButton}
                      disabled={liveTrade.status !== 'open'}
                      onClick={() => rollTradeInBuilder(liveTrade, replaceLegs, setUnderlying, setActiveTab)}
                    >
                      Roll in Builder
                    </button>
                    <button
                      className={styles.primaryButton}
                      disabled={closeTrade.isPending || liveTrade.status !== 'open'}
                      onClick={() => closeTrade.mutate(liveTrade.id)}
                    >
                      Close Trade
                    </button>
                  </div>
                </div>

                <div className={styles.metricGrid}>
                  <MetricCard label="Status" value={liveTrade.status.toUpperCase()} />
                  <MetricCard label="Net Premium" value={fmtUsd(liveTrade.netPremiumUsd)} />
                  <MetricCard label="Realized" value={fmtUsd(liveTrade.realizedPnlUsd)} tone={tone(liveTrade.realizedPnlUsd)} />
                  <MetricCard label="Unrealized" value={fmtUsd(liveTrade.unrealizedPnlUsd)} tone={tone(liveTrade.unrealizedPnlUsd)} />
                  <MetricCard label="Total PnL" value={fmtUsd(liveTrade.totalPnlUsd)} tone={tone(liveTrade.totalPnlUsd)} />
                  <MetricCard label="Spot" value={fmtUsd(liveTrade.currentSpotUsd ?? liveTrade.entrySpotUsd)} />
                </div>

                <div className={styles.riskGrid}>
                  <MetricCard label="Delta" value={fmtDelta(liveTrade.risk.delta)} />
                  <MetricCard label="Gamma" value={fmtNum(liveTrade.risk.gamma, 5)} />
                  <MetricCard label="Theta" value={fmtUsd(liveTrade.risk.theta)} />
                  <MetricCard label="Vega" value={fmtUsd(liveTrade.risk.vega)} />
                </div>
              </div>

              <div className={styles.twoColumn}>
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>Position risk</div>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Leg</th>
                        <th className={styles.rightAlign}>Qty</th>
                        <th className={styles.rightAlign}>Avg</th>
                        <th className={styles.rightAlign}>Mark</th>
                        <th className={styles.rightAlign}>DTE</th>
                        <th className={styles.rightAlign}>IV</th>
                        <th className={styles.rightAlign}>Delta</th>
                        <th className={styles.rightAlign}>Theta</th>
                        <th>Source</th>
                        <th className={styles.rightAlign}>P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveTrade.legs.map((leg) => (
                        <tr key={`${leg.expiry}-${leg.strike}-${leg.optionRight}`}>
                          <td>{formatLegSymbol(leg)}</td>
                          <td className={styles.rightAlign}>{fmtNum(leg.netQuantity, 2)}</td>
                          <td className={styles.rightAlign}>{fmtUsd(leg.avgEntryPriceUsd)}</td>
                          <td className={styles.rightAlign}>{fmtUsd(leg.markPriceUsd)}</td>
                          <td className={styles.rightAlign}>{dteDays(leg.expiry)}d</td>
                          <td className={styles.rightAlign}>{fmtIv(leg.markIv)}</td>
                          <td className={styles.rightAlign}>{fmtDelta(leg.delta)}</td>
                          <td className={styles.rightAlign}>{fmtUsd(leg.theta)}</td>
                          <td>{leg.marketSourceLabel}</td>
                          <td className={`${styles.rightAlign} ${toneClass(leg.unrealizedPnlUsd) ? styles[toneClass(leg.unrealizedPnlUsd)!] : ''}`}>
                            {fmtUsd((leg.unrealizedPnlUsd ?? 0) + leg.realizedPnlUsd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className={styles.section}>
                  <div className={styles.sectionHeader}>Scenario payoff</div>
                  {scenario ? (
                    <>
                      <div className={styles.chartWrap}>
                        <PayoffChart
                          points={scenario.points}
                          breakevens={scenario.metrics.breakevens}
                          spotPrice={scenario.spotPrice}
                          legs={scenario.legs}
                          maxProfit={scenario.metrics.maxProfit}
                          maxLoss={scenario.metrics.maxLoss}
                          scenarioIvPoints={scenario.ivPoints}
                          scenarioDtePoints={scenario.dtePoints}
                        />
                      </div>
                      <div className={styles.metricGrid}>
                        <MetricCard label="Max Profit" value={scenario.metrics.maxProfit != null ? fmtUsd(scenario.metrics.maxProfit) : 'Unlimited'} />
                        <MetricCard label="Max Loss" value={scenario.metrics.maxLoss != null ? fmtUsd(scenario.metrics.maxLoss) : 'Unlimited'} />
                        <MetricCard label="Breakeven" value={scenario.metrics.breakevens.length > 0 ? scenario.metrics.breakevens.map((value) => `$${value.toLocaleString('en-US')}`).join(', ') : '–'} />
                        <MetricCard label="Base DTE" value={`${scenario.baseDte}d`} />
                      </div>
                      <div className={styles.sliderBlock}>
                        <label className={styles.sliderRow}>
                          <span>IV shift</span>
                          <input type="range" min={-30} max={30} step={1} value={ivShift} onChange={(event) => setIvShift(Number(event.target.value))} />
                          <span>{ivShift > 0 ? '+' : ''}{ivShift}%</span>
                        </label>
                        <label className={styles.sliderRow}>
                          <span>DTE shift</span>
                          <input type="range" min={-Math.min(scenario.baseDte, 60)} max={60} step={1} value={dteShift} onChange={(event) => setDteShift(Number(event.target.value))} />
                          <span>{dteShift > 0 ? '+' : ''}{dteShift}d</span>
                        </label>
                      </div>
                    </>
                  ) : (
                    <div className={styles.empty}>Payoff is available while the trade still has open exposure.</div>
                  )}
                </div>
              </div>

              <div className={styles.twoColumn}>
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>Execution details</div>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Venue</th>
                        <th>Leg</th>
                        <th className={styles.rightAlign}>Fill</th>
                        <th className={styles.rightAlign}>Mid</th>
                        <th className={styles.rightAlign}>Edge</th>
                        <th className={styles.rightAlign}>Fees</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveTrade.fills.map((fill) => {
                        const edge = executionEdge(fill);
                        return (
                          <tr key={fill.id}>
                            <td>{formatTs(fill.filledAt)}</td>
                            <td>{fill.venue.toUpperCase()}</td>
                            <td>{formatFillSymbol(fill)}</td>
                            <td className={styles.rightAlign}>{fmtUsd(fill.priceUsd)}</td>
                            <td className={styles.rightAlign}>{fmtUsd(fill.benchmarkMidUsd)}</td>
                            <td className={`${styles.rightAlign} ${toneClass(edge) ? styles[toneClass(edge)!] : ''}`}>
                              {fmtUsd(edge)}
                            </td>
                            <td className={styles.rightAlign}>{fmtUsd(fill.feesUsd)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className={styles.section}>
                  <div className={styles.sectionHeader}>Trade journal</div>
                  <div className={styles.noteComposer}>
                    <select value={noteKind} onChange={(event) => setNoteKind(event.target.value as typeof noteKind)}>
                      <option value="note">Note</option>
                      <option value="thesis">Thesis</option>
                      <option value="invalidation">Invalidation</option>
                      <option value="review">Review</option>
                    </select>
                    <input
                      value={noteTags}
                      onChange={(event) => setNoteTags(event.target.value)}
                      placeholder="tags, comma separated"
                    />
                    <textarea
                      value={noteContent}
                      onChange={(event) => setNoteContent(event.target.value)}
                      placeholder="Write the setup, what changed, or what you learned from the trade."
                    />
                    <button
                      className={styles.primaryButton}
                      disabled={addNote.isPending || noteContent.trim().length === 0}
                      onClick={() => {
                        if (!liveTrade || noteContent.trim().length === 0) return;
                        addNote.mutate(
                          {
                            tradeId: liveTrade.id,
                            content: {
                              kind: noteKind,
                              content: noteContent.trim(),
                              tags: noteTags
                                .split(',')
                                .map((tag) => tag.trim())
                                .filter(Boolean),
                            },
                          },
                          {
                            onSuccess: () => {
                              setNoteContent('');
                              setNoteTags('');
                            },
                          },
                        );
                      }}
                    >
                      Add note
                    </button>
                  </div>
                  <div className={styles.noteList}>
                    {liveTrade.notes.map((note) => (
                      <div key={note.id} className={styles.noteCard}>
                        <div className={styles.noteHeader}>
                          <span>{note.kind.toUpperCase()}</span>
                          <span>{formatTs(note.createdAt)}</span>
                        </div>
                        <div className={styles.noteBody}>{note.content}</div>
                        {note.tags.length > 0 && (
                          <div className={styles.tagRow}>
                            {note.tags.map((tag) => (
                              <span key={tag} className={styles.tag}>{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionHeader}>Trade timeline</div>
                <div className={styles.feedList}>
                  {liveTrade.activity.map((item) => (
                    <div key={item.id} className={styles.feedItem}>
                      <div className={styles.feedSummary}>{item.summary}</div>
                      <div className={styles.feedMeta}>{formatTs(item.ts)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>Closed trades</span>
              <span>{overview?.closedTradeCount ?? closedTrades.length}</span>
            </div>
            {closedTrades.length === 0 ? (
              <div className={styles.empty}>No closed trades yet.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Trade</th>
                    <th>Status</th>
                    <th>Opened</th>
                    <th>Closed</th>
                    <th className={styles.rightAlign}>Premium</th>
                    <th className={styles.rightAlign}>Realized</th>
                  </tr>
                </thead>
                <tbody>
                  {closedTrades.map((trade) => (
                    <tr key={trade.id} onClick={() => setSelectedTradeId(trade.id)} className={styles.clickRow}>
                      <td>{trade.label}</td>
                      <td>{trade.status}</td>
                      <td>{formatTs(trade.openedAt)}</td>
                      <td>{formatTs(trade.closedAt)}</td>
                      <td className={styles.rightAlign}>{fmtUsd(trade.netPremiumUsd)}</td>
                      <td className={`${styles.rightAlign} ${toneClass(trade.realizedPnlUsd) ? styles[toneClass(trade.realizedPnlUsd)!] : ''}`}>
                        {fmtUsd(trade.realizedPnlUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <footer className={styles.accountFooter}>
        <span className={styles.accountFooterLabel}>
          {isConfigured
            ? `${paperAccount?.label ?? 'Paper'} · ${fmtUsd(paperAccount?.initialCashUsd ?? null)}`
            : 'Paper account not initialized'}
        </span>
        <span className={styles.accountFooterSep}>·</span>
        <input
          className={styles.accountFooterInput}
          type="number"
          min={1000}
          max={100000}
          step={1000}
          inputMode="numeric"
          value={capitalInput}
          onChange={(event) => setCapitalInput(event.target.value)}
          aria-label="Capital"
        />
        <button
          className={styles.accountFooterButton}
          disabled={initPaperAccount.isPending || selectedCapital == null}
          onClick={() => {
            if (selectedCapital == null) return;
            if (
              isConfigured &&
              !window.confirm(
                `Reset paper account to ${fmtUsd(selectedCapital)}? This clears current paper history.`,
              )
            ) {
              return;
            }
            initPaperAccount.mutate(
              { initialCashUsd: selectedCapital },
              {
                onSuccess: () => {
                  setSelectedTradeId(null);
                  setNoteContent('');
                  setNoteTags('');
                },
              },
            );
          }}
        >
          {isConfigured ? 'Reset' : 'Initialize'}
        </button>
      </footer>
    </div>
  );
}

function HeaderStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div>
      <div className={styles.headerLabel}>{label}</div>
      <div className={`${styles.headerValue} ${toneClassName(tone)}`}>{value}</div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className={styles.metricCard}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={`${styles.metricValue} ${toneClassName(tone)}`}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={styles.miniLabel}>{label}</div>
      <div className={styles.miniValue}>{value}</div>
    </div>
  );
}

function RiskPill({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.riskPill}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function PremiumFlowBadge({ netPremiumUsd }: { netPremiumUsd: number }) {
  const kind = premiumFlowKind(netPremiumUsd);
  if (kind == null) return null;
  return (
    <span className={styles.premiumFlowBadge} data-kind={kind}>
      <span className={styles.premiumFlowLabel}>{kind === 'debit' ? 'Debit' : 'Credit'}</span>
      <span className={styles.premiumFlowValue}>{fmtUsd(Math.abs(netPremiumUsd))}</span>
    </span>
  );
}

function premiumFlowKind(netPremiumUsd: number): 'debit' | 'credit' | null {
  if (netPremiumUsd > 0) return 'debit';
  if (netPremiumUsd < 0) return 'credit';
  return null;
}

function buildScenario(trade: PaperTradeDetailDto, ivShift: number, dteShift: number) {
  const legs = trade.legs
    .filter((leg) => leg.netQuantity !== 0)
    .map((leg, index): StrategyLeg => ({
      id: `${trade.id}-${index}`,
      type: leg.optionRight,
      direction: leg.netQuantity > 0 ? 'buy' : 'sell',
      strike: leg.strike,
      expiry: leg.expiry,
      quantity: Math.abs(leg.netQuantity),
      entryPrice: leg.avgEntryPriceUsd,
      venue: 'paper',
      delta: leg.delta,
      gamma: leg.gamma,
      theta: leg.theta,
      vega: leg.vega,
      iv: leg.markIv,
    }));

  const spotPrice = trade.currentSpotUsd ?? trade.entrySpotUsd ?? 0;
  if (legs.length === 0 || spotPrice <= 0) return null;
  const baseDte = Math.min(...legs.map((leg) => dteDays(leg.expiry)));
  const points = computePayoff(legs, spotPrice, 240);
  const metrics = computeMetrics(legs, spotPrice);
  return {
    legs,
    spotPrice,
    baseDte,
    points,
    metrics,
    ivPoints: computeScenarioPayoff(legs, spotPrice, ivShift / 100, 0, baseDte, 240),
    dtePoints: computeScenarioPayoff(legs, spotPrice, 0, dteShift, baseDte, 240),
  };
}

function executionEdge(fill: PaperFillDto): number | null {
  if (fill.benchmarkMidUsd == null) return null;
  return fill.side === 'buy'
    ? fill.benchmarkMidUsd - fill.priceUsd
    : fill.priceUsd - fill.benchmarkMidUsd;
}

function rollTradeInBuilder(
  trade: PaperTradeDetailDto,
  replaceLegs: (legs: StrategyLeg[], underlying: string) => void,
  setUnderlying: (underlying: string) => void,
  setActiveTab: (tab: TabId) => void,
) {
  const legs = trade.legs
    .filter((leg) => leg.netQuantity !== 0)
    .map((leg, index): StrategyLeg => ({
      id: `roll-${trade.id}-${index}`,
      type: leg.optionRight,
      direction: leg.netQuantity > 0 ? 'buy' : 'sell',
      strike: leg.strike,
      expiry: leg.expiry,
      quantity: Math.abs(leg.netQuantity),
      entryPrice: leg.markPriceUsd ?? leg.avgEntryPriceUsd,
      venue: 'paper',
      delta: leg.delta,
      gamma: leg.gamma,
      theta: leg.theta,
      vega: leg.vega,
      iv: leg.markIv,
    }));
  if (legs.length === 0) return;
  replaceLegs(legs, trade.underlying);
  setUnderlying(trade.underlying);
  setActiveTab('architect');
}

function formatLegSymbol(leg: PaperTradeLegDto): string {
  return `${leg.underlying} ${leg.expiry} ${leg.strike} ${leg.optionRight.toUpperCase()}`;
}

function formatFillSymbol(fill: PaperFillDto): string {
  return `${fill.side === 'buy' ? '+' : '-'}${fmtNum(fill.quantity, 2)} ${fill.underlying} ${fill.strike}${fill.optionRight === 'call' ? 'C' : 'P'}`;
}

function formatTs(value: string | null | undefined): string {
  if (!value) return '–';
  return new Date(value).toLocaleString();
}

function wsLabel(state: 'connecting' | 'live' | 'closed' | 'error'): string {
  switch (state) {
    case 'live':
      return 'Live';
    case 'connecting':
      return 'Reconnecting';
    case 'error':
      return 'Error';
    case 'closed':
      return 'Closed';
  }
}

function tone(value: number | null | undefined): 'positive' | 'negative' | 'neutral' {
  if (value == null || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

function toneClass(value: number | null | undefined): 'positive' | 'negative' | null {
  const currentTone = tone(value);
  if (currentTone === 'neutral') return null;
  return currentTone;
}

function toneClassName(toneValue: 'positive' | 'negative' | 'neutral' | undefined): string {
  if (toneValue === 'positive') return styles.positive ?? '';
  if (toneValue === 'negative') return styles.negative ?? '';
  return '';
}

function parseCapital(value: string): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (amount < 1_000 || amount > 100_000) return null;
  if (amount % 1_000 !== 0) return null;
  return amount;
}
