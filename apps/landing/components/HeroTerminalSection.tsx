import { landingCopy } from '@/lib/copy';

import { VolatilitySurfaceExperience } from './VolatilitySurfaceExperience';

export function HeroTerminalSection() {
  return (
    <section id="hero" className="landing-container px-6 pb-18 pt-10 sm:px-10 sm:pb-24 sm:pt-14">
      <div className="max-w-4xl">
        <div className="max-w-2xl">
          <div className="landing-chip">
            <span className="h-2 w-2 rounded-full bg-[var(--landing-accent)] shadow-[0_0_18px_rgba(80,210,193,0.8)]" />
            {landingCopy.hero.eyebrow}
          </div>
          <h1 className="landing-display-title mt-6 max-w-[12ch] text-[clamp(3.8rem,8vw,7.3rem)]">
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
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500">
          <span>{landingCopy.hero.proofLabel}</span>
          {landingCopy.hero.proofPoints.map((point) => (
            <span
              key={point}
              className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-2 text-zinc-300"
            >
              {point}
            </span>
          ))}
        </div>

        <div className="mt-8">
          <VolatilitySurfaceExperience />
        </div>

        <div className="mt-6 grid gap-3 text-sm leading-6 text-[var(--landing-muted-strong)] md:grid-cols-3">
          <div className="rounded-[1.2rem] border border-white/8 bg-white/[0.025] px-4 py-4">
            <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--landing-accent)]">
              Depth hierarchy
            </p>
            <p className="mt-3">
              Macro topology stays visible until proximity justifies local labels and exact quotes.
            </p>
          </div>
          <div className="rounded-[1.2rem] border border-white/8 bg-white/[0.025] px-4 py-4">
            <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--landing-accent)]">
              Volumetric overlays
            </p>
            <p className="mt-3">
              Liquidity fog, event ridges, and confidence mesh stack on the surface instead of
              beside it.
            </p>
          </div>
          <div className="rounded-[1.2rem] border border-white/8 bg-white/[0.025] px-4 py-4">
            <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--landing-accent)]">
              Anchored telemetry
            </p>
            <p className="mt-3">
              Pinned callouts stay attached to strike and tenor coordinates while the camera moves
              around them.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
