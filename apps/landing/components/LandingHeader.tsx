import { landingCopy } from "@/lib/copy";

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-[color:var(--landing-border)] bg-[rgba(10,10,10,0.84)] backdrop-blur-xl">
      <div className="landing-container flex items-center justify-between gap-6 px-6 py-4 sm:px-10">
        <a
          href="#hero"
          className="font-[var(--font-heading)] text-base font-medium uppercase tracking-[0.32em] text-zinc-300 sm:text-lg"
        >
          {landingCopy.nav.home}
        </a>

        <div className="hidden items-center gap-6 md:flex">
          <a className="landing-nav-link" href="#how-it-works">
            {landingCopy.nav.workflow}
          </a>
          <a className="landing-nav-link" href="#features">
            {landingCopy.nav.features}
          </a>
          <a className="landing-nav-link" href="#faq">
            {landingCopy.nav.faq}
          </a>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden rounded-full border border-[color:var(--landing-border)] bg-[rgba(80,210,193,0.08)] px-3 py-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--landing-accent)] sm:inline-flex">
            Live / institutional preview
          </span>
          <a href="#access" className="landing-button-primary px-5! py-3!">
            {landingCopy.nav.cta}
          </a>
        </div>
      </div>
    </header>
  );
}
