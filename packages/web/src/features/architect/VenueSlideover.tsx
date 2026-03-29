import { useState } from 'react';

import type { Leg } from './payoff';
import type { EnrichedChainResponse } from '@shared/enriched';
import type { VenueId } from '@oggregator/protocol';
import { VENUES } from '@lib/venue-meta';
import { fmtUsd, formatExpiry } from '@lib/format';
import { computeExecutionCost } from '@features/builder/compute-execution';
import type { VenueExecution } from '@features/builder/types';
import { detectStrategy } from './payoff';
import styles from './VenueSlideover.module.css';

interface VenueSlideoverProps {
  legs: Leg[];
  chain: EnrichedChainResponse | null;
  activeVenues: string[];
  onClose: () => void;
}

interface VenueCost {
  venue: string;
  totalCost: number;
  totalFees: number;
  totalSpread: number;
  available: boolean;
  legDetails: Array<{
    strike: number;
    type: 'call' | 'put';
    direction: 'buy' | 'sell';
    price: number;
    iv: number | null;
    spreadPct: number | null;
  }>;
}

function buildVenueExecution(
  chain: EnrichedChainResponse,
  venueId: string,
  leg: Leg,
): VenueExecution | null {
  const strike = chain.strikes.find((s) => s.strike === leg.strike);
  if (!strike) return null;
  const side = leg.type === 'call' ? strike.call : strike.put;
  const q = side.venues[venueId as VenueId];
  if (!q) return null;
  return {
    venue: venueId,
    available: true,
    bidPrice: q.bid,
    askPrice: q.ask,
    markPrice: q.mid,
    bidSize: q.bidSize,
    askSize: q.askSize,
    iv: q.markIv,
    delta: q.delta,
    contractSize: 1,
    tickSize: 0.01,
    minQty: 0.01,
    makerFee: q.estimatedFees && q.mid ? q.estimatedFees.maker / q.mid : 0.0003,
    takerFee: q.estimatedFees && q.mid ? q.estimatedFees.taker / q.mid : 0.0005,
    settleCurrency: 'USD',
    inverse: false,
    underlyingPrice: chain.stats.spotIndexUsd ?? chain.stats.indexPriceUsd ?? 0,
  };
}

