import { tickerItems, type TickerItem } from "@/lib/demo-data";

const directionClass: Record<TickerItem["direction"], string> = {
  up: "text-emerald-300",
  down: "text-rose-300",
  flat: "text-zinc-500",
};

export function TopTicker() {
  return (
    <div className="border-b border-[color:var(--landing-border)] bg-black/30 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-7xl items-center overflow-x-auto px-4 py-2 [scrollbar-width:none] sm:px-6">
        {tickerItems.map((item, index) => (
          <div
            key={item.label}
            className={`flex shrink-0 items-center gap-3 border-white/6 px-4 py-1 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] ${
              index === tickerItems.length - 1 ? "" : "border-r"
            } ${index === 0 ? "pl-0" : ""}`}
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
