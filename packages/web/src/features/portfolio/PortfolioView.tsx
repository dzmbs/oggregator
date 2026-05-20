import { useEffect, useMemo, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { PRIVATE_ADAPTER_SPECS, VENUE_IDS, type PortfolioPnlCurve as PortfolioPnlCurveData, type VenueId } from '@oggregator/protocol';

import { useAppStore } from '@stores/app-store';
import { VENUES } from '@lib/venue-meta';

import { connectVenue, venueStatus, type PortfolioSource } from './api';
import ExpiryBuckets from './ExpiryBuckets';
import PortfolioPnlCurve from './PortfolioPnlCurve';
import PortfolioVegaCurve from './PortfolioVegaCurve';
import PositionForm from './PositionForm';
import PositionsTable from './PositionsTable';
import ShockHeatmap from './ShockHeatmap';
import StrategyGroupsPanel from './StrategyGroups';
import { usePortfolioMetrics, usePortfolioPositions } from './hooks/queries';
import { usePortfolioWs } from './hooks/usePortfolioWs';
import styles from './PortfolioView.module.css';

const FORWARD_OPTIONS: number[] = [0, 1, 3, 7];
const UNDERLYING_OPTIONS = ['all', 'BTC', 'ETH'] as const;
type UnderlyingOption = (typeof UNDERLYING_OPTIONS)[number];
const SOURCE_STORAGE_KEY = 'portfolioSource';
const FORWARD_STORAGE_KEY = 'portfolioForwardDays';
const UNDERLYING_STORAGE_KEY = 'portfolioUnderlying';
const DEFAULT_SOURCE: PortfolioSource = 'manual';
const EMPTY_PNL_CURVE: PortfolioPnlCurveData = {
  status: 'empty',
  underlying: null,
  currentSpotUsd: null,
  breakEvenPricesUsd: [],
  maxProfitUsd: null,
  maxLossUsd: null,
  upsideBounded: false,
  downsideBounded: false,
  points: [],
};

function loadStoredSource(): PortfolioSource {
  try {
    const raw = localStorage.getItem(SOURCE_STORAGE_KEY);
    if (
      raw === 'manual' ||
      raw === 'paper' ||
      raw === 'deribit' ||
      raw === 'okx' ||
      raw === 'binance' ||
      raw === 'bybit' ||
      raw === 'derive' ||
      raw === 'coincall' ||
      raw === 'thalex'
    ) {
      return raw;
    }
  } catch {}
  return DEFAULT_SOURCE;
}

function loadStoredForwardDays(): number {
  try {
    const raw = Number(localStorage.getItem(FORWARD_STORAGE_KEY));
    if (FORWARD_OPTIONS.includes(raw)) return raw;
  } catch {}
  return 0;
}

function loadStoredUnderlying(): UnderlyingOption {
  try {
    const raw = localStorage.getItem(UNDERLYING_STORAGE_KEY);
    if (raw != null && (UNDERLYING_OPTIONS as readonly string[]).includes(raw)) {
      return raw as UnderlyingOption;
    }
  } catch {}
  return 'all';
}

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

// Tiered precision so sub-$1 underlyings (e.g. $LIT, $WFLI) don't collapse small dollar greeks to "$0.00".
function fmtUsdSigned(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  const abs = Math.abs(value);
  if (abs >= 100) return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(4)}`;
  if (abs === 0) return '+$0.00';
  return `${sign}$${abs.toFixed(6)}`;
}

function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}`;
}

