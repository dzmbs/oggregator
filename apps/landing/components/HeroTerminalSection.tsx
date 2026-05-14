import { landingCopy } from "@/lib/copy";

import { TerminalMockup } from "./TerminalMockup";

export function HeroTerminalSection() {
  return (
    <section id="hero" className="landing-container px-6 pb-20 pt-10 sm:px-10 sm:pb-24 sm:pt-14">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-12">
        <div className="max-w-2xl">
          <div className="landing-chip">
            <span className="h-2 w-2 rounded-full bg-[var(--landing-accent)] shadow-[0_0_18px_rgba(80,210,193,0.8)]" />
            {landingCopy.hero.eyebrow}
          </div>
          <h1 className="mt-6 max-w-[12ch] text-[clamp(3.8rem,8vw,7.3rem)] font-black leading-[0.9] tracking-[-0.08em] text-[var(--landing-text)]">
            {landingCopy.hero.headline}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[var(--landing-muted-strong)] sm:text-xl">
            {landingCopy.hero.subheadline}
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a href="#access" className="landing-button-primary">
              {landingCopy.hero.primaryCta}
            </a>
            <a href="#features" className="landing-button-secondary">
              {landingCopy.hero.secondaryCta}
            </a>
          </div>

          <div className="mt-10 rounded-[1.5rem] border border-[color:var(--landing-border)] bg-white/[0.03] p-4 shadow-[0_20px_80px_rgba(0,0,0,0.24)]">
            <div className="flex items-center gap-3">
              <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.26em] text-zinc-500">
                {landingCopy.hero.proofLabel}
              </p>
              <div className="h-px flex-1 bg-white/8" />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {landingCopy.hero.proofPoints.map((point) => (
                <div
                  key={point}
                  className="rounded-[1rem] border border-white/6 bg-black/20 px-3 py-3 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-zinc-200"
                >
                  {point}
                </div>
              ))}
            </div>
          </div>
        </div>

        <TerminalMockup />
      </div>
    </section>
  );
}
