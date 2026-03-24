import type { Leg } from "./payoff";
import type { EnrichedChainResponse } from "@shared/enriched";
import type { VenueId } from "@oggregator/protocol";
import { VenueCard, type VenueCardDetail } from "@components/ui";
import { fmtUsd } from "@lib/format";
import { detectStrategy } from "./payoff";
import styles from "./VenueSlideover.module.css";

interface VenueSlideoverProps {
  legs:         Leg[];
  chain:        EnrichedChainResponse | null;
  activeVenues: string[];
  onClose:      () => void;
}

export default function VenueSlideover({ legs, chain, activeVenues, onClose }: VenueSlideoverProps) {
  if (!chain || legs.length === 0) return null;

  const strategyName = detectStrategy(legs);

  const venueCosts = activeVenues.map((venueId) => {
    let totalCost = 0;
    let allAvailable = true;
    const details: VenueCardDetail[] = [];

    for (const leg of legs) {
      const strike = chain.strikes.find((s) => s.strike === leg.strike);
      const side = leg.type === "call" ? strike?.call : strike?.put;
      const q = side?.venues[venueId as VenueId];
      const price = leg.direction === "buy" ? q?.ask : q?.bid;
      const oppositePrice = leg.direction === "buy" ? q?.bid : q?.ask;
      const spreadCost = price != null && oppositePrice != null ? Math.abs(price - oppositePrice) / 2 : null;

      if (price == null || price <= 0) {
        allAvailable = false;
      } else {
        totalCost += leg.direction === "buy" ? -price * leg.quantity : price * leg.quantity;
        details.push({
          label: `${leg.strike}`,
          strike: leg.strike,
          type: leg.type,
          direction: leg.direction,
          price,
          spreadPct: q?.spreadPct ?? null,
          iv: q?.markIv ?? null,
          size: (leg.direction === "buy" ? q?.askSize : q?.bidSize) ?? null,
          spreadCost,
        });
      }
    }

    return { venue: venueId, totalCost, available: allAvailable, details };
  });

  const validCosts = venueCosts.filter((v) => v.available);
  const bestVenue = validCosts.length > 0
    ? validCosts.reduce((best, v) => v.totalCost > best.totalCost ? v : best)
    : null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.strategyName}>{strategyName}</span>
          <span className={styles.legCount}>{legs.length} leg{legs.length !== 1 ? "s" : ""}</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div className={styles.venueList}>
        {venueCosts.map((vc) => {
          const isBest = bestVenue?.venue === vc.venue;
          const savingsText = isBest && validCosts.length > 1
            ? `saves ${fmtUsd(Math.abs(vc.totalCost - validCosts[validCosts.length - 1]!.totalCost))}`
            : undefined;

          return (
            <VenueCard
              key={vc.venue}
              venueId={vc.venue}
              total={vc.available ? vc.totalCost : null}
              totalLabel={vc.available ? (vc.totalCost > 0 ? "net credit" : "net debit") : undefined}
              isBest={isBest}
              available={vc.available}
              details={vc.details}
              savings={savingsText}
            />
          );
        })}
      </div>
    </div>
  );
}