export default function PortfolioView() {
  const underlying = useAppStore((s) => s.underlying);
  const venueCreds = useAppStore((s) => s.venueCreds);
  const qc = useQueryClient();
  const [forwardDays, setForwardDays] = useState(loadStoredForwardDays);
  const [source, setSource] = useState<PortfolioSource>(loadStoredSource);
  const [underlyingFilter, setUnderlyingFilter] = useState<UnderlyingOption>(loadStoredUnderlying);
  const underlyingParam = underlyingFilter === 'all' ? undefined : underlyingFilter;
  const { connectionState, lastSeq, lastError } = usePortfolioWs(source, underlyingParam);
  const wsLive = connectionState === 'open' && lastSeq > 0;
  const positionsOpts = underlyingParam == null ? { wsLive } : { wsLive, underlying: underlyingParam };
  const metricsOpts = underlyingParam == null ? { wsLive } : { wsLive, underlying: underlyingParam };
  const { data: positionsData } = usePortfolioPositions(source, positionsOpts);
  const { data: metricsData } = usePortfolioMetrics(forwardDays, source, metricsOpts);
  const [venueConnectError, setVenueConnectError] = useState<string | null>(null);

  const sourceOptions = useMemo(() => [...BASE_SOURCES, ...venueSourceOptions()], []);
  const activeNote = sourceOptions.find((o) => o.value === source)?.note ?? '';

  const positions = positionsData?.positions ?? metricsData?.positions ?? [];
  const metrics = metricsData?.metrics ?? null;
  const isReadOnly = source !== 'manual';
  const sourceLabel =
    source === 'manual'
      ? 'Manual'
      : source === 'paper'
        ? 'paper'
        : (VENUES[source as VenueId]?.label ?? source);
  const emptyMessage = isReadOnly
    ? `No open ${sourceLabel} positions yet. They will appear here as the feed reports them.`
    : undefined;

  const onSelectSource = (nextSource: PortfolioSource) => {
    setSource(nextSource);
    try {
      localStorage.setItem(SOURCE_STORAGE_KEY, nextSource);
    } catch {}
  };

  const onSelectForwardDays = (days: number) => {
    setForwardDays(days);
    try {
      localStorage.setItem(FORWARD_STORAGE_KEY, String(days));
    } catch {}
  };

  const onSelectUnderlying = (next: UnderlyingOption) => {
    setUnderlyingFilter(next);
    try {
      localStorage.setItem(UNDERLYING_STORAGE_KEY, next);
    } catch {}
  };

  useEffect(() => {
    let cancelled = false;

    const reconnectSelectedVenue = async () => {
      try {
        if (source !== 'derive' && source !== 'thalex') {
          setVenueConnectError(null);
          return;
        }

        const creds = venueCreds[source];
        if (creds == null) {
          setVenueConnectError(null);
          return;
        }

        const status = await venueStatus(source);
        if (cancelled || status.connected) {
          setVenueConnectError(null);
          return;
        }

        if (source === 'derive') {
          const walletAddress = creds.fields.walletAddress;
          const signerPrivateKey = creds.fields.privateKeyPem;
          const subaccountId = Number(creds.fields.subaccountId);
          if (!walletAddress || !signerPrivateKey || !Number.isFinite(subaccountId) || subaccountId <= 0) {
            return;
          }
          await connectVenue('derive', {
            walletAddress,
            signerPrivateKey,
            subaccountId,
          });
        } else {
          const kid = creds.fields.kid;
          const privateKeyPem = creds.fields.privateKeyPem;
          const account = creds.fields.account?.trim();
          if (!kid || !privateKeyPem) return;
          await connectVenue('thalex', {
            kid,
            privateKeyPem,
            ...(account ? { account } : {}),
          });
        }

        if (!cancelled) {
          setVenueConnectError(null);
          await qc.invalidateQueries({ queryKey: ['portfolio'] });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('portfolio venue reconnect failed', err);
        if (!cancelled) setVenueConnectError(message);
      }
    };

    void reconnectSelectedVenue();

    return () => {
      cancelled = true;
    };
  }, [qc, source, venueCreds]);

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
                onClick={() => onSelectSource(opt.value)}
              >
                {opt.label}
                {!opt.ready && <span className={styles.todoTag}>TODO</span>}
              </button>
            ))}
          </div>
          <span
            className={styles.status}
            data-state={connectionState}
            title={lastError != null ? `${lastError.code}: ${lastError.message}` : undefined}
          >
            {connectionState} · seq {lastSeq}
            {lastError != null && ` · ${lastError.code}`}
          </span>
          <div className={styles.toggleGroup} role="radiogroup" aria-label="Underlying">
            {UNDERLYING_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                className={styles.toggle}
                data-active={underlyingFilter === opt || undefined}
                onClick={() => onSelectUnderlying(opt)}
              >
                {opt === 'all' ? 'All' : opt}
              </button>
            ))}
          </div>
          <div className={styles.toggleGroup} role="radiogroup" aria-label="Forward days">
            {FORWARD_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                className={styles.toggle}
                data-active={forwardDays === days || undefined}
                onClick={() => onSelectForwardDays(days)}
              >
                T+{days}d
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.sourceNote}>{activeNote}</div>
      {venueConnectError != null && (
        <div className={styles.venueError}>
          <strong>{sourceLabel} connect failed:</strong> {venueConnectError}
        </div>
      )}

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
          <PortfolioPnlCurve curve={metrics?.pnlCurve ?? EMPTY_PNL_CURVE} forwardDays={forwardDays} />
          <StrategyGroupsPanel groups={metrics?.strategies ?? []} />
          <PortfolioVegaCurve byStrike={metrics?.byStrike ?? []} breakEven={metrics?.breakEven ?? []} />
          <div className={styles.tableWrap}>
            <PositionsTable
              positions={positions}
              breakEven={metrics?.breakEven ?? []}
              readOnly={isReadOnly}
              {...(emptyMessage != null && { emptyMessage })}
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
          <ExpiryBuckets rows={metrics?.byExpiry ?? []} />
        </div>
      </div>
    </div>
  );
}
