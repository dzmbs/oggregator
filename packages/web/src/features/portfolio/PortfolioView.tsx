import { useMemo, useState } from 'react';

import { PRIVATE_ADAPTER_SPECS, VENUE_IDS, type VenueId } from '@oggregator/protocol';

import { useAppStore } from '@stores/app-store';
import { VENUES } from '@lib/venue-meta';

import type { PortfolioSource } from './api';
import PortfolioVegaCurve from './PortfolioVegaCurve';
import PositionForm from './PositionForm';
import PositionsTable from './PositionsTable';
import ShockHeatmap from './ShockHeatmap';
import { usePortfolioMetrics, usePortfolioPositions } from './hooks/queries';
import { usePortfolioWs } from './hooks/usePortfolioWs';
import styles from './PortfolioView.module.css';

const FORWARD_OPTIONS: number[] = [0, 1, 3, 7];

interface SourceOption {
  value: PortfolioSource;
  label: string;
  ready: boolean;
  note: string;
}

const BASE_SOURCES: SourceOption[] = [
  { value: 'manual', label: 'Manual', ready: true, note: 'Hand-entered legs' },
  { value: 'paper', label: 'Paper', ready: true, note: 'Live paper trading book' },
];

function venueSourceOptions(): SourceOption[] {
  return VENUE_IDS.map((venue: VenueId) => {
    const spec = PRIVATE_ADAPTER_SPECS[venue];
    return {
      value: venue,
      label: VENUES[venue]?.label ?? venue,
      ready: spec.status === 'available',
      note:
        spec.status === 'available'
          ? `Live ${VENUES[venue]?.label ?? venue} book via private WS`
          : `Adapter ${spec.status} — keys are stored but not wired yet`,
    };
  });
}

function fmtUsdSigned(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}`;
}

export default function PortfolioView() {
  const underlying = useAppStore((s) => s.underlying);
  const [forwardDays, setForwardDays] = useState(0);
  const [source, setSource] = useState<PortfolioSource>('manual');
  const { connectionState, lastSeq } = usePortfolioWs(source);
  const { data: positionsData } = usePortfolioPositions(source);
  const { data: metricsData } = usePortfolioMetrics(forwardDays, source);

  const sourceOptions = useMemo(() => [...BASE_SOURCES, ...venueSourceOptions()], []);
  const activeNote = sourceOptions.find((o) => o.value === source)?.note ?? '';

  const positions = positionsData?.positions ?? metricsData?.positions ?? [];
  const metrics = metricsData?.metrics ?? null;
  const isReadOnly = source !== 'manual';

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h2 className={styles.title}>Portfolio</h2>
        <div className={styles.statusGroup}>
          <div className={styles.toggleGroup} role="radiogroup" aria-label="Source">
            {sourceOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={styles.toggle}
                data-active={source === opt.value || undefined}
                data-disabled={!opt.ready || undefined}
                disabled={!opt.ready}
                title={opt.note}
                onClick={() => setSource(opt.value)}
              >
                {opt.label}
                {!opt.ready && <span className={styles.todoTag}>TODO</span>}
              </button>
            ))}
          </div>
          <span className={styles.status} data-state={connectionState}>
            {connectionState} · seq {lastSeq}
          </span>
          <div className={styles.toggleGroup} role="radiogroup" aria-label="Forward days">
            {FORWARD_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                className={styles.toggle}
                data-active={forwardDays === days || undefined}
                onClick={() => setForwardDays(days)}
              >
                T+{days}d
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.sourceNote}>{activeNote}</div>

      <div className={styles.totalsRow}>
        <div className={styles.totalCard}>
          <span className={styles.totalLabel}>Net Vega</span>
          <span className={styles.totalValue}>{fmtUsdSigned(metrics?.totals.netVegaUsd)}</span>
        </div>
        <div className={styles.totalCard}>
          <span className={styles.totalLabel}>Net Delta</span>
          <span className={styles.totalValue}>{fmtNum(metrics?.totals.netDeltaUsd)}</span>
        </div>
        <div className={styles.totalCard}>
          <span className={styles.totalLabel}>Net Gamma</span>
          <span className={styles.totalValue}>{fmtNum(metrics?.totals.netGammaUsd, 4)}</span>
        </div>
        <div className={styles.totalCard}>
          <span className={styles.totalLabel}>Theta/day</span>
          <span className={styles.totalValue}>{fmtUsdSigned(metrics?.totals.netThetaUsd)}</span>
        </div>
        <div className={styles.totalCard}>
          <span className={styles.totalLabel}>Net Vanna</span>
          <span className={styles.totalValue}>{fmtNum(metrics?.totals.netVannaUsd, 4)}</span>
        </div>
        <div className={styles.totalCard}>
          <span className={styles.totalLabel}>Net Volga</span>
          <span className={styles.totalValue}>{fmtNum(metrics?.totals.netVolgaUsd, 4)}</span>
        </div>
        <div className={styles.totalCard}>
          <span className={styles.totalLabel}>Unrealized P&amp;L</span>
          <span className={styles.totalValue}>{fmtUsdSigned(metrics?.totals.unrealizedPnlUsd)}</span>
        </div>
      </div>

      <div className={styles.bodyGrid}>
        <div className={styles.mainCol}>
          <PortfolioVegaCurve byStrike={metrics?.byStrike ?? []} />
          <div className={styles.tableWrap}>
            <PositionsTable
              positions={positions}
              breakEven={metrics?.breakEven ?? []}
              readOnly={isReadOnly}
            />
          </div>
        </div>
        <div className={styles.sidebar}>
          {source === 'manual' ? (
            <PositionForm defaultUnderlying={underlying} />
          ) : source === 'paper' ? (
            <div className={styles.readOnlyNote}>
              Showing live paper-trading positions. Add or close legs from the <strong>Paper</strong> tab.
            </div>
          ) : (
            <div className={styles.readOnlyNote}>
              Showing live <strong>{VENUES[source as VenueId]?.label ?? source}</strong> positions
              from your private WS feed. Trade on the venue directly to change the book.
            </div>
          )}
          <ShockHeatmap grid={metrics?.shockGrid ?? []} />
        </div>
      </div>
    </div>
  );
}
