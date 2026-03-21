import type { EnrichedChainResponse } from "@shared/enriched";

import { useAppStore } from "@stores/app-store";
import { AssetPickerButton, Spinner } from "@components/ui";
import { fmtUsdCompact, fmtNum, formatExpiry } from "@lib/format";
import { VENUES } from "@lib/venue-meta";
import { DvolChart } from "@features/dvol";
import { useAllExpiriesChain } from "./queries";
import styles from "./AnalyticsView.module.css";

// ── Data aggregation helpers ────────────────────────────────────

interface VenueVolume {
  venue: string;
  volume: number;
  oi:     number;
}

interface StrikeOi {
  strike: number;
  callOi: number;
  putOi:  number;
}

interface ExpiryPcr {
  expiry:  string;
  dte:     number;
  callOi:  number;
  putOi:   number;
  ratio:   number;
}

function aggregateVenueVolume(chains: EnrichedChainResponse[]): VenueVolume[] {
  const map = new Map<string, { volume: number; oi: number }>();

  for (const chain of chains) {
    for (const strike of chain.strikes) {
      for (const side of [strike.call, strike.put]) {
        for (const [venue, q] of Object.entries(side.venues)) {
          const prev = map.get(venue) ?? { volume: 0, oi: 0 };
          prev.volume += q?.volume24h ?? 0;
          prev.oi     += q?.openInterest ?? 0;
          map.set(venue, prev);
        }
      }
    }
  }

  return [...map.entries()]
    .map(([venue, d]) => ({ venue, volume: d.volume, oi: d.oi }))
    .sort((a, b) => b.oi - a.oi);
}

function aggregateStrikeOi(chains: EnrichedChainResponse[], spotPrice: number | null): StrikeOi[] {
  const map = new Map<number, { callOi: number; putOi: number }>();

  for (const chain of chains) {
    for (const strike of chain.strikes) {
      const prev = map.get(strike.strike) ?? { callOi: 0, putOi: 0 };
      for (const q of Object.values(strike.call.venues)) {
        prev.callOi += q?.openInterest ?? 0;
      }
      for (const q of Object.values(strike.put.venues)) {
        prev.putOi += q?.openInterest ?? 0;
      }
      map.set(strike.strike, prev);
    }
  }

  // Filter to strikes within 30% of spot for readability
  const band = spotPrice ? spotPrice * 0.3 : Infinity;
  return [...map.entries()]
    .filter(([strike]) => !spotPrice || Math.abs(strike - spotPrice) <= band)
    .filter(([, d]) => d.callOi > 0 || d.putOi > 0)
    .map(([strike, d]) => ({ strike, ...d }))
    .sort((a, b) => a.strike - b.strike);
}

function aggregateExpiryPcr(chains: EnrichedChainResponse[]): ExpiryPcr[] {
  return chains.map((chain) => {
    let callOi = 0;
    let putOi  = 0;
    for (const strike of chain.strikes) {
      for (const q of Object.values(strike.call.venues)) callOi += q?.openInterest ?? 0;
      for (const q of Object.values(strike.put.venues))  putOi  += q?.openInterest ?? 0;
    }
    return {
      expiry:  chain.expiry,
      dte:     chain.dte,
      callOi,
      putOi,
      ratio:   callOi > 0 ? putOi / callOi : 0,
    };
  }).filter((r) => r.callOi > 0 || r.putOi > 0);
}

// ── Sub-components ──────────────────────────────────────────────

