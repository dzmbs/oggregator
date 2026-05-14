import { capabilitySignals, featureCards } from "@/lib/demo-data";
import { landingCopy } from "@/lib/copy";

const spanClassByCard = {
  wide: "md:col-span-2 xl:col-span-6",
  medium: "md:col-span-1 xl:col-span-3",
  compact: "md:col-span-1 xl:col-span-3",
} as const;

const accentLineClassByCard = {
  wide: "from-[var(--landing-accent)] to-[var(--landing-accent-violet)]",
  medium: "from-[var(--landing-accent)] to-transparent",
  compact: "from-[var(--landing-accent-violet)] to-transparent",
} as const;

export function FeatureBentoSection() {
  return (
    <section id="features" className="landing-container px-6 py-20 sm:px-10 sm:py-24">
      <div className="max-w-3xl">
        <p className="landing-kicker">{landingCopy.features.eyebrow}</p>
        <h2 className="landing-section-title mt-4 max-w-[13ch]">{landingCopy.features.title}</h2>
        <p className="landing-section-copy mt-6 max-w-2xl">{landingCopy.features.description}</p>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-12">
        {featureCards.map((card) => (
          <article
            key={card.id}
            className={`landing-panel group relative overflow-hidden rounded-[1.8rem] p-6 transition duration-300 hover:-translate-y-1 hover:border-[rgba(80,210,193,0.24)] ${spanClassByCard[card.span]}`}
            >
            <div
              className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${accentLineClassByCard[card.span]}`}
            />
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                  {card.eyebrow}
                </p>
                <h3 className="mt-4 max-w-[14ch] text-3xl font-black tracking-[-0.05em] text-[var(--landing-text)]">
                  {card.title}
                </h3>
              </div>
              <span className="rounded-full border border-[color:var(--landing-border)] bg-[rgba(80,210,193,0.08)] px-3 py-1 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--landing-accent)]">
                {card.metric}
              </span>
            </div>

            <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--landing-muted-strong)]">
              {card.description}
            </p>

            <div className="mt-8 flex flex-wrap gap-2">
              {card.supportingPoints.map((point) => (
                <span
                  key={point}
                  className="rounded-full border border-white/8 bg-black/20 px-3 py-1.5 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300"
                >
                  {point}
                </span>
              ))}
            </div>

            {card.span === "wide" ? (
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {capabilitySignals.map((signal) => (
                  <div
                    key={signal}
                    className="rounded-[1rem] border border-white/6 bg-white/[0.03] px-3 py-3 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-zinc-200"
                  >
                    {signal}
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
