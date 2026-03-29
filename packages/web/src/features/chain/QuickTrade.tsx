import type { EnrichedSide } from '@shared/enriched';
import { VenueCard, type VenueCardDetail } from '@components/ui';
import { useStrategyStore } from '@features/architect/strategy-store';
import { useAppStore } from '@stores/app-store';
import styles from './QuickTrade.module.css';

interface QuickTradeProps {
  strike: number;
  type: 'call' | 'put';
  direction: 'buy' | 'sell';
  side: EnrichedSide;
  onClose: () => void;
}

export default function QuickTrade({ strike, type, direction, side, onClose }: QuickTradeProps) {
  const addLeg = useStrategyStore((s) => s.addLeg);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const activeTab = useAppStore((s) => s.activeTab);
  const underlying = useAppStore((s) => s.underlying);
  const expiry = useAppStore((s) => s.expiry);
  const activeVenues = useAppStore((s) => s.activeVenues);

  const venues = Object.entries(side.venues)
    .filter(([v]) => activeVenues.includes(v))
    .map(([venueId, q]) => {
      if (!q) return null;
      const price = direction === 'buy' ? q.ask : q.bid;
      const oppositePrice = direction === 'buy' ? q.bid : q.ask;
      const spreadCost =
        price != null && oppositePrice != null ? Math.abs(price - oppositePrice) / 2 : null;
      const size = direction === 'buy' ? q.askSize : q.bidSize;
      return {
        venueId,
        price,
        spreadCost,
        size,
        iv: q.markIv,
        delta: q.delta,
        gamma: q.gamma,
        theta: q.theta,
        vega: q.vega,
        spreadPct: q.spreadPct,
      };
    })
    .filter(Boolean)
    .filter((v) => v!.price != null && v!.price > 0)
    .filter((v) => v!.size == null || v!.size > 0)
    .sort((a, b) => {
      if (direction === 'buy') return (a!.price ?? Infinity) - (b!.price ?? Infinity);
      return (b!.price ?? 0) - (a!.price ?? 0);
    }) as Array<{
    venueId: string;
    price: number;
    spreadCost: number | null;
    size: number | null;
    iv: number | null;
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
    spreadPct: number | null;
  }>;

  const bestPriceVenue = venues[0]?.venueId ?? null;
  const bestIvVenue =
    venues.reduce<{ id: string; iv: number } | null>((best, v) => {
      if (v.iv == null) return best;
      if (best == null || v.iv < best.iv) return { id: v.venueId, iv: v.iv };
      return best;
    }, null)?.id ?? null;

  const isOnArchitect = activeTab === 'architect';

  function handleAdd(v: (typeof venues)[0]) {
    addLeg(
      {
        type,
        direction,
        strike,
        expiry,
        quantity: 1,
        entryPrice: v.price,
        venue: v.venueId,
        delta: v.delta,
        gamma: v.gamma,
        theta: v.theta,
        vega: v.vega,
        iv: v.iv,
      },
      underlying,
    );
    if (!isOnArchitect) setActiveTab('architect');
    onClose();
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.direction} data-direction={direction}>
            {direction === 'buy' ? 'BUY' : 'SELL'}
          </span>
          <span className={styles.strike}>{strike.toLocaleString()}</span>
          <span className={styles.type} data-type={type}>
            {type === 'call' ? 'CALL' : 'PUT'}
          </span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className={styles.venueList}>
        {venues.map((v) => {
          const detail: VenueCardDetail = {
            label: `${strike}`,
            strike,
            type,
            direction,
            price: v.price,
            spreadPct: v.spreadPct,
            iv: v.iv,
            size: v.size,
            spreadCost: v.spreadCost,
          };

          const tags: string[] = [];
          if (v.venueId === bestPriceVenue) tags.push('BEST PRICE');
          if (v.venueId === bestIvVenue) tags.push('BEST IV');

          return (
            <VenueCard
              key={v.venueId}
              venueId={v.venueId}
              total={v.price}
              isBest={v.venueId === bestPriceVenue}
              available
              details={[detail]}
              tags={tags}
              action={{
                label: isOnArchitect ? '+ Add Leg' : '+ Builder',
                onClick: () => handleAdd(v),
              }}
            />
          );
        })}
        {venues.length === 0 && (
          <div className={styles.empty}>No quotes available for this option</div>
        )}
      </div>
    </div>
  );
}
