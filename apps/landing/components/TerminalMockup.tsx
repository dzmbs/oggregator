import Image from 'next/image';

export function TerminalMockup() {
  return (
    <div className="landing-panel-strong relative overflow-hidden rounded-[2rem] p-4 sm:p-5">
      <div className="absolute inset-x-10 top-0 h-32 bg-[radial-gradient(circle,_rgba(80,210,193,0.18),_transparent_72%)] blur-3xl" />
      <div className="relative overflow-hidden rounded-[1.6rem] border border-[color:var(--landing-border)] bg-[rgba(10,10,10,0.96)] shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--landing-border)] px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--landing-loss)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--landing-warning)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--landing-success)]" />
            </div>
            <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.28em] text-zinc-400">
              Oggregator terminal / real portfolio view
            </p>
          </div>
          <span className="rounded-full border border-[rgba(80,210,193,0.2)] bg-[rgba(80,210,193,0.1)] px-3 py-1 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--landing-accent)]">
            Live portfolio
          </span>
        </div>

        <div className="p-3 sm:p-4">
          <div className="relative aspect-[1.16/1] overflow-hidden rounded-[1.2rem] border border-white/6 bg-black sm:aspect-[1.45/1] lg:aspect-[1.04/1]">
            <Image
              src="/portfolio1.png"
              alt="Real portfolio terminal showing live Greeks, P&L curve, and skew risk."
              fill
              priority
              sizes="(min-width: 1024px) 48vw, 100vw"
              className="object-cover object-[54%_20%] scale-[1.24]"
            />
          </div>
          <p className="mt-3 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-zinc-500">
            Zoomed on live P&amp;L, Greeks, and risk.
          </p>
        </div>
      </div>
    </div>
  );
}
