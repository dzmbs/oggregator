'use client';

const TAPE_ITEMS = [
  { label: 'Venue', value: 'Deribit · OKX · Binance · Bybit live' },
  { label: 'Flow', value: 'Thalex private feed synced to portfolio workspace' },
  { label: 'Spot', value: 'BTC $81.3K +2.5%' },
  { label: 'Spot', value: 'ETH $2.1K +1.2%' },
  { label: 'Sponsored', value: 'Coincall low fees + deep options liquidity' },
  { label: 'Route', value: 'Gate.io · Derive added to best-execution router' },
] as const;

export function TopTicker() {
  const doubled = [...TAPE_ITEMS, ...TAPE_ITEMS];

  return (
    <div className="overflow-hidden border-b border-[color:var(--landing-border)] bg-[rgba(10,10,10,0.92)] backdrop-blur-xl">
      <div className="landing-container px-4 py-2 sm:px-6">
        <div className="landing-feed-tape overflow-hidden">
          <div className="landing-feed-tape-track flex min-w-max items-center gap-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.18em] text-zinc-300">
            {doubled.map((item, index) => (
              <div
                key={`${item.label}-${index}`}
                className="flex items-center gap-2 rounded-full border border-white/8 bg-[#0f1216] px-3 py-1.5"
              >
                <span
                  className={`${item.label === 'Sponsored' ? 'text-[var(--landing-accent)]' : 'text-zinc-500'}`}
                >
                  {item.label}
                </span>
                <span>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
