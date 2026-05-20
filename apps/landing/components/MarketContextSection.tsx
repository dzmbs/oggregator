import { marketContextRows } from "@/lib/demo-data";

export function MarketContextSection() {
  return (
    <section className="mx-auto grid max-w-7xl gap-12 px-6 py-24 sm:px-10 lg:grid-cols-[1.05fr_0.95fr]">
      <div>
        <p className="mb-8 font-[var(--font-mono)] text-xs uppercase tracking-[0.45em] text-[var(--landing-accent)]">
          The unified stream
        </p>
        <h2 className="max-w-xl font-[var(--font-heading)] text-5xl font-black leading-[0.92] tracking-[-0.06em] md:text-7xl">
          Market context,
          <br />
          pre-installed.
        </h2>
        <p className="mt-8 max-w-2xl text-lg leading-8 text-zinc-400">
          Crypto options liquidity is fragmented across venues, expiries, and
          quote conventions. Oggregator brings the venue context together
          before you make the routing decision.
        </p>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
          Monitor implied vol, skew, open interest, and cross-venue spreads
          from one quiet, desk-grade surface.
        </p>
      </div>
      <div className="rounded-[2.25rem] border border-white/6 bg-[var(--landing-panel)] p-8 shadow-[0_25px_80px_rgba(0,0,0,0.28)]">
        {marketContextRows.map((row) => (
          <div
            key={row.label}
            className="flex items-end justify-between border-b border-white/6 py-6 last:border-b-0"
          >
            <div>
              <p className="font-[var(--font-mono)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
                {row.label}
              </p>
              <p className="mt-2 text-sm text-zinc-500">{row.detail}</p>
            </div>
            <p className="font-[var(--font-heading)] text-4xl font-black tracking-[-0.04em] text-[var(--landing-accent)]">
              {row.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
