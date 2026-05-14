import { workflowSteps } from '@/lib/demo-data';
import { landingCopy } from '@/lib/copy';

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="landing-container px-6 py-20 sm:px-10 sm:py-24">
      <div className="max-w-3xl">
        <p className="landing-kicker">{landingCopy.workflow.eyebrow}</p>
        <h2 className="landing-section-title mt-4 max-w-[13ch]">{landingCopy.workflow.title}</h2>
        <p className="landing-section-copy mt-6 max-w-2xl">{landingCopy.workflow.description}</p>
      </div>

      <div className="landing-panel mt-10 overflow-hidden rounded-[2rem] p-4 sm:p-5">
        <div className="grid gap-3">
          {workflowSteps.map((step) => (
            <article
              key={step.id}
              className="relative overflow-hidden rounded-[1.5rem] border border-white/8 bg-[linear-gradient(90deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] px-5 py-5"
            >
              <div className="absolute inset-y-0 left-0 w-px bg-[linear-gradient(180deg,transparent,rgba(80,210,193,0.8),transparent)]" />
              <div className="grid gap-5 lg:grid-cols-[120px_1.1fr_0.8fr] lg:items-center">
                <div>
                  <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                    Depth state
                  </p>
                  <div className="mt-3 inline-flex items-center gap-3 rounded-full border border-white/8 bg-black/16 px-3 py-2">
                    <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--landing-accent)]">
                      {step.label}
                    </span>
                    <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                      {step.title}
                    </span>
                  </div>
                </div>

                <div>
                  <h3 className="landing-display-value text-3xl">{step.title}</h3>
                  <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--landing-muted-strong)]">
                    {step.description}
                  </p>
                </div>

                <div className="rounded-[1.2rem] border border-white/8 bg-black/14 px-4 py-4">
                  <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                    Trigger
                  </p>
                  <p className="mt-3 text-sm leading-6 text-zinc-200">{step.detail}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
