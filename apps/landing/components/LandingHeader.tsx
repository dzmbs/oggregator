import { heroCopy } from "@/lib/copy";

export function LandingHeader() {
  return (
    <header className="mx-auto flex w-full max-w-[120rem] items-center justify-between px-6 py-10 sm:px-10">
      <a
        href="/"
        className="font-[var(--font-mono)] text-2xl uppercase tracking-[0.18em] text-zinc-300"
      >
        Oggregator
      </a>
      <div className="flex items-center gap-3">
        <a
          href="#docs"
          className="rounded-full border border-white/10 bg-white/[0.04] px-6 py-3 font-[var(--font-mono)] text-[11px] font-medium uppercase tracking-[0.24em] text-zinc-100 transition hover:border-[var(--landing-accent)] hover:text-[var(--landing-text)]"
        >
          {heroCopy.docs}
        </a>
        <button
          type="button"
          className="rounded-full border border-[var(--landing-accent-soft)] bg-[rgba(255,255,255,0.05)] px-6 py-3 font-[var(--font-mono)] text-[11px] font-medium uppercase tracking-[0.24em] text-zinc-100 transition hover:border-[var(--landing-accent)] hover:bg-[rgba(215,122,82,0.08)]"
        >
          {heroCopy.cta}
        </button>
      </div>
    </header>
  );
}
