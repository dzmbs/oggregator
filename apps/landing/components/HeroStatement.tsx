import { heroCopy } from "@/lib/copy";

export function HeroStatement() {
  return (
    <section className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-6xl flex-col items-center justify-center px-6 pb-24 pt-12 text-center sm:px-10">
      <h1 className="max-w-5xl font-[var(--font-heading)] text-[4rem] font-black leading-[0.88] tracking-[-0.07em] text-[var(--landing-text)] sm:text-[5.5rem] lg:text-[8.25rem]">
        {heroCopy.headlineA}
      </h1>
      <p className="max-w-5xl font-[var(--font-heading)] text-[4rem] font-black leading-[0.88] tracking-[-0.07em] text-[var(--landing-accent)] sm:text-[5.5rem] lg:text-[8.25rem]">
        {heroCopy.headlineB}
      </p>
      <button
        type="button"
        className="mt-10 rounded-full border border-[rgba(215,122,82,0.32)] bg-white/[0.05] px-8 py-4 font-[var(--font-heading)] text-xl font-semibold text-zinc-100 shadow-[0_0_0_rgba(215,122,82,0)] transition hover:border-[var(--landing-accent)] hover:shadow-[0_0_40px_rgba(215,122,82,0.18)]"
      >
        {heroCopy.cta}
      </button>
      <p className="mt-12 font-[var(--font-mono)] text-xs uppercase tracking-[0.55em] text-zinc-500">
        {heroCopy.eyebrow}
      </p>
    </section>
  );
}
