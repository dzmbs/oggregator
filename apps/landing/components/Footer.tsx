import { landingCopy } from "@/lib/copy";

export function Footer() {
  return (
    <footer className="landing-container border-t border-white/6 px-6 py-8 sm:px-10">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-[var(--font-heading)] text-sm font-medium uppercase tracking-[0.3em] text-zinc-300">
            Oggregator
          </p>
          <p className="mt-2 text-sm text-zinc-500">{landingCopy.footer.strapline}</p>
        </div>

        <div className="flex flex-wrap gap-4 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-zinc-500">
          {landingCopy.footer.links.map((link) => (
            <a key={link.href} href={link.href} className="transition hover:text-zinc-200">
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
