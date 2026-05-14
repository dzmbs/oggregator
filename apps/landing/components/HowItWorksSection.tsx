import { workflowSteps } from "@/lib/demo-data";
import { landingCopy } from "@/lib/copy";

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="landing-container px-6 py-20 sm:px-10 sm:py-24">
      <div className="max-w-3xl">
        <p className="landing-kicker">{landingCopy.workflow.eyebrow}</p>
        <h2 className="landing-section-title mt-4 max-w-[13ch]">{landingCopy.workflow.title}</h2>
        <p className="landing-section-copy mt-6 max-w-2xl">{landingCopy.workflow.description}</p>
      </div>

      <div className="relative mt-10 grid gap-4 lg:grid-cols-3">
        <div className="pointer-events-none absolute left-[17%] right-[17%] top-7 hidden h-px bg-[linear-gradient(90deg,transparent,rgba(80,210,193,0.45),transparent)] lg:block" />
        {workflowSteps.map((step) => (
          <article
            key={step.id}
            className="landing-panel group relative overflow-hidden rounded-[1.8rem] p-6 transition duration-300 hover:-translate-y-1 hover:border-[rgba(80,210,193,0.25)]"
          >
            <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,rgba(80,210,193,0.12),transparent_70%)] opacity-0 transition duration-300 group-hover:opacity-100" />
            <div className="relative">
              <div className="flex items-center justify-between gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/8 bg-white/[0.05] font-[var(--font-mono)] text-[11px] uppercase tracking-[0.28em] text-[var(--landing-accent)]">
                  {step.label}
                </span>
                <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                  {step.title}
                </span>
              </div>
              <h3 className="mt-6 text-3xl font-black tracking-[-0.05em] text-[var(--landing-text)]">
                {step.title}
              </h3>
              <p className="mt-4 text-base leading-7 text-[var(--landing-muted-strong)]">
                {step.description}
              </p>
              <p className="mt-6 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-zinc-400">
                {step.detail}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