function VenueVolumeChart({ data }: { data: VenueVolume[] }) {
  const maxOi = Math.max(...data.map((d) => d.oi), 1);

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>Volume & OI by Venue</div>
      <div className={styles.venueList}>
        {data.map((d) => {
          const meta = VENUES[d.venue];
          const pct  = (d.oi / maxOi) * 100;
          return (
            <div key={d.venue} className={styles.venueRow}>
              <div className={styles.venueLabel}>
                {meta?.logo && <img src={meta.logo} className={styles.venueLogo} alt="" />}
                <span>{meta?.shortLabel ?? d.venue}</span>
              </div>
              <div className={styles.barTrack}>
                <div className={styles.bar} style={{ width: `${pct}%` }} />
              </div>
              <div className={styles.venueStats}>
                <span className={styles.statPrimary}>{fmtUsdCompact(d.oi)} OI</span>
                <span className={styles.statDim}>{fmtNum(d.volume, 0)} vol</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PcrChart({ data }: { data: ExpiryPcr[] }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>Put/Call OI Ratio by Expiry</div>
      <div className={styles.pcrList}>
        {data.map((d) => {
          const totalOi = d.callOi + d.putOi;
          const callPct = totalOi > 0 ? (d.callOi / totalOi) * 100 : 50;
          return (
            <div key={d.expiry} className={styles.pcrRow}>
              <div className={styles.pcrLabel}>
                <span>{formatExpiry(d.expiry)}</span>
                <span className={styles.dteBadge} data-urgent={d.dte <= 1}>{d.dte}d</span>
              </div>
              <div className={styles.pcrBar}>
                <div className={styles.pcrCall} style={{ width: `${callPct}%` }} />
                <div className={styles.pcrPut} style={{ width: `${100 - callPct}%` }} />
              </div>
              <div className={styles.pcrRatio} data-bullish={d.ratio < 0.7} data-bearish={d.ratio > 1.3}>
                {d.ratio.toFixed(2)}
              </div>
            </div>
          );
        })}
        <div className={styles.pcrLegend}>
          <span className={styles.pcrLegendDot} data-type="call" /> Calls
          <span className={styles.pcrLegendDot} data-type="put" /> Puts
          <span className={styles.pcrLegendNote}>&lt;0.7 bullish · &gt;1.3 bearish</span>
        </div>
      </div>
    </div>
  );
}

function OiByStrikeChart({ data, spotPrice }: { data: StrikeOi[]; spotPrice: number | null }) {
  const maxOi = Math.max(...data.map((d) => Math.max(d.callOi, d.putOi)), 1);

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>Open Interest by Strike</div>
      <div className={styles.oiList}>
        {data.map((d) => {
          const isSpot = spotPrice != null && Math.abs(d.strike - spotPrice) / spotPrice < 0.005;
          const callPct = (d.callOi / maxOi) * 100;
          const putPct  = (d.putOi / maxOi) * 100;
          return (
            <div key={d.strike} className={styles.oiRow} data-spot={isSpot || undefined}>
              <div className={styles.oiStrike} data-spot={isSpot || undefined}>
                {d.strike.toLocaleString()}
                {isSpot && <span className={styles.spotTag}>SPOT</span>}
              </div>
              <div className={styles.oiBars}>
                <div className={styles.oiBarLeft}>
                  <div className={styles.oiBarCall} style={{ width: `${callPct}%` }} />
                </div>
                <div className={styles.oiBarRight}>
                  <div className={styles.oiBarPut} style={{ width: `${putPct}%` }} />
                </div>
              </div>
              <div className={styles.oiValues}>
                <span className={styles.oiCall}>{fmtUsdCompact(d.callOi)}</span>
                <span className={styles.oiPut}>{fmtUsdCompact(d.putOi)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles.oiLegend}>
        <span className={styles.pcrLegendDot} data-type="call" /> Call OI
        <span className={styles.pcrLegendDot} data-type="put" /> Put OI
      </div>
    </div>
  );
}

// ── Main view ───────────────────────────────────────────────────

export default function AnalyticsView() {
  const underlying   = useAppStore((s) => s.underlying);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const { data: chains, isLoading } = useAllExpiriesChain(underlying, activeVenues);

  if (isLoading || !chains) {
    return (
      <div className={styles.view}>
        <Spinner size="lg" label="Loading analytics…" />
      </div>
    );
  }

  const spotPrice    = chains[0]?.stats.spotIndexUsd ?? null;
  const venueVolume  = aggregateVenueVolume(chains);
  const strikeOi     = aggregateStrikeOi(chains, spotPrice);
  const expiryPcr    = aggregateExpiryPcr(chains);

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.title}>Analytics</span>
          <AssetPickerButton />
        </div>
        <span className={styles.subtitle}>
          Aggregated across {chains.length} expiries · {activeVenues.length} venues
        </span>
      </div>

      <div className={styles.grid}>
        <VenueVolumeChart data={venueVolume} />
        <PcrChart data={expiryPcr} />
        <div className={styles.dvolWrap}>
          <DvolChart />
        </div>
        <OiByStrikeChart data={strikeOi} spotPrice={spotPrice} />
      </div>
    </div>
  );
}
