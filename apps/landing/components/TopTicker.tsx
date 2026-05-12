import { tickerItems } from "@/lib/demo-data";

const directionClass = {
  up: "text-emerald-400",
  down: "text-rose-400",
  flat: "text-zinc-500",
} as const;

export function TopTicker() {
  const repeatedItems = [...tickerItems, ...tickerItems];

  return (
    <div className="sticky top-0 z-50 overflow-hidden border-b border-white/6 bg-black/35 backdrop-blur-md">
      <div className="ticker-track flex min-w-max animate-[ticker-marquee_32s_linear_infinite]">
        <div className="flex items-center gap-3 border-r border-white/6 px-4 py-3 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.28em] text-zinc-500">
          <span>Live Network</span>
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </div>
        {repeatedItems.map((item, index) => (
          <div
            key={`${item.label}-${index}`}
            className="flex items-center gap-3 border-r border-white/6 px-5 py-3 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.22em]"
          >
            <span className="text-zinc-500">{item.label}</span>
            <span className="text-zinc-100">{item.value}</span>
            <span className={directionClass[item.direction]}>{item.change}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