export default function VenueSlideover({
  legs,
  chain,
  activeVenues,
  onClose,
}: VenueSlideoverProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!chain || legs.length === 0) return null;

  const strategyName = detectStrategy(legs);
  const strategyExpiry = legs[0]?.expiry ?? '';

  const venueCosts: VenueCost[] = activeVenues.map((venueId) => {
    let totalCost = 0;
    let totalFees = 0;
    let totalSpread = 0;
    let allAvailable = true;
    const legDetails: VenueCost['legDetails'] = [];

    for (const leg of legs) {
      const ve = buildVenueExecution(chain, venueId, leg);
      if (!ve) {
        allAvailable = false;
        continue;
      }
      const exec = computeExecutionCost(ve, leg.direction, leg.quantity);
      if (!exec) {
        allAvailable = false;
        continue;
      }

      const signedCost = leg.direction === 'buy' ? -exec.totalCostUsd : exec.totalCostUsd;
      totalCost += signedCost;
      totalFees += exec.feeUsd;
      totalSpread += exec.spreadCostUsd;

      const q = (
        leg.type === 'call'
          ? chain.strikes.find((s) => s.strike === leg.strike)?.call
          : chain.strikes.find((s) => s.strike === leg.strike)?.put
      )?.venues[venueId as VenueId];

      legDetails.push({
        strike: leg.strike,
        type: leg.type,
        direction: leg.direction,
        price: exec.entryPrice,
        iv: q?.markIv ?? null,
        spreadPct: q?.spreadPct ?? null,
      });
    }

    return {
      venue: venueId,
      totalCost,
      totalFees,
      totalSpread,
      available: allAvailable,
      legDetails,
    };
  });

  const sorted = [...venueCosts].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    return b.totalCost - a.totalCost;
  });

  const bestCost = sorted[0]?.available ? sorted[0].totalCost : null;
  const worstCost = sorted.filter((v) => v.available).at(-1)?.totalCost ?? null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerTitle}>Venue Comparison</span>
          <span className={styles.headerMeta}>
            {strategyName} · {legs.length} leg{legs.length !== 1 ? 's' : ''}
            {strategyExpiry ? ` · ${formatExpiry(strategyExpiry)}` : ''}
          </span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>
          ✕
        </button>
      </div>

      {bestCost != null && worstCost != null && bestCost !== worstCost && (
        <div className={styles.banner}>
          <span className={styles.bannerLabel}>Best execution saves</span>
          <span className={styles.bannerValue}>{fmtUsd(Math.abs(bestCost - worstCost))}</span>
          <span className={styles.bannerLabel}>vs worst</span>
        </div>
      )}

      <div className={styles.list}>
        {sorted.map((vc, i) => {
          const meta = VENUES[vc.venue];
          const isExpanded = expanded === vc.venue;
          const isBest = i === 0 && vc.available;
          const savings =
            isBest && worstCost != null && bestCost != null && bestCost !== worstCost
              ? Math.abs(vc.totalCost - worstCost)
              : null;

          return (
            <div
              key={vc.venue}
              className={styles.venueRow}
              data-best={isBest || undefined}
              data-unavailable={!vc.available || undefined}
            >
              <div className={styles.rank} data-best={isBest || undefined}>
                {vc.available ? `#${i + 1}` : '–'}
              </div>

              <button
                className={styles.venueMain}
                onClick={() => setExpanded(isExpanded ? null : vc.venue)}
              >
                <div className={styles.venueId}>
                  {meta?.logo && <img src={meta.logo} alt="" className={styles.venueLogo} />}
                  <span className={styles.venueName}>{meta?.label ?? vc.venue}</span>
                </div>

                <div className={styles.venueNumbers}>
                  {vc.available ? (
                    <>
                      <span
                        className={styles.venueTotal}
                        data-positive={vc.totalCost > 0 || undefined}
                      >
                        {vc.totalCost > 0 ? '+' : ''}
                        {fmtUsd(vc.totalCost)}
                      </span>
                      <span className={styles.venueSub}>
                        fee {fmtUsd(vc.totalFees)} · spread {fmtUsd(vc.totalSpread)}
                      </span>
                    </>
                  ) : (
                    <span className={styles.venueUnavail}>Not available</span>
                  )}
                </div>

                {savings != null && <span className={styles.savingsBadge}>−{fmtUsd(savings)}</span>}

                <span className={styles.chevron} data-open={isExpanded || undefined}>
                  ▾
                </span>
              </button>

              {isExpanded && vc.available && (
                <div className={styles.legDetails}>
                  <div className={styles.legDetailHeader}>
                    <span>Leg</span>
                    <span>Price</span>
                    <span>IV</span>
                    <span>Spread</span>
                  </div>
                  {vc.legDetails.map((d, j) => (
                    <div key={j} className={styles.legDetailRow}>
                      <span className={styles.legDetailLeg}>
                        <span data-direction={d.direction}>
                          {d.direction === 'buy' ? 'B' : 'S'}
                        </span>{' '}
                        {d.strike.toLocaleString()}{' '}
                        <span data-type={d.type}>{d.type === 'call' ? 'C' : 'P'}</span>
                      </span>
                      <span className={styles.legDetailPrice}>{fmtUsd(d.price)}</span>
                      <span className={styles.legDetailIv}>
                        {d.iv != null ? `${(d.iv * 100).toFixed(1)}%` : '–'}
                      </span>
                      <span className={styles.legDetailSpread}>
                        {d.spreadPct != null ? `${d.spreadPct.toFixed(1)}%` : '–'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
