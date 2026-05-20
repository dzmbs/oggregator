import { heroCopy } from "@/lib/copy";

export function HeroStatement() {
  return (
    <section className="landing-shell px-6 pb-16 pt-8 sm:px-8 sm:pb-24">
      <div className="w-full max-w-6xl">
        <p className="mb-6 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.3em] text-zinc-500 sm:mb-8">
          {heroCopy.eyebrow}
        </p>
        <div className="max-w-5xl">
          <h1 className="m-0 text-[clamp(4rem,10vw,8rem)] font-black leading-[0.88] tracking-[-0.075em] text-[color:var(--landing-text)]">
            {heroCopy.headlineA}
          </h1>
          <p className="mt-3 text-[clamp(4rem,10vw,8rem)] font-black leading-[0.88] tracking-[-0.075em] text-[color:var(--landing-accent)]">
            {heroCopy.headlineB}
          </p>
        </div>
      </div>
    </section>
  );
}
