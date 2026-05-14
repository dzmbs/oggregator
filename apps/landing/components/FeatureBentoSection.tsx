import { spatialModes, spatialOverlayRules } from '@/lib/demo-data';
import { landingCopy } from '@/lib/copy';

export function FeatureBentoSection() {
  return (
    <section id="features" className="landing-container px-6 py-20 sm:px-10 sm:py-24">
      <div className="max-w-3xl">
        <p className="landing-kicker">{landingCopy.features.eyebrow}</p>
        <h2 className="landing-section-title mt-4 max-w-[13ch]">{landingCopy.features.title}</h2>
        <p className="landing-section-copy mt-6 max-w-2xl">{landingCopy.features.description}</p>
      </div>

      <div className="mt-10 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="landing-panel overflow-hidden rounded-[2rem] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                Analytic modes
              </p>
              <h3 className="landing-display-value mt-3 text-3xl">
                One object, four ways to read it.
              </h3>
            </div>
            <span className="rounded-full border border-[rgba(80,210,193,0.24)] bg-[rgba(80,210,193,0.1)] px-3 py-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--landing-accent)]">
              Preserve camera context
            </span>
          </div>

          <div className="mt-6 grid gap-3">
            {spatialModes.map((mode) => (
              <article
                key={mode.id}
                className="rounded-[1.5rem] border border-white/8 bg-[linear-gradient(90deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] px-4 py-4"
              >
                <div className="grid gap-3 lg:grid-cols-[0.9fr_1.3fr_0.9fr] lg:items-center">
                  <div>
                    <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--landing-accent)]">
                      {mode.signal}
                    </p>
                    <h4 className="landing-display-value mt-3 text-2xl">{mode.title}</h4>
                  </div>
                  <p className="text-base leading-7 text-[var(--landing-muted-strong)]">
                    {mode.description}
                  </p>
                  <p className="rounded-[1rem] border border-white/8 bg-black/14 px-3 py-3 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                    {mode.emphasis}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-panel overflow-hidden rounded-[2rem] p-5 sm:p-6">
          <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500">
            Clutter-control rules
          </p>
          <h3 className="landing-display-value mt-3 max-w-[11ch] text-3xl">
            High-density data without dashboard collapse.
          </h3>

          <div className="mt-6 grid gap-3">
            {spatialOverlayRules.map((rule) => (
              <article
                key={rule.id}
                className="rounded-[1.5rem] border border-white/8 bg-[rgba(255,255,255,0.02)] px-4 py-4"
              >
                <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--landing-accent)]">
                  {rule.title}
                </p>
                <p className="mt-3 text-base leading-7 text-[var(--landing-text-strong)]">
                  {rule.description}
                </p>
                <p className="mt-3 text-sm leading-6 text-[var(--landing-muted-strong)]">
                  {rule.detail}
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
