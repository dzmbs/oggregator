import { deskSnippet } from "@/lib/demo-data";

export function DeskWorkflowSection() {
  return (
    <section className="mx-auto grid max-w-7xl gap-12 px-6 py-24 sm:px-10 lg:grid-cols-[0.95fr_1.05fr]">
      <div>
        <p className="mb-8 font-[var(--font-mono)] text-xs uppercase tracking-[0.45em] text-[var(--landing-accent)]">
          Desk workflow
        </p>
        <h2 className="font-[var(--font-heading)] text-5xl font-black leading-[0.92] tracking-[-0.06em] md:text-7xl">
          Built for desks.
        </h2>
        <p className="mt-8 max-w-2xl text-lg leading-8 text-zinc-400">
          Traders, PMs, and execution teams need venue-normalized options
          context without opening five terminals and reconciling them manually.
        </p>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
          Oggregator keeps the interface calm while surfacing the routing and
          IV context that actually matters.
        </p>
      </div>
      <div className="rounded-[2.4rem] border border-white/6 bg-[var(--landing-panel-strong)] p-10 shadow-[0_25px_80px_rgba(0,0,0,0.34)]">
        <p className="mb-8 font-[var(--font-mono)] text-xs uppercase tracking-[0.45em] text-zinc-500">
          route-preview.ts
        </p>
        <pre className="overflow-x-auto font-[var(--font-mono)] text-sm leading-8 text-zinc-300">
          <code>{`const bestVenueSelection = {\n${deskSnippet
            .map((line) => `  ${line},`)
            .join("\n")}\n};`}</code>
        </pre>
      </div>
    </section>
  );
}
